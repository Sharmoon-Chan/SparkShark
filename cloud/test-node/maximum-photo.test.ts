import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createResume } from '../../src/domain/resume';
import type { CloudResumeDocument } from '../../src/cloud/types';
import { createHarness } from './harness';
import { pngAsset } from './photos';

it('accepts and round-trips a valid photo at the documented exact 5 MiB limit', { timeout: 60_000 }, async () => {
  const h = await createHarness();
  try {
    const actor = await h.register('maximum-photo');
    const resume = createResume('Maximum supported photo');
    const photo = pngAsset(5 * 1024 * 1024);
    assert.equal(Buffer.from(photo.dataBase64, 'base64').length, 5 * 1024 * 1024);
    resume.basics.avatarAssetId = photo.id;
    const created = await h.request('/api/resumes', { actor, method: 'POST', body: { resume, assets: [photo] } });
    assert.equal(created.status, 201, (await created.clone().text()) + '\n' + h.diagnostics());
    const uploaded = await created.json() as CloudResumeDocument;
    const fetched = await h.request(`/api/resumes/${resume.id}`, { actor });
    assert.equal(fetched.status, 200);
    const document = await fetched.json() as CloudResumeDocument;
    assert.equal(document.assets[0].dataBase64, photo.dataBase64);
    assert.equal(document.assets[0].sha256, photo.sha256);
    assert.equal(document.byteSize, uploaded.byteSize);
  } finally { await h.dispose(); }
});
