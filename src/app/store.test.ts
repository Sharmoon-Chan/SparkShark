import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createResume } from '../domain/resume';
import { ConflictError, repository } from '../persistence/repository';
import { adoptSession, initializeAccount, invalidateAccount, refreshLinks, useCloud } from '../cloud/account';
import { linkDatabase } from '../cloud/links';
import type { CloudSession } from '../cloud/types';
let useApp: typeof import('./store').useApp;
let receiveLocalChange: typeof import('./store').receiveLocalChange;
const session = (id: string): CloudSession => ({ user: { id, username: id, displayName: id, role: 'user', status: 'active', resumeQuota: 10, resumeCount: 0, storageBytes: 0, createdAt: '2026-11-04T00:00:00.000Z' }, csrfToken: 'csrf-' + id, settings: { registrationOpen: true, defaultResumeQuota: 10, maxResumeBytes: 524288, maxAssetBytes: 5242880 } });
beforeAll(async () => { vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() }); vi.stubGlobal('BroadcastChannel', undefined); const store = await import('./store'); useApp = store.useApp; receiveLocalChange = store.receiveLocalChange; });
beforeEach(async () => {
  await repository.db.open(); await linkDatabase.open();
  await Promise.all([repository.db.resumes.clear(), repository.db.assets.clear(), repository.db.histories.clear(), repository.db.drafts.clear(), linkDatabase.cloudLinks.clear()]);
  adoptSession(session('user-a')); await refreshLinks(); useApp.setState({ records: [], trash: [], current: null, assets: {}, dirty: false, conflict: null });
});
afterEach(() => { invalidateAccount(); vi.restoreAllMocks(); });
afterAll(async () => { await repository.db.delete(); await linkDatabase.delete(); vi.unstubAllGlobals(); });
describe('workspace cloud-cache ownership', () => {
  async function accountDocuments() {
    const a = createResume('合成账号A文档'), b = createResume('合成账号B文档');
    for (const resume of [a, b]) await repository.create(resume);
    for (const [resume, userId] of [[a, 'user-a'], [b, 'user-b']] as const) await linkDatabase.cloudLinks.put({ localId: resume.id, userId, cloudId: resume.id, cloudRevision: 1, syncedLocalRevision: 0, state: 'synced', error: null });
    await refreshLinks(); await useApp.getState().open(a.id); return { a, b };
  }
  it('ignores an A save conflict that arrives after B has opened another document', async () => {
    const { a, b } = await accountDocuments(); let reject!: (reason: unknown) => void;
    vi.spyOn(repository, 'save').mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    useApp.getState().update(resume => { resume.title = '合成账号A未保存修改'; });
    const saving = useApp.getState().flush(); await vi.waitFor(() => expect(reject).toBeTypeOf('function'));
    adoptSession(session('user-b')); await useApp.getState().open(b.id);
    reject(new ConflictError({ ...a, title: '合成账号A冲突正文', revision: 1 })); expect(await saving).toBe(false);
    expect(useApp.getState().current?.id).toBe(b.id); expect(useApp.getState().conflict).toBeNull(); expect(useApp.getState().saveState).toBe('saved');
    expect((await repository.db.drafts.toArray()).some(draft => draft.resume.id === a.id && draft.resume.title === '合成账号A未保存修改')).toBe(true);
  });
  it('does not apply A conflict resolution assets or current after switching to B', async () => {
    const { a, b } = await accountDocuments(); useApp.setState({ conflict: { ...a, revision: 1 }, saveState: 'conflict' });
    const original = repository.assetsFor.bind(repository); let release!: () => void;
    vi.spyOn(repository, 'assetsFor').mockImplementation(async resume => { if (resume.id === a.id) await new Promise<void>(resolve => { release = resolve; }); return original(resume); });
    const resolving = useApp.getState().resolveConflict('latest'); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    adoptSession(session('user-b')); await useApp.getState().open(b.id); release();
    expect(await resolving).toBeNull(); expect(useApp.getState().current?.id).toBe(b.id); expect(useApp.getState().assets).toEqual({}); expect(useApp.getState().conflict).toBeNull();
  });
  it('retains an A conflict copy privately but does not open it after switching to B', async () => {
    const { a, b } = await accountDocuments(); useApp.setState({ conflict: { ...a, revision: 1 }, saveState: 'conflict' });
    const original = repository.create.bind(repository); let release!: () => void;
    vi.spyOn(repository, 'create').mockImplementation(async resume => { await new Promise<void>(resolve => { release = resolve; }); return original(resume); });
    const resolving = useApp.getState().resolveConflict('copy'); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    adoptSession(session('user-b')); await useApp.getState().open(b.id); release(); expect(await resolving).toBeNull();
    expect(useApp.getState().current?.id).toBe(b.id); expect(useApp.getState().records.every(row => row.id === b.id)).toBe(true);
    const copies = (await linkDatabase.cloudLinks.toArray()).filter(link => link.localOnly); expect(copies).toHaveLength(1); expect(copies[0].userId).toBe('user-a');
  });
  it('suppresses a broadcast asset result when its original editor is no longer active', async () => {
    const { a, b } = await accountDocuments(); await repository.save({ ...a, title: '合成广播新版本' }, 0);
    const original = repository.assetsFor.bind(repository); let release!: () => void;
    vi.spyOn(repository, 'assetsFor').mockImplementation(async resume => { if (resume.id === a.id) await new Promise<void>(resolve => { release = resolve; }); return original(resume); });
    const broadcast = receiveLocalChange({ clientId: 'synthetic-other-tab', id: a.id, revision: 1 }); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    adoptSession(session('user-b')); await useApp.getState().open(b.id); release(); await broadcast;
    expect(useApp.getState().current?.id).toBe(b.id); expect(useApp.getState().assets).toEqual({}); expect(useApp.getState().conflict).toBeNull();
  });
  it('hides persistent data when the ownership index fails and restores safe access after retry', async () => {
    const local = createResume('合成本机可见'), cached = createResume('合成账号A缓存'); await repository.create(local); await repository.create(cached);
    await linkDatabase.cloudLinks.put({ localId: cached.id, userId: 'user-a', cloudId: cached.id, cloudRevision: 1, syncedLocalRevision: 0, state: 'synced', error: null });
    invalidateAccount(); useCloud.setState({ ready: false, ownershipReady: false, links: {} });
    const broken = vi.spyOn(linkDatabase.cloudLinks, 'toArray').mockRejectedValue(new Error('synthetic ownership index failure'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ...session('user-a'), user: null, csrfToken: null }))));
    await initializeAccount(); expect(useCloud.getState()).toMatchObject({ ready: true, ownershipReady: true }); expect(useCloud.getState().ownershipError).toBeTruthy();
    await useApp.getState().refresh(); expect(useApp.getState().records).toEqual([]); await useApp.getState().open(cached.id); expect(useApp.getState().current).toBeNull(); expect(await repository.db.resumes.count()).toBe(2);
    broken.mockRestore(); await refreshLinks(); await useApp.getState().refresh(); expect(useCloud.getState().ownershipError).toBeNull(); expect(useApp.getState().records.map(row => row.id)).toEqual([local.id]);
  });
  it('finishes session initialization before opening an owned cache on a refreshed route', async () => {
    const { a } = await accountDocuments(); invalidateAccount(); useCloud.setState({ ready: false });
    let resolve!: (response: Response) => void; vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const initialization = initializeAccount(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    expect(useCloud.getState()).toMatchObject({ ready: false, ownershipReady: true }); expect(useApp.getState().current).toBeNull();
    resolve(new Response(JSON.stringify(session('user-a')))); await initialization; expect(useCloud.getState().ready).toBe(true);
    await useApp.getState().open(a.id); expect(useApp.getState().current?.id).toBe(a.id);
  });

  it('clears an A editor immediately on logout and keeps pure local resumes visible', async () => {
    const local = createResume('合成原有本机'), cached = createResume('合成账号A缓存'); await repository.create(local); await repository.create(cached);
    await linkDatabase.cloudLinks.put({ localId: cached.id, userId: 'user-a', cloudId: 'remote-a', cloudRevision: 1, syncedLocalRevision: 0, state: 'synced', error: null }); await refreshLinks();
    await useApp.getState().refresh(); await useApp.getState().open(cached.id);
    expect(useApp.getState().current?.id).toBe(cached.id);
    useApp.getState().update(resume => { resume.title = '合成尚未保存的修改'; }); invalidateAccount();
    expect(useApp.getState().current).toBeNull(); expect(useApp.getState().assets).toEqual({}); expect(useApp.getState().records.map(row => row.id)).toEqual([local.id]);
    await vi.waitFor(async () => expect((await repository.db.drafts.toArray()).some(draft => draft.resume.id === cached.id && draft.resume.title === '合成尚未保存的修改')).toBe(true));
    adoptSession(session('user-b')); await useApp.getState().open(cached.id);
    expect(useApp.getState().current).toBeNull(); expect(await repository.get(cached.id)).not.toBeNull();
    adoptSession(session('user-a')); await useApp.getState().open(cached.id); expect(useApp.getState().current?.id).toBe(cached.id);
  });
  it('filters another account cloud cache from backups and trash data supplied to the UI', async () => {
    const a = createResume('合成账号A回收站'), b = createResume('合成账号B本地缓存'), local = createResume('合成本机');
    for (const resume of [a, b, local]) await repository.create(resume); await repository.trash(a.id);
    for (const [resume, userId] of [[a, 'user-a'], [b, 'user-b']] as const) await linkDatabase.cloudLinks.put({ localId: resume.id, userId, cloudId: resume.id, cloudRevision: 1, syncedLocalRevision: 0, state: 'synced', error: null });
    await refreshLinks(); adoptSession(session('user-b')); await useApp.getState().refresh();
    expect(useApp.getState().trash).toEqual([]); expect(useApp.getState().records.map(row => row.id).sort()).toEqual([b.id, local.id].sort());
    await useApp.getState().open(a.id); expect(useApp.getState().current).toBeNull();
  });
});
