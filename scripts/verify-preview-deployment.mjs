import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const origin = new URL(process.argv[2] ?? 'https://sparkshark.sharmoon.cc.cd').origin;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile('public/fonts/manifest.json', 'utf8'));
const builtIndex = await readFile('dist/index.html', 'utf8');
const expectedScripts = [...builtIndex.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
const report = { origin, verifiedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), scripts: [], fonts: [], samples: [], api: null };
async function request(path, options = {}) {
  const response = await fetch(new URL(path, origin), { ...options, signal: AbortSignal.timeout(120_000) });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response;
}

const html = await (await request('/')).text();
for (const path of expectedScripts) {
  assert.ok(html.includes(path), `Homepage does not serve the built script ${path}`);
  const body = Buffer.from(await (await request(path)).arrayBuffer());
  assert.equal(hash(body), hash(await readFile('dist/' + path.replace(/^\//, ''))), `Script mismatch: ${path}`);
  report.scripts.push({ path, sha256: hash(body), bytes: body.byteLength });
}
const api = await request('/api/auth/me');
assert.match(api.headers.get('content-type') ?? '', /application\/json/);
await api.arrayBuffer();
report.api = { path: '/api/auth/me', status: api.status, cacheControl: api.headers.get('cache-control') };

// HEAD checks cover every new delivery asset. Two full downloads independently
// verify gzip delivery and exact original font bytes across small/large families.
for (const [id, family] of Object.entries(manifest.families)) {
  for (const file of family.files) {
    const path = '/fonts/' + file.compressed.file;
    const response = await request(path, { method: 'HEAD' });
    const cacheControl = response.headers.get('cache-control') ?? '';
    assert.match(cacheControl, /max-age=31536000/);
    assert.match(cacheControl, /immutable/);
    const entry = { id, file: file.file, path, head: response.status, cacheControl };
    if (file.weight === 400 && file.style === 'normal' && ['noto-sans-sc', 'chiron-round-tc'].includes(id)) {
      const packed = Buffer.from(await (await request(path)).arrayBuffer());
      const gzip = packed[0] === 0x1f && packed[1] === 0x8b;
      if (gzip) assert.equal(hash(packed), file.compressed.sha256, `Compressed hash mismatch: ${path}`);
      const original = gzip ? gunzipSync(packed) : packed;
      assert.equal(original.byteLength, file.compressed.originalBytes);
      assert.equal(hash(original), file.sha256, `Original hash mismatch: ${path}`);
      Object.assign(entry, { downloadedBytes: packed.byteLength, originalBytes: original.byteLength, originalSha256: hash(original), exactBytes: true });
    }
    report.fonts.push(entry);
    if (file.preview) {
      const samplePath = '/fonts/' + file.preview.file;
      const sample = await request(samplePath, { method: 'HEAD' });
      assert.match(sample.headers.get('cache-control') ?? '', /immutable/);
      report.samples.push({ path: samplePath, status: sample.status });
    }
  }
  console.log(`Verified ${id}`);
}
await mkdir('output/verification', { recursive: true });
await writeFile('output/verification/preview-deployment.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sourceCommit: report.sourceCommit, scriptHashesMatch: true, fontAssets: report.fonts.length, sampleAssets: report.samples.length, fullFontDownloads: report.fonts.filter(font => font.exactBytes).length, api: report.api.status }));
