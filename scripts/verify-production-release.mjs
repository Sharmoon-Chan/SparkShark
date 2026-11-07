// Verify the deployed build and font delivery without account/resume writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const origin = new URL(process.argv[2] ?? 'https://sparkshark.sharmoon.cc.cd').origin;
const output = process.argv[3] ?? 'output/release-2026-11-07/http-verification.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const catalog = JSON.parse(await readFile('public/fonts/browser-manifest.json', 'utf8'));
const pdfFonts = JSON.parse(await readFile('public/fonts/manifest.json', 'utf8'));
const expectedHtml = await readFile('dist/index.html', 'utf8');
const report = { origin, startedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), scripts: [], catalogs: [], fontHeads: [], fontDownloads: [], templates: [], pdfFontHeads: [], api: null };
async function request(resource, method = 'GET') {
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(new URL(resource, origin), { method, signal: AbortSignal.timeout(60_000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`${resource}: HTTP ${response.status}`); }
      return response;
    } catch (error) { failure = error; }
  }
  throw failure;
}
async function parallel(items, work, limit = 6) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const index = next++; await work(items[index], index); } }));
}
function immutable(response, resource) { assert.match(response.headers.get('cache-control') ?? '', /max-age=31536000.*immutable/, resource); }
const homepage = await request('/');
const html = await homepage.text();
assert.doesNotMatch(homepage.headers.get('cache-control') ?? '', /immutable/);
const scriptPaths = [...expectedHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
assert.ok(scriptPaths.length);
for (const resource of scriptPaths) {
  assert.ok(html.includes(resource), `Homepage is not serving the release script: ${resource}`);
  const response = await request(resource); immutable(response, resource);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(hash(bytes), hash(await readFile('dist' + resource)), 'Deployed script differs from local build');
  report.scripts.push({ resource, bytes: bytes.length, sha256: hash(bytes), cacheControl: response.headers.get('cache-control') });
}
const api = await request('/api/auth/me'); const user = await api.json();
assert.equal(user.user, null); assert.match(api.headers.get('cache-control') ?? '', /no-store/);
report.api = { status: api.status, anonymous: true, cacheControl: api.headers.get('cache-control') };
await parallel(Object.entries(catalog.families), async ([id, family]) => {
  const resource = `/fonts/browser-manifests/${id}.json`;
  const response = await request(resource), bytes = Buffer.from(await response.arrayBuffer());
  const actual = JSON.parse(bytes);
  assert.deepEqual(actual.families, { [id]: family });
  assert.doesNotMatch(response.headers.get('cache-control') ?? '', /immutable/);
  report.catalogs.push({ id, resource, bytes: bytes.length, sha256: hash(bytes), cacheControl: response.headers.get('cache-control') });
});
const parts = Object.values(catalog.families).flatMap(family => family.faces.flatMap(face => face.parts));
const unique = [...new Map(parts.map(part => [part.file, part])).values()];
let done = 0;
await parallel(unique, async part => {
  const resource = '/fonts/' + part.file, response = await request(resource, 'HEAD');
  immutable(response, resource); assert.match(response.headers.get('content-type') ?? '', /font\/woff2/);
  const length = response.headers.get('content-length'); if (length) assert.equal(Number(length), part.bytes, resource);
  report.fontHeads.push({ resource, status: response.status, expectedBytes: part.bytes });
  done++; if (done % 100 === 0 || done === unique.length) console.log(`Verified ${done}/${unique.length} browser font assets`);
});
const samples = Object.entries(catalog.families).flatMap(([id, family]) => family.faces.filter(face => face.style === 'normal').map(face => ({ id, weight: face.weight, part: face.parts.find(part => part.chunk === 'base') ?? face.parts[0] })));
await parallel(samples, async ({ id, weight, part }) => {
  const resource = '/fonts/' + part.file, response = await request(resource), bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length, part.bytes); assert.equal(hash(bytes), part.sha256);
  report.fontDownloads.push({ id, weight, resource, bytes: bytes.length, sha256: hash(bytes) });
});
const templates = (await readdir('dist/assets')).filter(name => name.endsWith('.webp'));
await parallel(templates, async name => {
  const resource = '/assets/' + name, response = await request(resource), bytes = Buffer.from(await response.arrayBuffer());
  immutable(response, resource); assert.equal(hash(bytes), hash(await readFile('dist' + resource)));
  report.templates.push({ resource, bytes: bytes.length, sha256: hash(bytes) });
});
await parallel(Object.values(pdfFonts.families).flatMap(family => family.files), async file => {
  const resource = '/fonts/' + file.compressed.file, response = await request(resource, 'HEAD');
  immutable(response, resource); assert.doesNotMatch(response.headers.get('content-type') ?? '', /text\/html/);
  report.pdfFontHeads.push({ resource, status: response.status });
});
report.completedAt = new Date().toISOString();
for (const key of ['catalogs', 'fontHeads', 'fontDownloads', 'templates', 'pdfFontHeads']) report[key].sort((a, b) => a.resource.localeCompare(b.resource));
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sourceCommit: report.sourceCommit, scriptHashesMatch: true, catalogs: report.catalogs.length, fontHeads: report.fontHeads.length, exactFontDownloads: report.fontDownloads.length, templates: report.templates.length, pdfFonts: report.pdfFontHeads.length, api: report.api, output }));
