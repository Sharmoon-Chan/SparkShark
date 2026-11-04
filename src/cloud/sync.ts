import type { Resume } from '../domain/types';
import { parseResume, remapResume, uid } from '../domain/resume';
import { base64ToBytes, bytesBlob, contentHash, repository, sha256 } from '../persistence/repository';
import { CloudApiError, request } from './api';
import { accountRequest, accountScope, assertScope, promptLogin, refreshCloudList, refreshLinks, useCloud } from './account';
import { isVisibleToAccount, linkDatabase, type CloudLink } from './links';
import { onLocalResumeSaved } from './events';
import type { CloudResumeDocument } from './types';
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const operations = new Map<string, Promise<boolean>>();
let installed = false;
export function installCloudSync() {
  if (installed) return; installed = true;
  onLocalResumeSaved(scheduleCloudSync);
  useCloud.subscribe((state, previous) => {
    if (state.epoch !== previous.epoch) {
      for (const timer of timers.values()) clearTimeout(timer); timers.clear();
      if (state.user) void refreshLinks().then(() => resumeAssociatedSync()).catch(() => undefined);
      if (state.user) void refreshCloudList().catch(() => undefined);
    }
  });
  if (typeof window !== 'undefined') window.addEventListener('online', resumeAssociatedSync);
}
export function resumeAssociatedSync() {
  const state = useCloud.getState();
  for (const link of Object.values(state.links)) if (!link.localOnly && link.userId === state.user?.id && link.state !== 'conflict') scheduleCloudSync(link.localId);
}
export function scheduleCloudSync(localId: string) {
  const state = useCloud.getState(), link = state.links[localId];
  if (!state.user || !link || link.localOnly || link.userId !== state.user.id || link.state === 'conflict') return;
  clearTimeout(timers.get(localId)); timers.set(localId, setTimeout(() => { timers.delete(localId); void syncOne(localId); }, 900));
}
async function writeLink(link: CloudLink) { await linkDatabase.cloudLinks.put(link); await refreshLinks(); }
export async function syncOne(localId: string): Promise<boolean> {
  const running = operations.get(localId); if (running) { await running; return syncOne(localId); }
  const scope = accountScope();
  const operation = (async () => {
    const link = await linkDatabase.cloudLinks.get(localId);
    if (!scope.userId || !link || link.localOnly || link.userId !== scope.userId || link.state === 'conflict') return false;
    assertScope(scope);
    const row = await repository.db.resumes.get(localId); if (!row || row.status !== 'active') return false;
    if (link.cloudId && row.revision === link.syncedLocalRevision) { if (link.state !== 'synced') await writeLink({ ...link, state: 'synced', error: null }); return true; }
    await writeLink({ ...link, state: 'syncing', error: null });
    try {
      const backup = await repository.exportBackup([row.resume], false);
      assertScope(scope);
      const resume = structuredClone(row.resume); if (link.cloudId) resume.id = link.cloudId;
      const settings = useCloud.getState().settings;
      if (new TextEncoder().encode(JSON.stringify(resume)).length > settings.maxResumeBytes) throw new Error('简历正文超过云端大小限制，请精简后重试。本机内容已保留。');
      if (backup.assets.some(asset => base64ToBytes(asset.dataBase64).byteLength > settings.maxAssetBytes)) throw new Error('照片超过云端大小限制，请缩小后重试。本机内容已保留。');
      let document: CloudResumeDocument;
      try {
        document = await request<CloudResumeDocument>('resumes' + (link.cloudId ? '/' + encodeURIComponent(link.cloudId) : ''), { method: link.cloudId ? 'PUT' : 'POST', body: { resume, assets: backup.assets, ...(link.cloudId ? { expectedRevision: link.cloudRevision } : {}) }, csrf: scope.csrf, signal: scope.signal });
      } catch (error) {
        if (link.cloudId || !(error instanceof CloudApiError) || error.code !== 'RESUME_EXISTS') throw error;
        assertScope(scope);
        document = await accountRequest<CloudResumeDocument>('resumes/' + encodeURIComponent(resume.id), 'GET', undefined, scope); assertScope(scope);
        if (await contentHash(document.resume) !== await contentHash(resume) || backup.assets.some(asset => !document.assets.some(remote => remote.id === asset.id && remote.sha256 === asset.sha256))) {
          await writeLink({ ...link, cloudId: document.resume.id, cloudRevision: document.revision, state: 'conflict', error: '云端已有不同版本，本机内容已保留。请处理冲突后继续。' });
          return false;
        }
      }
      assertScope(scope);
      const currentLink = await linkDatabase.cloudLinks.get(localId); if (!currentLink || currentLink.userId !== scope.userId || currentLink.cloudId !== link.cloudId) return false;
      const newest = await repository.db.resumes.get(localId);
      await writeLink({ ...link, cloudId: document.resume.id, cloudRevision: document.revision, syncedLocalRevision: row.revision, state: newest?.revision === row.revision ? 'synced' : 'pending', error: null });
      assertScope(scope); await refreshCloudList().catch(() => undefined);
      if (newest?.revision !== row.revision) scheduleCloudSync(localId);
      return true;
    } catch (error) {
      if (scope.epoch !== useCloud.getState().epoch || scope.signal.aborted) return false;
      const currentLink = await linkDatabase.cloudLinks.get(localId); if (!currentLink || currentLink.userId !== scope.userId || currentLink.cloudId !== link.cloudId) return false;
      await writeLink({ ...link, state: link.cloudId && error instanceof CloudApiError && error.status === 409 ? 'conflict' : 'error', error: error instanceof Error ? error.message : '云端保存失败，本机内容已保留' });
      return false;
    }
  })();
  operations.set(localId, operation);
  try { return await operation; } catch { return false; } finally { if (operations.get(localId) === operation) operations.delete(localId); }
}
export type StorageLocation = 'local' | 'cloud';
export async function saveChosenResumes(resumes: Resume[], location: StorageLocation, intendedUserId: string | null = useCloud.getState().user?.id ?? null): Promise<{ uploaded: number; failed: number }> {
  if (location === 'local') return { uploaded: 0, failed: 0 };
  for (const resume of resumes) if (!(await linkDatabase.cloudLinks.get(resume.id))) await linkDatabase.cloudLinks.put({ localId: resume.id, userId: intendedUserId, cloudId: null, cloudRevision: 0, syncedLocalRevision: -1, state: 'pending', error: '云端未保存；本机草稿已保留，请登录所属账号重试' });
  await refreshLinks();
  if (intendedUserId && useCloud.getState().user?.id !== intendedUserId) return { uploaded: 0, failed: resumes.length };
  const user = await promptLogin(); if (!user) return { uploaded: 0, failed: resumes.length };
  const scope = accountScope(); let uploaded = 0;
  for (const resume of resumes) {
    if (scope.epoch !== useCloud.getState().epoch) break;
    const link = await linkDatabase.cloudLinks.get(resume.id);
    if (link?.userId && link.userId !== user.id) continue;
    await writeLink({ ...(link ?? { localId: resume.id, cloudId: null, cloudRevision: 0, syncedLocalRevision: -1 }), userId: user.id, localOnly: false, state: link?.state === 'conflict' ? 'conflict' : 'pending', error: null });
    if (await syncOne(resume.id)) uploaded++;
  }
  return { uploaded, failed: resumes.length - uploaded };
}
export async function retryCloudSave(localId: string) {
  const row = await repository.db.resumes.get(localId); if (!row || row.status !== 'active') throw new Error('请先从本机回收站恢复简历');
  return saveChosenResumes([row.resume], 'cloud');
}
export function visibleLocalId(localId: string) { const state = useCloud.getState(); return state.ownershipReady && !state.ownershipError && isVisibleToAccount(state.links[localId], state.user?.id ?? null); }
async function materialize(document: CloudResumeDocument, localId?: string): Promise<Resume> {
  const resume = parseResume(structuredClone(document.resume));
  for (const asset of document.assets) {
    const bytes = base64ToBytes(asset.dataBase64); if (await sha256(bytes) !== asset.sha256) throw new Error('云端照片校验失败');
    const localAsset = await repository.addAsset(bytesBlob(bytes, asset.mime), asset.width, asset.height);
    if (resume.basics.avatarAssetId === asset.id) resume.basics.avatarAssetId = localAsset.id;
  }
  if (resume.basics.avatarAssetId && !(await repository.db.assets.get(resume.basics.avatarAssetId))) throw new Error('云端简历缺少照片');
  resume.id = localId ?? uid('resume');
  const row = localId ? await repository.db.resumes.get(localId) : undefined;
  resume.revision = row?.revision ?? 0;
  return row ? repository.save(resume, row.revision) : repository.create(resume);
}
export async function downloadCloudResume(cloudId: string, preserveLocal = false): Promise<string> {
  const scope = accountScope(); if (!scope.userId) throw new Error('请先登录');
  const document = await accountRequest<CloudResumeDocument>('resumes/' + encodeURIComponent(cloudId)); assertScope(scope);
  const link = await linkDatabase.cloudLinks.where('[userId+cloudId]').equals([scope.userId, cloudId]).first();
  const row = link ? await repository.db.resumes.get(link.localId) : undefined;
  if (row && link && (row.revision !== link.syncedLocalRevision || row.status === 'trashed')) {
    if (!preserveLocal) throw new Error('本机有尚未同步的版本。请先处理云端冲突或恢复本机回收站，避免覆盖。');
    const copy = remapResume(row.resume, row.resume.title + ' · 保留的本机版本');
    await writeLink({ localId: copy.id, userId: scope.userId, cloudId: null, cloudRevision: 0, syncedLocalRevision: -1, localOnly: true, state: 'synced', error: null });
    assertScope(scope); await repository.create(copy);
  }
  if (row && link && document.revision === link.cloudRevision && row.status === 'active' && !preserveLocal) return row.id;
  const targetId = row?.status === 'active' ? row.id : uid('resume');
  assertScope(scope);
  await writeLink({ localId: targetId, userId: scope.userId, cloudId, cloudRevision: document.revision, syncedLocalRevision: row?.revision ?? -1, state: 'conflict', error: '正在读取云端版本' });
  assertScope(scope); const saved = await materialize(document, targetId); assertScope(scope);
  if (link && link.localId !== saved.id) await linkDatabase.cloudLinks.delete(link.localId);
  await writeLink({ localId: saved.id, userId: scope.userId, cloudId, cloudRevision: document.revision, syncedLocalRevision: saved.revision, state: 'synced', error: null });
  return saved.id;
}
export async function removeCloudResume(cloudId: string, expectedRevision: number) {
  const scope = accountScope(); await accountRequest<void>('resumes/' + encodeURIComponent(cloudId), 'DELETE', { expectedRevision }); assertScope(scope);
  const links = await linkDatabase.cloudLinks.where('[userId+cloudId]').equals([scope.userId!, cloudId]).toArray();
  for (const link of links) await linkDatabase.cloudLinks.update(link.localId, { cloudId: null, localOnly: true, state: 'synced', error: null });
  await refreshLinks(); await refreshCloudList();
}
export async function keepOnlyLocal(localId: string) {
  const link = await linkDatabase.cloudLinks.get(localId); if (!isVisibleToAccount(link, useCloud.getState().user?.id ?? null)) throw new Error('请先登录所属账号');
  clearTimeout(timers.get(localId)); timers.delete(localId);
  if (link?.userId) await linkDatabase.cloudLinks.update(localId, { cloudId: null, localOnly: true, state: 'synced', error: null });
  else await linkDatabase.cloudLinks.delete(localId);
  await refreshLinks();
}
export async function markPrivateCopy(copy: Resume, sourceId: string) {
  const link = await linkDatabase.cloudLinks.get(sourceId);
  if (!link?.userId) return;
  if (link.userId !== useCloud.getState().user?.id) throw new Error('请先登录简历所属账号');
  await writeLink({ localId: copy.id, userId: link.userId, cloudId: null, cloudRevision: 0, syncedLocalRevision: -1, localOnly: true, state: 'synced', error: null });
}
