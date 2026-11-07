// Read-only acceptance against a local Wrangler server serving the prepared build.
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const origin = process.argv[2] ?? 'http://127.0.0.1:4175';
if (new URL(origin).hostname !== '127.0.0.1') throw new Error('Use the isolated local Worker');
const stage = path.resolve('output/cloud-assets');
async function tree(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Unexpected build symlink');
    if (entry.isDirectory()) result.push(...await tree(filename));
    else result.push({ file: path.relative(stage, filename).replaceAll('\\', '/'), bytes: (await stat(filename)).size });
  }
  return result;
}
const files = await tree(stage), index = await readFile(path.join(stage, 'index.html'), 'utf8');
const entry = index.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
if (!entry) throw new Error('Entry asset missing');
const catalog = JSON.parse(await readFile(path.join(stage, 'fonts/browser-manifest.json'), 'utf8'));
const firstFamily = catalog.families['noto-sans-sc'];
const responses = [];
for (const resource of ['/', entry, '/fonts/browser/' + firstFamily.faces[0].parts[0].file.split('/').at(-1), '/fonts/browser-manifests/noto-sans-sc.json', '/api/auth/me']) {
  const response = await fetch(new URL(resource, origin));
  if (!response.ok) throw new Error(`${resource}: ${response.status}`);
  const cache = response.headers.get('cache-control') ?? '';
  const immutable = resource.startsWith('/assets/') || resource.startsWith('/fonts/browser/');
  if (immutable && !/max-age=31536000.*immutable/.test(cache)) throw new Error('Missing immutable caching: ' + resource);
  if (!immutable && /immutable/.test(cache)) throw new Error('Unversioned resource cached permanently: ' + resource);
  if (resource === '/api/auth/me') {
    const account = await response.json();
    if (account.user !== null || !cache.includes('no-store')) throw new Error('Expected uncached anonymous local account');
  } else await response.arrayBuffer();
  responses.push({ resource, status: response.status, cacheControl: cache, contentType: response.headers.get('content-type'), nosniff: response.headers.get('x-content-type-options') });
}
const metadata = [];
for (const [id, family] of Object.entries(catalog.families)) {
  const bytes = await readFile(path.join(stage, 'fonts/browser-manifests', id + '.json'));
  const split = JSON.parse(bytes);
  if (JSON.stringify(split.families) !== JSON.stringify({ [id]: family })) throw new Error('Family catalog differs: ' + id);
  metadata.push({ id, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, brotliBytes: brotliCompressSync(bytes).length });
}
let verifiedFontParts = 0;
for (const family of Object.values(catalog.families)) for (const face of family.faces) for (const part of face.parts) {
  const bytes = await readFile(path.join(stage, 'fonts', part.file));
  if (bytes.length !== part.bytes || createHash('sha256').update(bytes).digest('hex') !== part.sha256) throw new Error('Font part mismatch: ' + part.file);
  verifiedFontParts++;
}
const largest = files.reduce((a, b) => a.bytes > b.bytes ? a : b);
if (largest.bytes > 25 * 1024 * 1024) throw new Error('Asset exceeds the Cloudflare per-file limit');
const summary = { date: '2026-11-07', environment: 'isolated local Wrangler, no deployment', files: files.length, totalBytes: files.reduce((n, item) => n + item.bytes, 0), largest, responses, metadata, verifiedFontParts };
await mkdir('output/stage4', { recursive: true });
await writeFile('output/stage4/delivery-report.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
