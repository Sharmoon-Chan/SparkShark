import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isIP } from 'node:net';
import { migrateDatabase } from './migrations';
import { ApiPoolBusy, ApiWorkerPool } from './worker-pool';
import { containsPath, serveStatic, StaticPathError, staticPath } from './static-assets';
import { MAX_NODE_BODY_BYTES, releaseTransferredBuffer } from './protocol';

export interface NodeServerConfiguration {
  appOrigin: string; host: '127.0.0.1' | '::1'; port: number;
  dataDirectory: string; publicDirectory: string; migrationsDirectory: string; workerPath: string;
  bootstrapToken?: string; workerCount?: 1 | 2;
}
const bundle = path.dirname(fileURLToPath(import.meta.url));

function validAppOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const loopback = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    return url.origin === value && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
      (url.protocol === 'https:' || loopback);
  } catch { return false; }
}

export function configuration(environment: NodeJS.ProcessEnv = process.env): NodeServerConfiguration {
  const appOrigin = environment.APP_ORIGIN ?? 'https://sparkshark.sharmoon.cc.cd';
  if (!validAppOrigin(appOrigin)) throw new Error('APP_ORIGIN must be an exact HTTPS origin or an HTTP loopback development origin');
  const host = environment.LISTEN_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1') throw new Error('The backend must listen on loopback only');
  const port = Number(environment.PORT ?? 8790), workerCount = Number(environment.MAX_API_WORKERS ?? 1);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || ![1, 2].includes(workerCount)) throw new Error('Invalid backend port or worker count');
  return { appOrigin, host, port, workerCount: workerCount as 1 | 2,
    dataDirectory: path.resolve(environment.DATA_DIR ?? path.join(bundle, 'data')),
    publicDirectory: path.resolve(environment.PUBLIC_DIR ?? path.join(bundle, 'public')),
    migrationsDirectory: path.join(bundle, 'migrations'), workerPath: path.join(bundle, 'api-worker.mjs'),
    bootstrapToken: environment.BOOTSTRAP_TOKEN };
}

function json(response: ServerResponse, status: number, code: string, message: string): void {
  if (response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify({ error: { code, message } }));
}

function discardRejectedBody(request: IncomingMessage): void {
  // Drain a bounded rejected upload so a browser receives 413 rather than a TCP reset.
  // Larger/slow abusive streams are terminated after the response, without retaining their bytes.
  let discarded = 0;
  const finish = () => {
    clearTimeout(timer); request.off('data', discard); request.off('end', finish); request.off('close', finish);
  };
  const discard = (chunk: Buffer) => {
    discarded += chunk.byteLength;
    if (discarded > MAX_NODE_BODY_BYTES * 2) { finish(); request.destroy(); }
  };
  const timer = setTimeout(() => { finish(); request.destroy(); }, 2000);
  timer.unref();
  request.on('data', discard); request.once('end', finish); request.once('close', finish); request.resume();
}

export async function bodyBytes(request: IncomingMessage): Promise<ArrayBuffer | null> {
  const length = request.headers['content-length'];
  const declared = length === undefined ? undefined : Number(length);
  if (length !== undefined && (!/^\d+$/.test(length) || !Number.isSafeInteger(declared) || declared! > MAX_NODE_BODY_BYTES)) {
    throw new StaticPathError(413);
  }
  return new Promise((resolve, reject) => {
    // Browser JSON uploads have a validated Content-Length. Allocate exactly once,
    // fill it as chunks arrive, and transfer that same allocation to the API thread.
    const exact = declared === undefined ? null : new Uint8Array(declared);
    const chunks: Buffer[] | null = exact ? null : [];
    let total = 0, finished = false;
    const cleanup = () => {
      request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', aborted);
    };
    const error = (value: Error) => { if (finished) return; finished = true; cleanup(); if (chunks) chunks.length = 0; reject(value); };
    const aborted = () => error(new Error('Request aborted'));
    const data = (chunk: Buffer) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const received = total + bytes.byteLength;
      if (received > MAX_NODE_BODY_BYTES) { request.pause(); error(new StaticPathError(413)); return; }
      if (declared !== undefined && received > declared) { request.pause(); error(new StaticPathError(400)); return; }
      if (exact) exact.set(bytes, total);
      else chunks!.push(bytes);
      total = received;
    };
    const end = () => {
      if (finished) return;
      if (declared !== undefined && total !== declared) { error(new StaticPathError(400)); return; }
      finished = true;
      cleanup();
      if (!total) { resolve(null); return; }
      if (exact) { resolve(exact.buffer); return; }
      const buffer = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks!) { buffer.set(chunk, offset); offset += chunk.byteLength; }
      chunks!.length = 0;
      resolve(buffer.buffer);
    };
    request.on('data', data); request.once('end', end); request.once('error', error); request.once('aborted', aborted);
    request.resume();
  });
}

