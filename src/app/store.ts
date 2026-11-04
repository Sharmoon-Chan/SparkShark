import { create } from 'zustand';
import type { Asset, Resume, StoredResume } from '../domain/types';
import { changeResume, createExample, remapResume, uid } from '../domain/resume';
import { ConflictError, repository, sha256 } from '../persistence/repository';
import { useCloud } from '../cloud/account';
import { markPrivateCopy, visibleLocalId } from '../cloud/sync';

type SaveState = 'saved' | 'pending' | 'saving' | 'failed' | 'conflict';
interface Toast { message: string; error?: boolean; action?: { label: string; run: () => void } }
interface AppState {
  ready: boolean; storageError: string | null; records: StoredResume[]; trash: StoredResume[];
  current: Resume | null; assets: Record<string, Asset>; dirty: boolean; saveState: SaveState;
  saveError: string | null; conflict: Resume | null; toast: Toast | null; contentEpoch: number;
  initialize: () => Promise<void>; refresh: () => Promise<void>; open: (id: string, force?: boolean) => Promise<void>;
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
function editorScope(id: string) { return { id, epoch: useCloud.getState().epoch, generation: openGeneration }; }
function canUpdateView(scope: ReturnType<typeof editorScope>): boolean { return scope.epoch === useCloud.getState().epoch && scope.generation === openGeneration && useApp.getState().current?.id === scope.id && visibleLocalId(scope.id); }
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
  async refresh() { const epoch = useCloud.getState().epoch; try { const [records, trash] = await Promise.all([repository.list(), repository.list('trashed')]); if (epoch !== useCloud.getState().epoch) return; set({ records: records.filter(row => visibleLocalId(row.id)), trash: trash.filter(row => visibleLocalId(row.id)) }); } catch { /* The in-memory draft remains available. */ } },
  async open(id, force = false) {
    const generation = ++openGeneration;
    if (!visibleLocalId(id)) { set({ current: null, assets: {}, dirty: false, conflict: null }); return; }
    const old = get().current;
    if (old?.id === id && !force) return;
    if (old && get().dirty) { if (!(await get().flush())) memoryDrafts.set(old.id, memoryDrafts.get(old.id) ?? structuredClone(old)); }
    if (generation !== openGeneration || !visibleLocalId(id)) return;
    const resume = memoryDrafts.get(id) ?? await repository.get(id).catch(() => null);
    const assets = resume ? await repository.assetsFor(resume).catch(() => ({})) : {};
    if (generation !== openGeneration || !visibleLocalId(id)) return;
    sequence++;
    set({ current: resume, assets, dirty: memoryDrafts.has(id), saveState: memoryDrafts.has(id) ? 'failed' : 'saved', saveError: null, conflict: null, contentEpoch: get().contentEpoch + 1 });
  },
  update(edit) {
    const current = get().current; if (!current) return;
    const next = changeResume(current, edit); sequence++; memoryDrafts.set(next.id, next);
    set({ current: next, dirty: true, saveState: get().conflict ? 'conflict' : 'pending' });
    if (!get().conflict) scheduleSave();
  },
  replace(resume) { if (get().current?.id !== resume.id || !visibleLocalId(resume.id)) return; sequence++; memoryDrafts.set(resume.id, resume); set({ current: resume, dirty: true, saveState: 'pending', contentEpoch: get().contentEpoch + 1 }); scheduleSave(); },
  async tracked(reason, edit) {
    const current = get().current; if (!current) return false;
    const scope = editorScope(current.id);
    try { await repository.snapshot(current, reason); if (!canUpdateView(scope)) return false; get().update(edit); return true; }
    catch (error) { if (canUpdateView(scope)) { get().notify({ message: '历史保存失败，当前内容已保留。请先下载备份。', error: true }); set({ saveError: error instanceof Error ? error.message : String(error) }); } return false; }
  },
  async flush() {
    clearTimeout(saveTimer); clearTimeout(maximumTimer); maximumTimer = undefined;
    if (activeSave) { const current = get().current, scope = current ? editorScope(current.id) : null; await activeSave; if (!scope) return true; if (!canUpdateView(scope)) return false; return get().dirty ? get().flush() : get().saveState === 'saved'; }
    const current = get().current; if (!current || !get().dirty) return true;
    if (get().conflict) return false;
    const savedSequence = sequence; const submitted = structuredClone(current);
    const scope = editorScope(current.id), submittedAssets = { ...get().assets };
    set({ saveState: 'saving' });
    activeSave = (async () => {
      try {
        if (submitted.basics.avatarAssetId && submittedAssets[submitted.basics.avatarAssetId] && !(await repository.db.assets.get(submitted.basics.avatarAssetId))) await repository.db.assets.add(submittedAssets[submitted.basics.avatarAssetId]);
        const saved = await repository.save(submitted, submitted.revision);
        if (canUpdateView(scope)) {
          if (sequence === savedSequence) { memoryDrafts.delete(saved.id); set({ current: saved, dirty: false, saveState: 'saved', saveError: null }); }
          else { const latest = { ...get().current!, revision: saved.revision }; memoryDrafts.set(saved.id, latest); set({ current: latest, saveState: 'pending' }); scheduleSave(); }
        } else { const draft = memoryDrafts.get(saved.id); if (draft) memoryDrafts.set(saved.id, { ...draft, revision: saved.revision }); }
        channel?.postMessage({ clientId, id: saved.id, revision: saved.revision });
        void get().refresh(); return canUpdateView(scope);
      } catch (error) {
        const latest = canUpdateView(scope) ? get().current! : memoryDrafts.get(submitted.id) ?? submitted; memoryDrafts.set(submitted.id, latest);
        await repository.db.drafts.put({ id: `${clientId}:${submitted.id}`, resume: structuredClone(latest), updatedAt: new Date().toISOString() }).catch(() => undefined);
        if (canUpdateView(scope)) {
          if (error instanceof ConflictError) set({ conflict: error.latest, saveState: 'conflict', saveError: error.message });
          else set({ saveState: 'failed', saveError: error instanceof Error ? error.message : String(error) });
        }
        return false;
      } finally { activeSave = null; }
    })();
    return activeSave;
  },
  notify(toast) { clearTimeout(toastTimer); set({ toast }); if (toast) toastTimer = setTimeout(() => set({ toast: null }), toast.action ? 12000 : toast.error ? 9000 : 4500); },
  async resolveConflict(mode) {
    const current = get().current, latest = get().conflict; if (!current || !latest) return null;
    const scope = editorScope(current.id), expectedSequence = sequence;
    const canResolve = () => canUpdateView(scope) && sequence === expectedSequence && get().conflict === latest;
    if (mode === 'copy') {
      const copy = remapResume(current, `${current.title || '简历'} · 本地修改`);
      await markPrivateCopy(copy, current.id); if (!canResolve()) return null;
      await repository.create(copy); if (!canResolve()) return null;
      const assets = await repository.assetsFor(copy); if (!canResolve()) return null;
      await repository.db.drafts.delete(`${clientId}:${current.id}`); if (!canResolve()) return null; memoryDrafts.delete(current.id);
      set({ current: copy, assets, dirty: false, saveState: 'saved', conflict: null, saveError: null, contentEpoch: get().contentEpoch + 1 }); await get().refresh();
      return scope.epoch === useCloud.getState().epoch && get().current?.id === copy.id && visibleLocalId(copy.id) ? copy : null;
    }
    const assets = await repository.assetsFor(latest); if (!canResolve()) return null;
    await repository.db.drafts.delete(`${clientId}:${current.id}`); if (!canResolve()) return null; memoryDrafts.delete(current.id);
    set({ current: latest, assets, dirty: false, saveState: 'saved', conflict: null, saveError: null, contentEpoch: get().contentEpoch + 1 }); return latest;
  },
  async putAsset(blob, width, height) {
    const current = get().current, scope = current ? editorScope(current.id) : null;
    let asset: Asset;
    try { asset = await repository.addAsset(blob, width, height); }
    catch { asset = { id: uid('asset'), mime: blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', blob, width, height, sha256: await sha256(new Uint8Array(await blob.arrayBuffer())), createdAt: new Date().toISOString() }; }
    if (scope && !canUpdateView(scope)) throw new Error('编辑中的简历或账号已变更，请重新选择照片');
    if (scope) set({ assets: { ...get().assets, [asset.id]: asset } }); return asset;
  },
}));
export async function receiveLocalChange(message: { clientId: string; id: string; revision: number }) {
  if (!visibleLocalId(message.id) || message.clientId === clientId) return;
  const state = useApp.getState(); void state.refresh();
  if (!state.current || state.current.id !== message.id || state.current.revision >= message.revision) return;
  const scope = editorScope(message.id);
  const latest = await repository.get(message.id);
  if (!latest || !canUpdateView(scope) || useApp.getState().current!.revision >= latest.revision) return;
  const retainConflict = async () => {
    if (!canUpdateView(scope)) return;
    const draft = structuredClone(useApp.getState().current!); memoryDrafts.set(message.id, draft);
    await repository.db.drafts.put({ id: clientId + ':' + message.id, resume: draft, updatedAt: new Date().toISOString() }).catch(() => undefined);
    if (canUpdateView(scope) && useApp.getState().current!.revision < latest.revision) useApp.setState({ conflict: latest, saveState: 'conflict' });
  };
  if (useApp.getState().dirty) { await retainConflict(); return; }
  const assets = await repository.assetsFor(latest);
  if (!canUpdateView(scope) || useApp.getState().current!.revision >= latest.revision) return;
  if (useApp.getState().dirty) { await retainConflict(); return; }
  useApp.setState({ current: latest, assets, contentEpoch: useApp.getState().contentEpoch + 1 });
}
channel?.addEventListener('message', event => { void receiveLocalChange(event.data).catch(() => undefined); });
export function latestDraft(resume: Resume): Resume { return useApp.getState().current?.id === resume.id ? useApp.getState().current! : memoryDrafts.get(resume.id) ?? resume; }
useCloud.subscribe((state, previous) => {
  if (state.epoch !== previous.epoch || state.links !== previous.links || state.ownershipError !== previous.ownershipError || state.ownershipReady !== previous.ownershipReady) {
    const app = useApp.getState();
    useApp.setState({ records: app.records.filter(row => visibleLocalId(row.id)), trash: app.trash.filter(row => visibleLocalId(row.id)) });
    const current = app.current;
    if (current && !visibleLocalId(current.id)) {
      if (app.dirty) void repository.db.drafts.put({ id: clientId + ':' + current.id, resume: structuredClone(current), updatedAt: new Date().toISOString() }).catch(() => undefined);
      openGeneration++; sequence++; useApp.setState({ current: null, assets: {}, dirty: false, conflict: null, saveState: 'saved', saveError: null });
    }
  }
  if (state.epoch !== previous.epoch) {
    openGeneration++;
    const current = useApp.getState().current;
    if (current && !visibleLocalId(current.id)) { sequence++; useApp.setState({ current: null, assets: {}, dirty: false, conflict: null, saveState: 'saved', saveError: null }); }
  }
  if (state.epoch !== previous.epoch || state.links !== previous.links || state.ownershipError !== previous.ownershipError || state.ownershipReady !== previous.ownershipReady) void useApp.getState().refresh();
});
const beforeUnload = (event: BeforeUnloadEvent) => { if (useApp.getState().dirty) event.preventDefault(); };
window.addEventListener('beforeunload', beforeUnload);
if (import.meta.hot) import.meta.hot.dispose(() => { clearTimeout(saveTimer); clearTimeout(maximumTimer); clearTimeout(toastTimer); channel?.close(); window.removeEventListener('beforeunload', beforeUnload); });
