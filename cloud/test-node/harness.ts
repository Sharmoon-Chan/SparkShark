import { build } from 'esbuild';
import { fork } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { SqliteD1Database } from '../node/sqlite-d1';
import type { CloudSession } from '../../src/cloud/types';

// Headers use the configured production origin; transport stays on local HTTP.
export const origin = 'https://me.sharmoon.cc.cd';
export const password = 'Synthetic password 2026!';
const cloudRoot = fileURLToPath(new URL('../', import.meta.url));

export interface TestActor { userId: string; cookie: string; csrf: string; session: CloudSession; ip: string; }
export interface ResourceMetrics { rss: number; heapUsed: number; external: number; maxRSS: number; userCPUTime: number; systemCPUTime: number; nodeVersion: string; }

export async function createHarness() {
  const outputRoot = resolve(cloudRoot, 'test-node/output');
  await mkdir(outputRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(resolve(outputRoot, 'case-'));
  const workerPath = resolve(temporaryRoot, 'api-worker.mjs');
  const serverPath = resolve(temporaryRoot, 'server.mjs');
  const fixturePath = resolve(temporaryRoot, 'fixture-server.mjs');
  await build({ entryPoints: [resolve(cloudRoot, 'node/api-worker.ts')], outfile: workerPath,
    bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['node:*'] });
  await build({ entryPoints: [resolve(cloudRoot, 'node/server.ts')], outfile: serverPath,
    bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['node:*'] });
  await build({ entryPoints: [resolve(cloudRoot, 'test-node/fixture-server.ts')], outfile: fixturePath,
    bundle: true, platform: 'node', format: 'esm', target: 'node24', external: ['node:*'] });
  const dbPath = resolve(temporaryRoot, 'data/myresume.sqlite');
  const bootstrapToken = randomBytes(32).toString('base64url');
  const proxySecret = randomBytes(32).toString('base64url');
  const child = fork(fixturePath, [], {
    execArgv: [], silent: true,
    env: { ...process.env, TEST_SQLITE_PATH: dbPath, TEST_APP_ORIGIN: origin,
      TEST_BOOTSTRAP_TOKEN: bootstrapToken, TEST_PROXY_SECRET: proxySecret,
      TEST_MIGRATIONS: resolve(cloudRoot, 'migrations'), TEST_WORKER_PATH: workerPath,
      TEST_SERVER_PATH: serverPath, TEST_CASE_ROOT: temporaryRoot },
  });
  let stderr = '';
  child.stderr?.on('data', data => { stderr = (stderr + data.toString()).slice(-3000); });
  child.stdout?.resume();
  const address = await new Promise<{ address: string; port: number; family: string }>((resolveReady, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Node fixture startup timeout')); }, 30_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Node fixture exited (${code}): ${stderr}`)); });
    child.on('message', (message: any) => {
      if (message.type === 'ready') { clearTimeout(timer); resolveReady(message.address); }
      if (message.type === 'startup-failure') { clearTimeout(timer); child.kill(); reject(new Error(message.message)); }
    });
  });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const db = new SqliteD1Database(dbPath);
  let nextMetricsId = 0;
  const pendingMetrics = new Map<number, (metrics: ResourceMetrics) => void>();
  child.on('message', (message: any) => {
    if (message.type === 'metrics') { pendingMetrics.get(message.id)?.(message.metrics); pendingMetrics.delete(message.id); }
  });

  async function request(path: string, options: { method?: string; body?: unknown; actor?: TestActor; origin?: string | null; csrf?: string | null; headers?: Record<string, string>; ip?: string } = {}) {
    const headers: Record<string, string> = {
      Origin: options.origin === undefined ? origin : options.origin ?? '',
      'CF-Connecting-IP': options.ip ?? options.actor?.ip ?? '192.0.2.1',
      'X-MyResume-Proxy-Secret': proxySecret,
      ...(options.actor ? { Cookie: options.actor.cookie } : {}),
      ...(options.actor && options.csrf === undefined ? { 'X-CSRF-Token': options.actor.csrf } : {}),
      ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}), ...options.headers,
    };
    if (options.origin === null) delete headers.Origin;
    if (options.csrf === null) delete headers['X-CSRF-Token'];
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(baseUrl + path, { method: options.method ?? 'GET', headers, body });
  }

  async function actorFrom(response: Response, ip: string): Promise<TestActor> {
    const session = await response.json() as CloudSession;
    if (!response.ok || !session.user || !session.csrfToken) throw new Error(`Cannot create test actor: ${response.status} ${JSON.stringify(session)}`);
    const cookie = response.headers.get('Set-Cookie')?.split(';')[0];
    if (!cookie) throw new Error('Session response did not set a cookie');
    return { userId: session.user.id, cookie, csrf: session.csrfToken, session, ip };
  }
  async function register(username: string, ip = '192.0.2.2', extra: Record<string, unknown> = {}) {
    return actorFrom(await request('/api/auth/register', { method: 'POST', body: { username, password, displayName: `Test ${username}`, ...extra }, ip }), ip);
  }
  async function bootstrap(username = 'administrator', ip = '192.0.2.10') {
    return actorFrom(await request('/api/admin/bootstrap', { method: 'POST', body: { username, password, displayName: 'Synthetic administrator' }, ip,
      headers: { 'X-Bootstrap-Token': bootstrapToken } }), ip);
  }
  async function metrics(): Promise<ResourceMetrics> {
    const id = nextMetricsId++;
    return new Promise((resolveMetrics, reject) => {
      const timer = setTimeout(() => { pendingMetrics.delete(id); reject(new Error('Metrics timeout')); }, 10_000);
      pendingMetrics.set(id, value => { clearTimeout(timer); resolveMetrics(value); });
      child.send({ type: 'metrics', id });
    });
  }
  async function dispose() {
    db.close();
    if (child.exitCode !== null) return;
    await new Promise<void>(resolveExit => {
      const timer = setTimeout(() => { child.kill(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolveExit(); });
      child.send({ type: 'shutdown' });
    });
  }
  return { db, dbPath, request, register, bootstrap, actorFrom, bootstrapToken, address, baseUrl, metrics, diagnostics: () => stderr, dispose };
}

export function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