async function reply(response: ServerResponse, status: number, headers: [string, string][], body: ArrayBuffer): Promise<void> {
  try {
    if (response.destroyed) return;
    response.writeHead(status, Object.fromEntries(headers));
    await new Promise<void>((resolve, reject) => {
      const finished = () => { cleanup(); resolve(); };
      const failed = (error: Error) => { cleanup(); reject(error); };
      const cleanup = () => { response.off('error', failed); response.off('close', finished); };
      response.once('error', failed); response.once('close', finished);
      response.end(Buffer.from(body), finished);
    });
  } finally {
    // All writes are flushed (or the socket is closed); no consumer needs these bytes.
    releaseTransferredBuffer(body);
  }
}

export async function startNodeServer(options: NodeServerConfiguration) {
  if (options.host !== '127.0.0.1' && options.host !== '::1') throw new Error('The backend must listen on loopback only');
  if (!validAppOrigin(options.appOrigin)) throw new Error('Invalid website origin');
  // The startup connection creates a private DB and applies each migration exactly once.
  process.umask(0o077);
  const publicRoot = await realpath(options.publicDirectory);
  await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 });
  const dataRoot = await realpath(options.dataDirectory);
  if (containsPath(publicRoot, dataRoot)) throw new Error('Database directory must be outside publicly served assets');
  const filename = path.join(dataRoot, 'myresume.sqlite');
  await migrateDatabase(filename, options.migrationsDirectory);
  const pool = new ApiWorkerPool(options.workerPath, { filename, appOrigin: options.appOrigin, bootstrapToken: options.bootstrapToken },
    { size: options.workerCount ?? 1, maxQueue: 16, queueTimeoutMs: 15000 });
  try { await pool.ready(); } catch (error) { await pool.close(); throw error; }

  const server = createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
    request.pause();
    try {
      const pathname = staticPath(request.url ?? '/');
      if (pathname === '/healthz') {
        if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : '{"ok":true}'); return;
      }
      if (pathname !== '/api' && !pathname.startsWith('/api/')) { await serveStatic(request, response, publicRoot); return; }
      const length = request.headers['content-length'];
      if (length && (!/^\d+$/.test(length) || Number(length) > MAX_NODE_BODY_BYTES)) throw new StaticPathError(413);
      if (['GET', 'HEAD'].includes(request.method ?? 'GET') && (Number(length ?? 0) > 0 || request.headers['transfer-encoding'])) throw new StaticPathError(400);
      const abort = new AbortController();
      request.once('aborted', () => abort.abort());
      response.once('close', () => { if (!response.writableEnded) abort.abort(); });
      const lease = await pool.acquire(abort.signal);
      try {
        // Queued requests remain paused, so a busy password worker cannot accumulate 16 × 8 MiB bodies.
        const body = await bodyBytes(request);
        if (abort.signal.aborted) return;
        const headers = Object.entries(request.headers).filter(([name, value]) => value !== undefined && name !== 'host')
          .map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value!] as [string, string]);
        const forwardedIp = request.headers['cf-connecting-ip'];
        const clientIp = typeof forwardedIp === 'string' && isIP(forwardedIp) ? forwardedIp : request.socket.remoteAddress ?? 'loopback';
        const withoutIp = headers.filter(([name]) => name !== 'cf-connecting-ip');
        withoutIp.push(['CF-Connecting-IP', clientIp]);
        const result = await lease.run({ url: new URL(request.url!, options.appOrigin).href, method: request.method ?? 'GET', headers: withoutIp, body });
        await reply(response, result.status, result.headers, result.body);
      } finally { lease.release(); }
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      if (error instanceof StaticPathError) {
        if (error.status === 413) discardRejectedBody(request);
        json(response, error.status, error.status === 413 ? 'BODY_TOO_LARGE' : 'INVALID_PATH', error.status === 413 ? '上传内容超过 8 MiB' : '请求地址无效');
      }
      else if (error instanceof ApiPoolBusy) json(response, 503, 'SERVICE_BUSY', '云端服务正在处理其他请求，请稍后重试。本机内容已保留');
      else json(response, 500, 'INTERNAL_ERROR', '云端服务暂时无法处理请求，请稍后重试');
    }
  });
  server.headersTimeout = 10000; server.requestTimeout = 30000; server.keepAliveTimeout = 5000; server.maxRequestsPerSocket = 100;
  server.setTimeout(30000, socket => socket.destroy());
  server.maxConnections = 64;
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, options.host, resolve); });
  } catch (error) { await pool.close(); throw error; }
  return { server, filename, publicRoot, async close() {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.close();
  } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = configuration();
  startNodeServer(options).then(runtime => {
    console.log(`MyResume backend listening on ${options.host}:${options.port}`);
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await runtime.close(); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  }).catch(() => { console.error('MyResume backend failed to start; check local configuration and database permissions.'); process.exitCode = 1; });
}
