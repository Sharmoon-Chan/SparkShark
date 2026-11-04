import Dexie, { type Table } from 'dexie';
import type { Asset, BackupAsset, BackupEnvelope, HistoryEntry, Resume, StoredResume } from '../domain/types';
import { createExample, parseResume, remapResume, snapshotOf, uid } from '../domain/resume';
import { localResumeSaved } from '../cloud/events';

export class ResumeDatabase extends Dexie {
  resumes!: Table<StoredResume, string>;
  assets!: Table<Asset, string>;
  histories!: Table<HistoryEntry, string>;
  preferences!: Table<{ key: string; value: unknown }, string>;
  drafts!: Table<{ id: string; resume: Resume; updatedAt: string }, string>;
  constructor(name = 'myresume-local-v1') {
    super(name);
    this.version(1).stores({ resumes: 'id,status,updatedAt,deletedAt', assets: 'id,sha256', histories: 'id,resumeId,[resumeId+createdAt]', preferences: 'key', drafts: 'id,updatedAt' });
  }
}
export class ConflictError extends Error { latest: Resume; constructor(latest: Resume) { super('另一个标签页已更新这份简历'); this.name = 'ConflictError'; this.latest = latest; } }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function sha256(input: Uint8Array | string): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', data.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
}
export const contentHash = (resume: Resume) => sha256(canonical(snapshotOf(resume)));
export function bytesToBase64(bytes: Uint8Array): string { let text = ''; for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(text); }
export function base64ToBytes(base64: string): Uint8Array { const text = atob(base64); return Uint8Array.from(text, character => character.charCodeAt(0)); }
export function bytesBlob(bytes: Uint8Array, mime = 'application/pdf'): Blob { return new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime }); }

