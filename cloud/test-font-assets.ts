import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { prepareCloudAssets, CLOUD_ASSET_LIMIT, FONT_CHUNK_BYTES } from '../scripts/prepare-cloud-assets.mjs';
import { fontAssetResponse, parseFontManifest, type FontManifest } from './src/font-assets';

let temporary: string;
let dist: string;
let staged: string;
let original: Buffer;
let manifest: FontManifest;
const origin = 'https://font.test';
const fontPath = '/fonts/test-round.ttf';
const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

before(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), 'myresume-cloud-font-tests-'));
  dist = path.join(temporary, 'dist');
  staged = path.join(temporary, 'output', 'cloud-assets');
  await mkdir(path.join(dist, 'fonts'), { recursive: true });
  await mkdir(path.join(temporary, 'public', 'fonts'), { recursive: true });
  original = Buffer.alloc(CLOUD_ASSET_LIMIT + 12345, 37);
  original.set([0, 1, 0, 0], 0);
  await writeFile(path.join(dist, 'fonts', 'test-round.ttf'), original);
  await writeFile(path.join(temporary, 'public', 'fonts', 'test-round.ttf'), original);
  await writeFile(path.join(dist, 'fonts', 'small.ttf'), 'small test font');
  await prepareCloudAssets(dist);
  manifest = JSON.parse(await readFile(path.join(staged, 'cloud-font-parts.json'), 'utf8')) as FontManifest;
});

after(async () => {
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(temporary));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.ok(path.basename(temporary).startsWith('myresume-cloud-font-tests-'));
  await rm(path.resolve(temporary), { recursive: true, force: true });
});

