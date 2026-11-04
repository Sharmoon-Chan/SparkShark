import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResume } from '../domain/resume';
import { repository, sha256 } from '../persistence/repository';
import { adoptSession, invalidateAccount, refreshLinks } from './account';
import { isVisibleToAccount, linkDatabase, type CloudLink } from './links';
import { downloadCloudResume, saveChosenResumes, syncOne, visibleLocalId } from './sync';
import type { CloudResumeDocument, CloudSession } from './types';
const session = (id: string): CloudSession => ({ user: { id, username: id, displayName: id, role: 'user', status: 'active', resumeQuota: 10, resumeCount: 0, storageBytes: 0, createdAt: '2026-11-04T00:00:00.000Z' }, csrfToken: 'csrf-' + id, settings: { registrationOpen: true, defaultResumeQuota: 10, maxResumeBytes: 524288, maxAssetBytes: 5242880 } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const linked = (id: string, overrides: Partial<CloudLink> = {}): CloudLink => ({ localId: id, userId: 'user-a', cloudId: 'cloud-1', cloudRevision: 1, syncedLocalRevision: 0, state: 'synced', error: null, ...overrides });
function mockServer(write: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.endsWith('auth/me')) return json(session('user-a'));
    if (url === '/api/resumes' && (!init.method || init?.method === 'GET')) return json({ resumes: [], used: 0, quota: 10, storageBytes: 0 });
    return write(url, init);
  }); vi.stubGlobal('fetch', fetch); return fetch;
}
beforeEach(async () => {
  invalidateAccount(); await repository.db.open(); await linkDatabase.open();
  await Promise.all([repository.db.resumes.clear(), repository.db.assets.clear(), repository.db.histories.clear(), repository.db.drafts.clear(), linkDatabase.cloudLinks.clear()]);
  adoptSession(session('user-a')); await refreshLinks();
});
afterEach(() => { invalidateAccount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => { await repository.db.delete(); await linkDatabase.delete(); });
describe('explicit cloud saves and account isolation', () => {
  it('never issues a recovery GET as B when an A create-exists error arrives late', async () => {
    const local = createResume('合成账号A迟到回执'); await repository.create(local); let resolve!: (response: Response) => void;
    const fetch = mockServer(() => new Promise<Response>(done => { resolve = done; }));
    const uploading = saveChosenResumes([local], 'cloud'); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    adoptSession(session('user-b')); resolve(json({ error: { code: 'RESUME_EXISTS', message: '已保存' } }, 409));
    expect(await uploading).toEqual({ uploaded: 0, failed: 1 }); expect(fetch.mock.calls).toHaveLength(1); expect(fetch.mock.calls[0][1]?.method).toBe('POST');
  });

  it('keeps original and newly created local resumes offline without creating cloud links', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch); const local = createResume('合成本机简历'); await repository.create(local);
    expect(await saveChosenResumes([local], 'local')).toEqual({ uploaded: 0, failed: 0 }); expect(await syncOne(local.id)).toBe(false);
    expect(await linkDatabase.cloudLinks.count()).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });
  it('uploads an explicitly selected resume and records cloud/local versions separately', async () => {
    const local = createResume('合成云端简历'); await repository.create(local);
    const fetch = mockServer((_url, init) => { const body = JSON.parse(init.body as string); return json({ resume: { ...body.resume, id: 'remote-id' }, assets: body.assets, revision: 7, byteSize: 3000 }); });
    expect(await saveChosenResumes([local], 'cloud')).toEqual({ uploaded: 1, failed: 0 });
    const link = await linkDatabase.cloudLinks.get(local.id); expect(link).toMatchObject({ userId: 'user-a', cloudId: 'remote-id', cloudRevision: 7, syncedLocalRevision: 0, state: 'synced' });
    expect((await repository.get(local.id))?.revision).toBe(0); expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it('recovers a lost create acknowledgement without creating a duplicate cloud resume', async () => {
    const local = createResume('合成丢失回执'); await repository.create(local);
    mockServer((_url, init) => init.method === 'POST' ? json({ error: { code: 'RESUME_EXISTS', message: '已保存' } }, 409) : json({ resume: local, assets: [], revision: 1, byteSize: 3000 }));
    expect(await saveChosenResumes([local], 'cloud')).toEqual({ uploaded: 1, failed: 0 });
    expect(await linkDatabase.cloudLinks.get(local.id)).toMatchObject({ cloudId: local.id, cloudRevision: 1, state: 'synced' });
  });
  it('keeps differing content as a conflict when a create ID already exists remotely', async () => {
    const local = createResume('合成本机内容'); await repository.create(local);
    mockServer((_url, init) => init.method === 'POST' ? json({ error: { code: 'RESUME_EXISTS', message: '已保存' } }, 409) : json({ resume: { ...local, title: '合成另一设备内容' }, assets: [], revision: 2, byteSize: 3000 }));
    expect(await saveChosenResumes([local], 'cloud')).toEqual({ uploaded: 0, failed: 1 });
    expect(await repository.get(local.id)).toEqual(local); expect(await linkDatabase.cloudLinks.get(local.id)).toMatchObject({ cloudId: local.id, state: 'conflict' });
  });
  it('retains a local draft and retryable intent after upload fails', async () => {
    const local = createResume('合成未上传简历'); await repository.create(local); mockServer(() => { throw new Error('offline'); });
    expect(await saveChosenResumes([local], 'cloud')).toEqual({ uploaded: 0, failed: 1 });
    expect(await repository.get(local.id)).toEqual(local); expect(await linkDatabase.cloudLinks.get(local.id)).toMatchObject({ userId: 'user-a', cloudId: null, state: 'error' });
  });
  it('reports partial batch uploads and treats create quota failures as retryable errors', async () => {
    const resumes = [createResume('合成一'), createResume('合成二')]; for (const resume of resumes) await repository.create(resume); let writes = 0;
    mockServer((_url, init) => ++writes === 1 ? json({ resume: JSON.parse(init.body as string).resume, assets: [], revision: 1, byteSize: 3000 }) : json({ error: { code: 'QUOTA_EXCEEDED', message: '配额不足' } }, 409));
    expect(await saveChosenResumes(resumes, 'cloud')).toEqual({ uploaded: 1, failed: 1 });
    expect(await repository.db.resumes.count()).toBe(2); expect((await linkDatabase.cloudLinks.get(resumes[1].id))?.state).toBe('error');
  });
  it('uses CAS and retains the edited local version on a cloud conflict', async () => {
    const local = createResume('原始合成'); await repository.create(local); await linkDatabase.cloudLinks.put(linked(local.id)); await refreshLinks();
    const updated = await repository.save({ ...local, title: '本机修改' }, 0);
    const fetch = mockServer(() => json({ error: { code: 'REVISION_CONFLICT', message: '版本冲突' } }, 409));
    expect(await syncOne(local.id)).toBe(false); expect(await repository.get(local.id)).toEqual(updated);
    expect((await linkDatabase.cloudLinks.get(local.id))?.state).toBe('conflict');
    const put = fetch.mock.calls.find(([, init]) => init?.method === 'PUT')!; expect(JSON.parse(put[1]?.body as string).expectedRevision).toBe(1);
    expect(await syncOne(local.id)).toBe(false); expect(fetch.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
  });
  it('does not upload user A documents as user B, including private local copies', async () => {
    const local = createResume('合成账号A'); await repository.create(local); await linkDatabase.cloudLinks.put(linked(local.id)); await refreshLinks(); adoptSession(session('user-b'));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(visibleLocalId(local.id)).toBe(false); expect(isVisibleToAccount(linked(local.id, { localOnly: true }), 'user-b')).toBe(false);
    expect(await saveChosenResumes([local], 'cloud')).toEqual({ uploaded: 0, failed: 1 }); expect(fetch).not.toHaveBeenCalled();
    expect((await linkDatabase.cloudLinks.get(local.id))?.userId).toBe('user-a');
  });
  it('discards a completed upload after logout and leaves ownership attached to A', async () => {
    const local = createResume('合成延迟上传'); await repository.create(local); let resolve!: (response: Response) => void;
    mockServer(() => new Promise<Response>(done => { resolve = done; }));
    const uploading = saveChosenResumes([local], 'cloud'); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    adoptSession(session('user-b')); resolve(json({ resume: local, assets: [], revision: 1, byteSize: 3000 }));
    expect(await uploading).toEqual({ uploaded: 0, failed: 1 }); expect(visibleLocalId(local.id)).toBe(false); expect((await linkDatabase.cloudLinks.get(local.id))?.userId).toBe('user-a');
  });
  it('binds downloaded data to A before awaiting photos, so a mid-download switch cannot expose it to B', async () => {
    const bytes = new Uint8Array([1, 2, 3]), resume = createResume('合成下载'); resume.basics.avatarAssetId = 'remote-photo';
    const document: CloudResumeDocument = { resume, revision: 2, byteSize: 3000, assets: [{ id: 'remote-photo', mime: 'image/png', width: 1, height: 1, sha256: await sha256(bytes), dataBase64: btoa(String.fromCharCode(...bytes)) }] };
    mockServer(() => json(document));
    const original = repository.addAsset.bind(repository); let release!: () => void;
    vi.spyOn(repository, 'addAsset').mockImplementation(async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return original(...args); });
    const downloading = downloadCloudResume('remote-resume'); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const provisional = await linkDatabase.cloudLinks.toArray(); expect(provisional).toHaveLength(1); expect(provisional[0].userId).toBe('user-a');
    adoptSession(session('user-b')); release(); await expect(downloading).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' }); await refreshLinks();
    const rows = await repository.db.resumes.toArray(); expect(rows).toHaveLength(1); expect(visibleLocalId(rows[0].id)).toBe(false);
    adoptSession(session('user-a')); expect(visibleLocalId(rows[0].id)).toBe(true);
  });
});