export class ResumeRepository {
  db: ResumeDatabase;
  constructor(db = new ResumeDatabase()) { this.db = db; }
  async initialize() {
    await this.db.open();
    const example = createExample();
    const initial = await this.historyFor(example, '创建示例');
    await this.db.transaction('rw', this.db.resumes, this.db.histories, this.db.preferences, async () => {
      if (await this.db.preferences.get('initialized')) return;
      if (!(await this.db.resumes.count())) {
        await this.db.resumes.add(this.row(example));
        await this.db.histories.add(initial);
      }
      await this.db.preferences.put({ key: 'initialized', value: true });
    });
    await this.purgeExpiredTrash();
  }
  row(resume: Resume): StoredResume { return { id: resume.id, status: 'active', deletedAt: null, revision: resume.revision, updatedAt: resume.updatedAt, resume }; }
  async historyFor(resume: Resume, reason: string, restoredFrom?: string): Promise<HistoryEntry> { return { id: uid('history'), resumeId: resume.id, createdAt: new Date().toISOString(), reason, snapshot: snapshotOf(resume), snapshotHash: await contentHash(resume), ...(restoredFrom ? { restoredFrom } : {}) }; }
  async create(resume: Resume): Promise<Resume> {
    parseResume(resume);
    const history = await this.historyFor(resume, '创建');
    await this.db.transaction('rw', this.db.resumes, this.db.histories, async () => { await this.db.resumes.add(this.row(resume)); await this.db.histories.add(history); });
    return resume;
  }
  async list(status: 'active' | 'trashed' = 'active') { return (await this.db.resumes.where('status').equals(status).toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  async get(id: string) { const row = await this.db.resumes.get(id); return row?.status === 'active' ? row.resume : null; }
  async save(resume: Resume, expectedRevision: number): Promise<Resume> {
    parseResume(resume);
    const next = { ...structuredClone(resume), revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
    const history = await this.historyFor(next, '自动保存');
    await this.db.transaction('rw', this.db.resumes, this.db.histories, async () => {
      const row = await this.db.resumes.get(resume.id);
      if (!row || row.status !== 'active') throw new Error('这份简历已被移入回收站，请保存为新简历');
      if (row.revision !== expectedRevision) throw new ConflictError(row.resume);
      await this.db.resumes.put({ ...row, revision: next.revision, updatedAt: next.updatedAt, resume: next });
      const histories = await this.db.histories.where('resumeId').equals(resume.id).sortBy('createdAt');
      const last = histories.at(-1);
      if (!last || (Date.now() - Date.parse(last.createdAt) >= 120_000 && last.snapshotHash !== history.snapshotHash)) {
        await this.db.histories.add(history);
        if (histories.length >= 50) await this.db.histories.bulkDelete(histories.slice(0, histories.length - 49).map(item => item.id));
      }
    });
    localResumeSaved(next.id);
    return next;
  }
  async snapshot(resume: Resume, reason: string, restoredFrom?: string) {
    const history = await this.historyFor(resume, reason, restoredFrom);
    await this.db.transaction('rw', this.db.histories, async () => {
      await this.db.histories.add(history);
      const list = await this.db.histories.where('resumeId').equals(resume.id).sortBy('createdAt');
      if (list.length > 50) await this.db.histories.bulkDelete(list.slice(0, list.length - 50).map(item => item.id));
    });
    return history;
  }
  async history(id: string) { return (await this.db.histories.where('resumeId').equals(id).sortBy('createdAt')).reverse(); }
  async setThumbnail(id: string, revision: number, blob: Blob) {
    await this.db.transaction('rw', this.db.resumes, async () => { const row = await this.db.resumes.get(id); if (row?.revision === revision) await this.db.resumes.put({ ...row, thumbnail: blob, thumbnailRevision: revision }); });
  }
  async trash(id: string) {
    const resume = await this.get(id); if (!resume) return;
    await this.snapshot(resume, '移入回收站');
    const now = new Date().toISOString(); await this.db.transaction('rw', this.db.resumes, async () => { const row = await this.db.resumes.get(id); if (row) await this.db.resumes.put({ ...row, status: 'trashed', deletedAt: now, updatedAt: now }); });
  }
  async restore(id: string) { await this.db.transaction('rw', this.db.resumes, async () => { const row = await this.db.resumes.get(id); if (row) await this.db.resumes.put({ ...row, status: 'active', deletedAt: null, updatedAt: new Date().toISOString() }); }); }
  async permanentlyDelete(id: string) {
    await this.db.transaction('rw', this.db.resumes, this.db.histories, async () => { const row = await this.db.resumes.get(id); if (row?.status !== 'trashed') throw new Error('请先移入回收站'); await this.db.resumes.delete(id); await this.db.histories.where('resumeId').equals(id).delete(); });
    await this.cleanAssets();
  }
  async cleanAssets() {
    await this.db.transaction('rw', this.db.resumes, this.db.histories, this.db.drafts, this.db.assets, async () => {
      const used = new Set<string>();
      for (const row of await this.db.resumes.toArray()) if (row.resume.basics.avatarAssetId) used.add(row.resume.basics.avatarAssetId);
      for (const history of await this.db.histories.toArray()) if (history.snapshot.basics.avatarAssetId) used.add(history.snapshot.basics.avatarAssetId);
      for (const draft of await this.db.drafts.toArray()) if (draft.resume.basics.avatarAssetId) used.add(draft.resume.basics.avatarAssetId);
      const unused = (await this.db.assets.toArray()).filter(asset => !used.has(asset.id));
      await this.db.assets.bulkDelete(unused.map(asset => asset.id));
    });
  }
  async addAsset(blob: Blob, width: number, height: number): Promise<Asset> {
    const data = new Uint8Array(await blob.arrayBuffer());
    const hash = await sha256(data);
    const existing = await this.db.assets.where('sha256').equals(hash).first(); if (existing) return existing;
    const asset: Asset = { id: uid('asset'), mime: blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', blob, width, height, sha256: hash, createdAt: new Date().toISOString() };
    await this.db.assets.add(asset); return asset;
  }
  async assetsFor(resume: Resume): Promise<Record<string, Asset>> { const id = resume.basics.avatarAssetId; if (!id) return {}; const asset = await this.db.assets.get(id); return asset ? { [id]: asset } : {}; }
  async exportBackup(resumes: Resume[], includeHistory: boolean, overrides: Record<string, Asset> = {}): Promise<BackupEnvelope> {
    const histories = includeHistory ? (await Promise.all(resumes.map(resume => this.history(resume.id)))).flat() : [];
    const ids = new Set([...resumes.map(resume => resume.basics.avatarAssetId), ...histories.map(history => history.snapshot.basics.avatarAssetId)].filter((id): id is string => Boolean(id)));
    const assets: BackupAsset[] = [];
    for (const id of ids) { const asset = overrides[id] ?? await this.db.assets.get(id); if (!asset) throw new Error('备份缺少照片资产，请先恢复照片'); const data = new Uint8Array(await asset.blob.arrayBuffer()); assets.push({ id, mime: asset.mime, width: asset.width, height: asset.height, sha256: asset.sha256, dataBase64: bytesToBase64(data) }); }
    return { format: 'myresume', schemaVersion: 1, exportedAt: new Date().toISOString(), resumes: structuredClone(resumes), assets, ...(includeHistory ? { histories } : {}) };
  }
  async importBackup(envelope: BackupEnvelope, reason = '导入备份'): Promise<Resume[]> {
    for (const history of envelope.histories ?? []) {
      const parent = envelope.resumes.find(resume => resume.id === history.resumeId);
      if (!parent) throw new Error('历史版本引用不完整');
      const snapshot = parseResume({ ...parent, ...history.snapshot, id: parent.id });
      if (await contentHash(snapshot) !== history.snapshotHash) throw new Error('历史版本校验未通过，备份可能已损坏');
    }
    const assetMap = new Map<string, string>(), additions: Asset[] = [];
    for (const input of envelope.assets) {
      const bytes = base64ToBytes(input.dataBase64); const hash = await sha256(bytes);
      if (hash !== input.sha256) throw new Error('照片校验未通过，备份可能已损坏');
      const existing = await this.db.assets.where('sha256').equals(hash).first();
      const id = existing?.id ?? uid('asset'); assetMap.set(input.id, id);
      if (!existing && !additions.some(asset => asset.sha256 === hash)) additions.push({ id, mime: input.mime, width: input.width, height: input.height, sha256: hash, blob: bytesBlob(bytes, input.mime), createdAt: new Date().toISOString() });
      else if (!existing) assetMap.set(input.id, additions.find(asset => asset.sha256 === hash)!.id);
    }
    const resumes: Resume[] = [], histories: HistoryEntry[] = [];
    for (const input of envelope.resumes) {
      parseResume(input);
      const map = new Map<string, string>(); const copy = remapResume(input, input.title, map);
      if (copy.basics.avatarAssetId) { const id = assetMap.get(copy.basics.avatarAssetId); if (!id) throw new Error('备份缺少引用的照片'); copy.basics.avatarAssetId = id; }
      resumes.push(copy);
      const sourceHistories = envelope.histories?.filter(history => history.resumeId === input.id) ?? [];
      for (const history of sourceHistories) {
        const source = parseResume({ ...input, ...history.snapshot, id: input.id });
        const mapped = remapResume(source, source.title, map);
        if (mapped.basics.avatarAssetId) { const id = assetMap.get(mapped.basics.avatarAssetId); if (!id) throw new Error('历史版本缺少引用的照片'); mapped.basics.avatarAssetId = id; }
        histories.push({ id: uid('history'), resumeId: copy.id, createdAt: history.createdAt, reason: history.reason, snapshot: snapshotOf(mapped), snapshotHash: await contentHash(mapped) });
      }
      if (!sourceHistories.length) histories.push(await this.historyFor(copy, reason));
    }
    await this.db.transaction('rw', this.db.resumes, this.db.assets, this.db.histories, async () => { await this.db.assets.bulkAdd(additions); await this.db.resumes.bulkAdd(resumes.map(resume => this.row(resume))); await this.db.histories.bulkAdd(histories); });
    return resumes;
  }
  async purgeExpiredTrash() {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    await this.db.transaction('rw', this.db.resumes, this.db.histories, async () => {
      const rows = await this.db.resumes.where('status').equals('trashed').toArray();
      const ids = rows.filter(row => row.deletedAt && Date.parse(row.deletedAt) <= cutoff).map(row => row.id);
      if (ids.length) { await this.db.resumes.bulkDelete(ids); await this.db.histories.where('resumeId').anyOf(ids).delete(); }
    });
    await this.cleanAssets();
  }
}
export const repository = new ResumeRepository();
