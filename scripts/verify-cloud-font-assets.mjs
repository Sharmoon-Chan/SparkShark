import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const origin = process.argv[2] ?? 'http://127.0.0.1:8789';
const manifest = JSON.parse(await readFile('output/cloud-assets/cloud-font-parts.json', 'utf8'));
const checks = [];
for (const [path, font] of Object.entries(manifest.fonts)) {
  const response = await fetch(new URL(path, origin));
  assert.equal(response.status, 200, path);
  assert.equal(response.headers.get('Content-Type'), 'font/ttf', path);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.byteLength; hash.update(chunk); }
  assert.equal(bytes, font.bytes, path);
  assert.equal(hash.digest('hex'), font.sha256, path);
  const head = await fetch(new URL(path, origin), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('Content-Length')), bytes);
  const unchanged = await fetch(new URL(path, origin), { headers: { 'If-None-Match': response.headers.get('ETag') } });
  assert.equal(unchanged.status, 304);
  checks.push({ path, bytes, sha256: font.sha256, get: 200, head: 200, etag: 304 });
}
await mkdir('output/verification', { recursive: true });
await writeFile('output/verification/cloud-font-http.json', JSON.stringify({ origin, checks }, null, 2));
console.log(JSON.stringify({ verifiedFonts: checks.length, allBytesAndHashesMatch: true }));
