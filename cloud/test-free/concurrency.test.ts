import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createResume } from '../../src/domain/resume';
import type { CloudResumeDocument, CloudResumeList } from '../../src/cloud/types';
import { pngAsset } from '../test-node/photos';
import { createHarness, origin } from './harness';

async function deadline<T>(operation: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer!); }
}

it('processes six simultaneous maximum-size photo uploads without corrupting data', { timeout: 120_000 }, async () => {
  const h = await createHarness();
  try {
    const actor = await h.register('concurrent-photos');
    const photo = pngAsset(5 * 1024 * 1024);
    const documents = await Promise.all(Array.from({ length: 6 }, async (_, index) => {
      const resume = createResume(`Concurrent maximum photo ${index}`);
      resume.basics.avatarAssetId = photo.id;
      const response = await h.request('/api/resumes', { actor, method: 'POST', body: { resume, assets: [photo] } });
      assert.equal(response.status, 201, await response.clone().text());
      const saved = await response.json() as CloudResumeDocument;
      assert.equal(saved.assets[0].dataBase64, photo.dataBase64);
      assert.equal(saved.assets[0].sha256, photo.sha256);
      return { id: saved.resume.id, byteSize: saved.byteSize };
    }));
    assert.equal(new Set(documents.map(document => document.id)).size, 6);
    const listed = await h.request('/api/resumes', { actor });
    assert.equal(listed.status, 200);
    const list = await listed.json() as CloudResumeList;
    assert.equal(list.used, 6);
    assert.equal(list.storageBytes, documents.reduce((sum, document) => sum + document.byteSize, 0));
    for (const document of documents) {
      const response = await h.request(`/api/resumes/${document.id}`, { actor });
      assert.equal(response.status, 200);
      const stored = await response.json() as CloudResumeDocument;
      assert.equal(stored.assets[0].dataBase64, photo.dataBase64);
      assert.equal(stored.assets[0].sha256, photo.sha256);
    }
  } finally { await h.dispose(); }
});

it('bounds the waiting queue and remains usable after an active upload is cancelled', { timeout: 60_000 }, async () => {
  const h = await createHarness();
  const controller = new AbortController();
  let producer: ReadableStreamDefaultController<Uint8Array>;
  let active: Promise<unknown> | undefined;
  const pending: Promise<{ status: number; body: unknown }>[] = [];
  try {
    const actor = await h.register('cancelled-upload');
    const body = new ReadableStream<Uint8Array>({
      start(stream) { producer = stream; stream.enqueue(new TextEncoder().encode('{"resume":')); },
    });
    active = h.mf.dispatchFetch(origin + '/api/resumes', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: actor.cookie, 'X-CSRF-Token': actor.csrf },
      body, duplex: 'half', signal: controller.signal,
    }).then(async (response: Response) => ({ status: response.status, body: await response.json() })).catch((error: unknown) => error);
    // Give the first request time to enter its intentionally incomplete body read.
    await new Promise(resolve => setTimeout(resolve, 150));
    for (let index = 0; index < 9; index++) pending.push(h.request('/api/auth/me', { actor })
      .then(async response => ({ status: response.status, body: await response.json() })).catch(() => ({ status: 0, body: null })));
    const busy = await deadline(Promise.any(pending), 3000, 'A full queue did not reject promptly');
    assert.equal(busy.status, 503, JSON.stringify(busy.body));
    controller.abort();
    await active;
    const completed = await deadline(Promise.all(pending), 5000, 'Cancelled upload did not release admission');
    assert.equal(completed.filter(response => response.status === 503).length, 1);
    assert.equal(completed.filter(response => response.status === 200).length, 8);
    const next = await h.request('/api/auth/me', { actor });
    assert.equal(next.status, 200);
    await next.json();
  } finally {
    controller.abort();
    try { producer!.close(); } catch { /* The producer may be closed or never initialized. */ }
    await h.dispose();
    await Promise.allSettled([...pending, ...(active ? [active] : [])]);
  }
});

it('releases admission when a maximum-size outgoing response is cancelled', { timeout: 60_000 }, async () => {
  const h = await createHarness();
  try {
    const actor = await h.register('cancelled-response');
    const resume = createResume('Cancelled outgoing response'), photo = pngAsset(5 * 1024 * 1024);
    resume.basics.avatarAssetId = photo.id;
    const created = await h.request('/api/resumes', { actor, method: 'POST', body: { resume, assets: [photo] } });
    assert.equal(created.status, 201);
    await created.json();
    const outgoing = await h.request(`/api/resumes/${resume.id}`, { actor });
    assert.equal(outgoing.status, 200);
    await outgoing.body!.cancel();
    const next = await deadline(h.request('/api/auth/me', { actor }), 5000, 'Cancelled response did not release admission');
    assert.equal(next.status, 200);
    await next.json();
  } finally { await h.dispose(); }
});
