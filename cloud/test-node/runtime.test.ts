import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createResume } from '../../src/domain/resume';
import type { CloudResumeDocument } from '../../src/cloud/types';
import { createHarness } from './harness';
import { pngAsset } from './photos';
import { configuration } from '../node/server';

it('binds the actual HTTP listener only to loopback', { timeout: 60_000 }, async () => {
  const h = await createHarness();
  try {
    assert.equal(h.address.address, '127.0.0.1');
    assert.ok(h.address.port > 0);
    const response = await h.request('/api/auth/me');
    assert.equal(response.status, 200);
    assert.ok(h.baseUrl.startsWith('http://127.0.0.1:'));
    assert.throws(() => configuration({ LISTEN_HOST: '0.0.0.0' }), /loopback/);
    assert.throws(() => configuration({ LISTEN_HOST: '::' }), /loopback/);
    assert.throws(() => configuration({ LISTEN_HOST: '192.0.2.1' }), /loopback/);
  } finally { await h.dispose(); }
});

it('rolls back SQLite batches and preserves BLOBs as native binary buffers', { timeout: 60_000 }, async () => {
  const h = await createHarness();
  try {
    await h.db.prepare('CREATE TABLE test_rollback (id TEXT PRIMARY KEY, value INTEGER NOT NULL)').run();
    await h.db.prepare("INSERT INTO test_rollback VALUES ('baseline', 0)").run();
    await assert.rejects(h.db.batch([
      h.db.prepare("UPDATE test_rollback SET value = 1 WHERE id = 'baseline'"),
      h.db.prepare("INSERT INTO test_rollback VALUES ('baseline', 99)"),
    ]));
    assert.equal(await h.db.prepare("SELECT value FROM test_rollback WHERE id = 'baseline'").first<number>('value'), 0);
    await h.db.prepare('CREATE TABLE test_binary (data BLOB NOT NULL)').run();
    const binary = new Uint8Array([0, 1, 127, 128, 255]);
    await h.db.prepare('INSERT INTO test_binary VALUES (?)').bind(binary).run();
    const read = await h.db.prepare('SELECT data FROM test_binary').first<{ data: Uint8Array }>();
    assert.ok(read?.data instanceof Uint8Array, 'Binary blobs must not expand into JS number arrays');
    assert.deepEqual(read.data, binary);
  } finally { await h.dispose(); }
});

it('rolls back body and image replacement when a real image-chunk write fails', { timeout: 60_000 }, async () => {
  const h = await createHarness();
  try {
    const actor = await h.register('rollbackuser');
    const resume = createResume('Original before failed transaction'), photo = pngAsset(1024);
    resume.basics.avatarAssetId = photo.id;
    const created = await h.request('/api/resumes', { actor, method: 'POST', body: { resume, assets: [photo] } });
    assert.equal(created.status, 201, await created.clone().text());
    const before = await created.json() as CloudResumeDocument;
    await h.db.prepare(`CREATE TRIGGER test_abort_asset BEFORE INSERT ON resume_asset_chunks
      BEGIN SELECT RAISE(ABORT, 'synthetic integration failure'); END`).run();
    const changed = { ...resume, title: 'Should never replace original' };
    const replacement = pngAsset(2048);
    const failed = await h.request(`/api/resumes/${resume.id}`, {
      actor, method: 'PUT', body: { resume: changed, assets: [replacement], expectedRevision: before.revision },
    });
    assert.equal(failed.status, 500, await failed.clone().text());
    await h.db.prepare('DROP TRIGGER test_abort_asset').run();
    const fetched = await h.request(`/api/resumes/${resume.id}`, { actor });
    assert.equal(fetched.status, 200);
    const after = await fetched.json() as CloudResumeDocument;
    assert.equal(after.resume.title, before.resume.title);
    assert.equal(after.revision, before.revision);
    assert.equal(after.byteSize, before.byteSize);
    assert.deepEqual(after.assets, before.assets);
    assert.equal(await h.db.prepare('SELECT COUNT(*) AS count FROM resumes').first<number>('count'), 1);
  } finally { await h.dispose(); }
});