function fileAssets(custom?: { manifest?: unknown; manifestStatus?: number; chunkStatus?: number; actualChunk?: Uint8Array }): { assets: Fetcher; calls: string[] } {
  const calls: string[] = [];
  const assets = { async fetch(request: Request) {
    const url = new URL(request.url);
    calls.push(url.pathname);
    assert.equal(request.headers.get('Cookie'), null);
    assert.equal(request.headers.get('Authorization'), null);
    assert.equal(url.search, '');
    if (url.pathname === '/cloud-font-parts.json' && custom && 'manifest' in custom) {
      return new Response(JSON.stringify(custom.manifest), { status: custom.manifestStatus ?? 200 });
    }
    if (url.pathname.includes('/.cloud-parts/') && custom?.actualChunk) return new Response(custom.actualChunk);
    if (url.pathname.includes('/.cloud-parts/') && custom?.chunkStatus) return new Response('missing', { status: custom.chunkStatus });
    if (url.pathname === '/cloud-font-parts.json' && custom?.manifestStatus) return new Response('missing', { status: custom.manifestStatus });
    try {
      const bytes = await readFile(path.join(staged, '.' + url.pathname));
      return new Response(bytes, { headers: { 'Content-Length': String(bytes.length), 'Content-Type': url.pathname.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
    } catch { return new Response('not found', { status: 404 }); }
  } } as unknown as Fetcher;
  return { assets, calls };
}

describe('lossless build-only Cloudflare font packaging', () => {
  it('reassembles exact original bytes, limits every chunk, leaves public fonts and small TTF intact, and is repeatable', async () => {
    assert.ok(parseFontManifest(manifest));
    const font = manifest.fonts[fontPath];
    assert.equal(font.bytes, original.length); assert.equal(font.sha256, hash(original));
    const chunks = await Promise.all(font.chunks.map(async chunk => {
      const value = await readFile(path.join(staged, '.' + chunk.path));
      assert.equal(value.length, chunk.bytes); assert.ok(value.length <= FONT_CHUNK_BYTES); return value;
    }));
    assert.equal(hash(Buffer.concat(chunks)), hash(original));
    await assert.rejects(stat(path.join(staged, '.' + fontPath)), { code: 'ENOENT' });
    assert.equal(hash(await readFile(path.join(dist, '.' + fontPath))), hash(original));
    assert.equal(hash(await readFile(path.join(temporary, 'public', '.' + fontPath))), hash(original));
    assert.equal(await readFile(path.join(dist, 'fonts', 'small.ttf'), 'utf8'), 'small test font');
    const repeated = await prepareCloudAssets(dist); assert.equal(repeated.fonts, 1); assert.ok(repeated.maxAssetBytes <= CLOUD_ASSET_LIMIT);
    assert.deepEqual(JSON.parse(await readFile(path.join(staged, 'cloud-font-parts.json'), 'utf8')), manifest);
    await assert.rejects(prepareCloudAssets(path.join(temporary, 'public')), /named dist/);
    await assert.rejects(prepareCloudAssets(dist, path.join(temporary, 'public', 'cloud-assets')), /workspace\/output\/cloud-assets/);
  });

  it('streams original GET bytes with stable ETag, and serves HEAD/conditional GET without loading any chunks', async () => {
    const { assets, calls } = fileAssets();
    const get = await fontAssetResponse(new Request(origin + fontPath + '?font-version=1', { headers: { Cookie: 'private-session', Authorization: 'private-token' } }), assets);
    assert.equal(get?.status, 200); assert.equal(get?.headers.get('Content-Type'), 'font/ttf');
    assert.equal(get?.headers.get('Content-Length'), String(original.length));
    assert.equal(hash(new Uint8Array(await get!.arrayBuffer())), hash(original));
    assert.equal(calls.filter(value => value.includes('.part.bin')).length, manifest.fonts[fontPath].chunks.length);
    calls.length = 0;
    const head = await fontAssetResponse(new Request(origin + fontPath, { method: 'HEAD' }), assets);
    assert.equal(head?.status, 200); assert.equal((await head!.arrayBuffer()).byteLength, 0);
    assert.equal(head?.headers.get('Content-Length'), String(original.length)); assert.deepEqual(calls, []);
    const cached = await fontAssetResponse(new Request(origin + fontPath, { headers: { 'If-None-Match': 'W/' + get!.headers.get('ETag') } }), assets);
    assert.equal(cached?.status, 304); assert.deepEqual(calls, []);
  });

  it('returns fallback for missing manifest, unchunked TTF, unknown fonts and unsupported methods', async () => {
    const missing = fileAssets({ manifestStatus: 404 });
    assert.equal(await fontAssetResponse(new Request(origin + fontPath), missing.assets), null);
    const fallback = fileAssets();
    assert.equal(await fontAssetResponse(new Request(origin + '/fonts/small.ttf'), fallback.assets), null);
    assert.equal(await fontAssetResponse(new Request(origin + '/fonts/unknown.ttf'), fallback.assets), null);
    assert.equal((await fallback.assets.fetch(new Request(origin + '/fonts/unknown.ttf'))).status, 404);
    assert.equal(await fontAssetResponse(new Request(origin + fontPath, { method: 'POST' }), fallback.assets), null);
  });

  it('rejects arbitrary part paths, traversal, oversized fonts, excessive manifest entries and unknown fields before fetching parts', async () => {
    const invalid = structuredClone(manifest);
    invalid.fonts[fontPath].chunks[0].path = '/api/auth/me';
    const sample = fileAssets({ manifest: invalid });
    assert.equal(await fontAssetResponse(new Request(origin + fontPath), sample.assets), null);
    assert.deepEqual(sample.calls, ['/cloud-font-parts.json']);
    assert.equal(parseFontManifest({ version: 1, fonts: { '/fonts/../secret.ttf': manifest.fonts[fontPath] } }), null);
    assert.equal(parseFontManifest({ version: 1, fonts: { [fontPath]: { ...manifest.fonts[fontPath], bytes: 257 * 1024 * 1024 } } }), null);
    assert.equal(parseFontManifest({ ...manifest, extra: 'untrusted' }), null);
    const many = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`/fonts/font-${index}.ttf`, manifest.fonts[fontPath]]));
    assert.equal(parseFontManifest({ version: 1, fonts: many }), null);
    const huge = fileAssets({ manifest: { value: 'x'.repeat(129 * 1024) } });
    assert.equal(await fontAssetResponse(new Request(origin + fontPath), huge.assets), null);
    assert.deepEqual(huge.calls, ['/cloud-font-parts.json']);
  });

  it('fails unavailable or incomplete parts instead of returning a successful corrupted font', async () => {
    const missing = fileAssets({ chunkStatus: 404 });
    assert.equal((await fontAssetResponse(new Request(origin + fontPath), missing.assets))?.status, 502);
    const short = fileAssets({ actualChunk: new Uint8Array([1, 2, 3]) });
    const response = await fontAssetResponse(new Request(origin + fontPath), short.assets);
    await assert.rejects(response!.arrayBuffer(), /size mismatch/);
  });
});
