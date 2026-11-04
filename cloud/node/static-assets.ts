import { createReadStream } from 'node:fs';
import type { Stats } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.bin': 'application/octet-stream',
};

export class StaticPathError extends Error { constructor(public status: number) { super('Invalid static path'); } }

export function staticPath(target: string): string {
  if (!target.startsWith('/')) throw new StaticPathError(400);
  let decoded: string;
  try { decoded = decodeURIComponent(target.split('?')[0]); } catch { throw new StaticPathError(400); }
  if (/[\\\u0000-\u001f:*?"<>|]/.test(decoded) || decoded.split('/').some(segment => segment === '.' || segment === '..' || segment.startsWith('.'))) {
    throw new StaticPathError(400);
  }
  return decoded;
}

export function containsPath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function existingFile(root: string, pathname: string): Promise<{ filename: string; info: Stats } | null> {
  const filename = path.resolve(root, '.' + pathname);
  if (!containsPath(root, filename)) throw new StaticPathError(400);
  try {
    const actual = await realpath(filename);
    if (!containsPath(root, actual)) throw new StaticPathError(404);
    const info = await stat(actual);
    return info.isFile() ? { filename: actual, info } : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return null;
    throw error;
  }
}

export async function serveStatic(request: IncomingMessage, response: ServerResponse, root: string): Promise<void> {
  if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  const pathname = staticPath(request.url ?? '/');
  let file = await existingFile(root, pathname === '/' ? '/index.html' : pathname);
  const assetNamespace = ['/fonts', '/assets', '/pdf-assets'].some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
  const wantsHtml = /(?:^|,)\s*text\/html(?:\s*[;,]|$)/i.test(request.headers.accept ?? '');
  if (!file && !assetNamespace && !path.posix.extname(pathname) && wantsHtml) file = await existingFile(root, '/index.html');
  if (!file) { response.writeHead(404, { 'Cache-Control': 'no-store' }); response.end('Not found'); return; }
  const etag = `W/"${file.info.size.toString(16)}-${Math.trunc(file.info.mtimeMs).toString(16)}"`;
  const headers = {
    'Content-Type': MIME[path.extname(file.filename).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': String(file.info.size), ETag: etag,
    'Cache-Control': path.extname(file.filename) === '.html' ? 'no-cache' : 'public, max-age=3600, must-revalidate',
    'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'none',
  };
  if ((request.headers['if-none-match'] ?? '').split(',').some(value => value.trim() === etag || value.trim() === '*')) {
    response.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'] }); response.end(); return;
  }
  response.writeHead(200, headers);
  if (request.method === 'HEAD') { response.end(); return; }
  // Font files may exceed 25 MiB; stream filesystem chunks without constructing one large buffer.
  await pipeline(createReadStream(file.filename, { highWaterMark: 64 * 1024 }), response);
}
