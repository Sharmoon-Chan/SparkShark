import { create } from 'zustand';
import type { Asset, Resume, StoredResume } from '../domain/types';
import { changeResume, createExample, remapResume, uid } from '../domain/resume';
import { ConflictError, repository, sha256 } from '../persistence/repository';

type SaveState = 'saved' | 'pending' | 'saving' | 'failed' | 'conflict';
interface Toast { message: string; error?: boolean; action?: { label: string; run: () => void } }
interface AppState {
  ready: boolean; storageError: string | null; records: StoredResume[]; trash: StoredResume[];
  current: Resume | null; assets: Record<string, Asset>; dirty: boolean; saveState: SaveState;
  saveError: string | null; conflict: Resume | null; toast: Toast | null; contentEpoch: number;
  initialize: () => Promise<void>; refresh: () => Promise<void>; open: (id: string) => Promise<void>;
  update: (edit: (resume: Resume) => void) => void; replace: (resume: Resume) => void;
  tracked: (reason: string, edit: (resume: Resume) => void) => Promise<boolean>;
  flush: () => Promise<boolean>; notify: (toast: Toast | null) => void;
  resolveConflict: (mode: 'copy' | 'latest') => Promise<Resume | null>;
  putAsset: (blob: Blob, width: number, height: number) => Promise<Asset>;
}
const memoryDrafts = new Map<string, Resume>();
const clientId = uid('client');
let sequence = 0;
let openGeneration = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let maximumTimer: ReturnType<typeof setTimeout> | undefined;
let activeSave: Promise<boolean> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('myresume-local-changes');
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void useApp.getState().flush(); }, 600);
  maximumTimer ??= setTimeout(() => { maximumTimer = undefined; void useApp.getState().flush(); }, 2000);
}
export const useApp = create<AppState>((set, get) => ({
  ready: false, storageError: null, records: [], trash: [], current: null, assets: {}, dirty: false,
  saveState: 'saved', saveError: null, conflict: null, toast: null, contentEpoch: 0,
  async initialize() {
    if (get().ready) return;
    try { await repository.initialize(); await get().refresh(); set({ ready: true, storageError: null }); }
    catch (error) {
      const resume = createExample(); memoryDrafts.set(resume.id, resume);
      set({ ready: true, storageError: error instanceof Error ? error.message : '浏览器存储不可用', records: [repository.row(resume)] });
    }
  },
  async refresh() { try { const [records, trash] = await Promise.all([repository.list(), repository.list('trashed')]); set({ records, trash }); } catch { /* The in-memory draft remains available. */ } },
  async open(id) {
    const generation = ++openGeneration;
    const old = get().current;
    if (old?.id === id) return;
    if (old && get().dirty) { if (!(await get().flush())) memoryDrafts.set(old.id, structuredClone(get().current!)); }
    const resume = memoryDrafts.get(id) ?? await repository.get(id).catch(() => null);
    const assets = resume ? await repository.assetsFor(resume).catch(() => ({})) : {};
    if (generation !== openGeneration) return;
    sequence++;
    set({ current: resume, assets, dirty: memoryDrafts.has(id), saveState: memoryDrafts.has(id) ? 'failed' : 'saved', saveError: null, conflict: null, contentEpoch: get().contentEpoch + 1 });
  },
  update(edit) {
    const current = get().current; if (!current) return;
    const next = changeResume(current, edit); sequence++; memoryDrafts.set(next.id, next);
    set({ current: next, dirty: true, saveState: get().conflict ? 'conflict' : 'pending' });
    if (!get().conflict) scheduleSave();
  },
  replace(resume) { sequence++; memoryDrafts.set(resume.id, resume); set({ current: resume, dirty: true, saveState: 'pending', contentEpoch: get().contentEpoch + 1 }); scheduleSave(); },
  async tracked(reason, edit) {
    const current = get().current; if (!current) return false;
    try { await repository.snapshot(current, reason); if (get().current?.id !== current.id) return false; get().update(edit); return true; }
    catch (error) { get().notify({ message: '历史保存失败，当前内容已保留。请先下载备份。', error: true }); set({ saveError: error instanceof Error ? error.message : String(error) }); return false; }
  },
  async flush() {
    clearTimeout(saveTimer); clearTimeout(maximumTimer); maximumTimer = undefined;
    if (activeSave) { const ok = await activeSave; return ok && (get().dirty ? get().flush() : true); }
    const current = get().current; if (!current || !get().dirty) return true;
    if (get().conflict) return false;
    const savedSequence = sequence; const submitted = structuredClone(current);
    set({ saveState: 'saving' });
    activeSave = (async () => {
      try {
        if (submitted.basics.avatarAssetId && get().assets[submitted.basics.avatarAssetId] && !(await repository.db.assets.get(submitted.basics.avatarAssetId))) await repository.db.assets.add(get().assets[submitted.basics.avatarAssetId]);
        const saved = await repository.save(submitted, submitted.revision);
        if (get().current?.id === saved.id) {
          if (sequence === savedSequence) { memoryDrafts.delete(saved.id); set({ current: saved, dirty: false, saveState: 'saved', saveError: null }); }
          else { const latest = { ...get().current!, revision: saved.revision }; memoryDrafts.set(saved.id, latest); set({ current: latest, saveState: 'pending' }); scheduleSave(); }
        }
        channel?.postMessage({ clientId, id: saved.id, revision: saved.revision });
        void get().refresh(); return true;
      } catch (error) {
        const latest = get().current ?? submitted; memoryDrafts.set(latest.id, latest);
        if (error instanceof ConflictError) {
          set({ conflict: error.latest, saveState: 'conflict', saveError: error.message });
          await repository.db.drafts.put({ id: `${clientId}:${latest.id}`, resume: latest, updatedAt: new Date().toISOString() }).catch(() => undefined);
        } else set({ saveState: 'failed', saveError: error instanceof Error ? error.message : String(error) });
        return false;
      } finally { activeSave = null; }
    })();
    return activeSave;
  },
  notify(toast) { clearTimeout(toastTimer); set({ toast }); if (toast) toastTimer = setTimeout(() => set({ toast: null }), toast.action ? 12000 : toast.error ? 9000 : 4500); },
  async resolveConflict(mode) {
    const current = get().current, latest = get().conflict; if (!current || !latest) return null;
    if (mode === 'copy') {
      const copy = remapResume(current, `${current.title || '简历'} · 本地修改`);
      await repository.create(copy); memoryDrafts.delete(current.id); await repository.db.drafts.delete(`${clientId}:${current.id}`);
      set({ current: copy, dirty: false, saveState: 'saved', conflict: null, saveError: null, contentEpoch: get().contentEpoch + 1 }); await get().refresh(); return copy;
    }
    memoryDrafts.delete(current.id); await repository.db.drafts.delete(`${clientId}:${current.id}`);
    set({ current: latest, dirty: false, saveState: 'saved', conflict: null, saveError: null, contentEpoch: get().contentEpoch + 1 });
    set({ assets: await repository.assetsFor(latest) }); return latest;
  },
  async putAsset(blob, width, height) {
    let asset: Asset;
    try { asset = await repository.addAsset(blob, width, height); }
    catch { asset = { id: uid('asset'), mime: blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', blob, width, height, sha256: await sha256(new Uint8Array(await blob.arrayBuffer())), createdAt: new Date().toISOString() }; }
    set({ assets: { ...get().assets, [asset.id]: asset } }); return asset;
  },
}));
channel?.addEventListener('message', async event => {
  if (event.data.clientId === clientId) return;
  const state = useApp.getState(); void state.refresh();
  if (!state.current || state.current.id !== event.data.id || state.current.revision >= event.data.revision) return;
  const latest = await repository.get(event.data.id); if (!latest) return;
  if (useApp.getState().current?.id !== event.data.id) return;
  if (useApp.getState().dirty) {
    const current = useApp.getState().current!;
    await repository.db.drafts.put({ id: `${clientId}:${current.id}`, resume: current, updatedAt: new Date().toISOString() }).catch(() => undefined);
    useApp.setState({ conflict: latest, saveState: 'conflict' });
  } else useApp.setState({ current: latest, assets: await repository.assetsFor(latest), contentEpoch: useApp.getState().contentEpoch + 1 });
});
export function latestDraft(resume: Resume): Resume { return useApp.getState().current?.id === resume.id ? useApp.getState().current! : memoryDrafts.get(resume.id) ?? resume; }
const beforeUnload = (event: BeforeUnloadEvent) => { if (useApp.getState().dirty) event.preventDefault(); };
window.addEventListener('beforeunload', beforeUnload);
if (import.meta.hot) import.meta.hot.dispose(() => { clearTimeout(saveTimer); clearTimeout(maximumTimer); clearTimeout(toastTimer); channel?.close(); window.removeEventListener('beforeunload', beforeUnload); });
