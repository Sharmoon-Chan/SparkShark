const ASSET_LIMIT = 25 * 1024 * 1024;
const CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_FONT_BYTES = 256 * 1024 * 1024;
const MANIFEST_LIMIT = 128 * 1024;
const MAX_FONTS = 64;
const MANIFEST_PATH = '/cloud-font-parts.json';

export interface FontParts { sha256: string; bytes: number; chunks: { path: string; bytes: number }[]; }
export interface FontManifest { version: 1; fonts: Record<string, FontParts>; }
const cache = new WeakMap<Fetcher, FontManifest>();

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
function fontPath(value: string): boolean { return /^\/fonts\/[A-Za-z0-9][A-Za-z0-9_.-]{0,159}\.ttf$/.test(value) && !value.includes('..'); }

export function parseFontManifest(value: unknown): FontManifest | null {
  if (!record(value) || !keys(value, ['version', 'fonts']) || value.version !== 1 || !record(value.fonts) ||
      Object.keys(value.fonts).length > MAX_FONTS) return null;
  for (const [path, entry] of Object.entries(value.fonts)) {
    if (!fontPath(path) || !record(entry) || !keys(entry, ['sha256', 'bytes', 'chunks']) ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        typeof entry.bytes !== 'number' || !Number.isSafeInteger(entry.bytes) || entry.bytes <= ASSET_LIMIT || entry.bytes > MAX_FONT_BYTES ||
        !Array.isArray(entry.chunks) || entry.chunks.length !== Math.ceil(entry.bytes / CHUNK_BYTES)) return null;
    const basename = path.slice('/fonts/'.length);
    for (let index = 0; index < entry.chunks.length; index++) {
      const chunk = entry.chunks[index];
      const expectedPath = `/fonts/.cloud-parts/${basename}.${entry.sha256}.${String(index).padStart(3, '0')}.part.bin`;
      if (!record(chunk) || !keys(chunk, ['path', 'bytes']) || chunk.path !== expectedPath ||
          chunk.bytes !== Math.min(CHUNK_BYTES, entry.bytes - index * CHUNK_BYTES)) return null;
    }
  }
  return value as unknown as FontManifest;
}

function assetRequest(request: Request, path: string, accept: string): Request {
  // Internal asset requests never inherit cookies, authorization, ranges, queries, or arbitrary manifest URLs.
  return new Request(new URL(path, request.url), { method: 'GET', headers: { Accept: accept, 'Accept-Encoding': 'identity' } });
}

async function manifestFor(request: Request, assets: Fetcher): Promise<FontManifest | null> {
  const existing = cache.get(assets);
  if (existing) return existing;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await assets.fetch(assetRequest(request, MANIFEST_PATH, 'application/json'));
    if (response.status !== 200 || !response.body) { await response.body?.cancel(); return null; }
    const length = response.headers.get('Content-Length');
    if (length && (!/^\d+$/.test(length) || Number(length) > MANIFEST_LIMIT)) { await response.body.cancel(); return null; }
    reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
    let bytes = 0, text = '';
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MANIFEST_LIMIT) { await reader.cancel(); return null; }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    const manifest = parseFontManifest(JSON.parse(text));
    if (manifest) cache.set(assets, manifest);
    return manifest;
  } catch { return null; } finally { reader?.releaseLock(); }
}

function usableChunk(response: Response, chunk: FontParts['chunks'][number]): boolean {
  const length = response.headers.get('Content-Length');
  return response.status === 200 && !!response.body &&
    !response.headers.get('Content-Type')?.toLowerCase().startsWith('text/html') &&
    (!length || (/^\d+$/.test(length) && Number(length) === chunk.bytes));
}

function fontHeaders(font: FontParts): Headers {
  return new Headers({
    'Content-Type': 'font/ttf', 'Content-Length': String(font.bytes),
    ETag: `"sha256-${font.sha256}"`,
    // The original URL is not content-addressed; revalidation must allow later font upgrades.
    'Cache-Control': 'public, max-age=3600, must-revalidate',
    'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'none',
  });
}

export async function fontAssetResponse(request: Request, assets: Fetcher): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!['GET', 'HEAD'].includes(request.method) || !fontPath(path)) return null;
  const manifest = await manifestFor(request, assets);
  const font = manifest?.fonts[path];
  if (!font) return null;
  const headers = fontHeaders(font);
  const etag = headers.get('ETag')!;
  if ((request.headers.get('If-None-Match') ?? '').split(',').some(value => {
    const candidate = value.trim().replace(/^W\//, ''); return candidate === '*' || candidate === etag;
  })) {
    headers.delete('Content-Length');
    return new Response(null, { status: 304, headers });
  }
  if (request.method === 'HEAD') return new Response(null, { headers });
  const first = await assets.fetch(assetRequest(request, font.chunks[0].path, 'application/octet-stream'));
  if (!usableChunk(first, font.chunks[0])) {
    await first.body?.cancel();
    return new Response('Font build asset unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  let index = 0, readBytes = 0, reader = first.body!.getReader(), cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!cancelled) {
          const part = await reader.read();
          if (!part.done) {
            readBytes += part.value.byteLength;
            if (readBytes > font.chunks[index].bytes) throw new Error('Font chunk size mismatch');
            controller.enqueue(part.value);
            return;
          }
          if (readBytes !== font.chunks[index].bytes) throw new Error('Font chunk size mismatch');
          reader.releaseLock();
          if (++index === font.chunks.length) { controller.close(); return; }
          const response = await assets.fetch(assetRequest(request, font.chunks[index].path, 'application/octet-stream'));
          if (cancelled) { await response.body?.cancel(); return; }
          if (!usableChunk(response, font.chunks[index])) { await response.body?.cancel(); throw new Error('Font chunk unavailable'); }
          reader = response.body!.getReader();
          readBytes = 0;
        }
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        if (!cancelled) controller.error(error);
      }
    },
    async cancel(reason) { cancelled = true; await reader.cancel(reason).catch(() => undefined); },
  });
  return new Response(body, { headers });
}
