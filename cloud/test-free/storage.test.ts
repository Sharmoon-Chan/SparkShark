import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createResume } from '../../src/domain/resume';
import type { CloudResumeDocument } from '../../src/cloud/types';
import { pngAsset } from '../test-node/photos';
import { createHarness } from './harness';

it('round-trips a valid exact-5-MiB photo through real Durable Objects SQLite', { timeout: 120_000 }, async () => {
  const h = await createHarness();
  try {
    const actor = await h.register('maximum-photo');
    const resume = createResume('Durable Object maximum photo'), photo = pngAsset(5 * 1024 * 1024);
    resume.basics.avatarAssetId = photo.id;
    const response = await h.request('/api/resumes', { actor, method: 'POST', body: { resume, assets: [photo] } });
    assert.equal(response.status, 201, await response.clone().text());
    const uploaded = await response.json() as CloudResumeDocument;
    const fetched = await h.request(`/api/resumes/${resume.id}`, { actor });
    assert.equal(fetched.status, 200);
    const saved = await fetched.json() as CloudResumeDocument;
    assert.equal(saved.assets[0].dataBase64, photo.dataBase64);
    assert.equal(saved.assets[0].sha256, photo.sha256);
    assert.equal(saved.byteSize, uploaded.byteSize);
    const blob = await h.db.prepare('SELECT data FROM resume_asset_chunks LIMIT 1').first<{ data: ArrayBuffer }>();
    assert.ok(blob?.data instanceof ArrayBuffer, 'DO SQLite BLOBs must remain binary ArrayBuffers');
    assert.ok(blob.data.byteLength <= 512 * 1024);
  } finally { await h.dispose(); }
});

it('rolls back the actual DO adapter transaction on an image-chunk constraint failure', { timeout: 120_000 }, async () => {
  const h = await createHarness();
  try {
    const actor = await h.register('rollback-user');
    const resume = createResume('Original DO body'), photo = pngAsset(1024);
    resume.basics.avatarAssetId = photo.id;
    const created = await h.request('/api/resumes', { actor, method: 'POST', body: { resume, assets: [photo] } });
    assert.equal(created.status, 201, await created.clone().text());
    const initial = await created.json() as CloudResumeDocument;
    await h.db.prepare(`CREATE TRIGGER test_abort_asset BEFORE INSERT ON resume_asset_chunks
      BEGIN SELECT RAISE(ABORT, 'synthetic constraint failure'); END`).run();
    const replacement = pngAsset(2048);
    const failed = await h.request(`/api/resumes/${resume.id}`, {
      actor, method: 'PUT', body: { resume: { ...resume, title: 'Must be rolled back' }, assets: [replacement], expectedRevision: initial.revision },
    });
    assert.equal(failed.status, 500, await failed.clone().text());
    await h.db.prepare('DROP TRIGGER test_abort_asset').run();
    const fetched = await h.request(`/api/resumes/${resume.id}`, { actor });
    assert.equal(fetched.status, 200);
    const current = await fetched.json() as CloudResumeDocument;
    assert.equal(current.resume.title, initial.resume.title);
    assert.equal(current.revision, initial.revision);
    assert.equal(current.byteSize, initial.byteSize);
    assert.deepEqual(current.assets, initial.assets);
  } finally { await h.dispose(); }
});

it('preserves accounts, sessions, resumes and bootstrap state across DO eviction', { timeout: 120_000 }, async () => {
  const h = await createHarness();
  try {
    await h.bootstrap();
    const actor = await h.register('eviction-user');
    const resume = createResume('Survives local object eviction');
    const response = await h.request('/api/resumes', { actor, method: 'POST', body: { resume, assets: [] } });
    assert.equal(response.status, 201);
    await response.json();
    await h.mf.unsafeEvictDurableObject(h.config.workerName, h.config.className, { name: h.config.objectName });
    const fetched = await h.request(`/api/resumes/${resume.id}`, { actor });
    assert.equal(fetched.status, 200);
    assert.equal((await fetched.json() as CloudResumeDocument).resume.title, resume.title);
    const again = await h.request('/api/admin/bootstrap', { method: 'POST', body: { username: 'another-admin', password: 'Synthetic password 2026!' },
      headers: { 'X-Bootstrap-Token': h.bootstrapToken } });
    assert.equal(again.status, 409);
    assert.equal(await h.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").first<number>('count'), 1);
  } finally { await h.dispose(); }
});
