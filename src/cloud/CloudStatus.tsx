import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Cloud, CloudOff, LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Modal } from '../components/ui';
import { useApp } from '../app/store';
import { repository } from '../persistence/repository';
import { accountScope, assertScope, useCloud } from './account';
import { saveChosenResumes } from './sync';
import { cloudDisplayState } from './links';
import { cloudSavePresentation } from './savePresentation';

export function CloudStatus({ localId, compact = false, notice = false }: { localId: string; compact?: boolean; notice?: boolean }) {
  const link = useCloud(state => state.links[localId]), user = useCloud(state => state.user);
  const localRevision = useApp(state => state.current?.id === localId ? state.current.revision : state.records.find(row => row.id === localId)?.revision);
  const dirty = useApp(state => state.current?.id === localId && state.dirty);
  const localSaved = useApp(state => state.current?.id === localId ? state.saveState === 'saved' && !state.dirty : Boolean(state.records.find(row => row.id === localId)));
  const displayState = cloudDisplayState(link, localRevision, dirty);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const viewVersion = useRef(0), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { viewVersion.current++; }, [localId]);
  const feedback = cloudSavePresentation(displayState, localSaved);
  const owned = !link?.userId || link.userId === user?.id;
  if (!owned || (notice && !feedback.problem && !open)) return null;
  const save = async () => {
    if (busy) return;
    const scope = accountScope(), version = viewVersion.current;
    const editing = useApp.getState().current?.id === localId;
    const sameView = () => viewVersion.current === version && (!editing || useApp.getState().current?.id === localId);
    const assertContext = () => { assertScope(scope); if (!sameView()) throw new Error('已离开这份简历，请重新打开后再同步'); };
    setBusy(true);
    try {
      if (editing && !(await useApp.getState().flush())) throw new Error('请先处理本机保存问题');
      assertContext();
      const resume = await repository.get(localId);
      assertContext();
      if (!resume) throw new Error('没有找到当前简历，请重新打开后再试');
      const result = await saveChosenResumes([resume], 'cloud', scope.userId);
      if (!sameView()) return;
      // Signing in is expected when an anonymous user explicitly chooses cloud storage.
      if (scope.userId) assertScope(scope);
      if (!scope.userId && useCloud.getState().links[localId]?.userId !== (useCloud.getState().user?.id ?? null)) return;
      useApp.getState().notify({ message: result.failed ? '本机版本已保留，云端保存未成功。请在云端简历页重试。' : '已保存到云端', error: Boolean(result.failed) });
      setOpen(false);
    } catch (error) { if (sameView() && scope.epoch === useCloud.getState().epoch) useApp.getState().notify({ message: error instanceof Error ? error.message : '云端保存失败，请留意本机保存状态', error: true }); }
    finally { if (sameView()) { setBusy(false); if (scope.epoch !== useCloud.getState().epoch) setOpen(false); } }
  };
  const action = displayState === 'conflict'
    ? <Link className={notice ? 'cloud-recovery' : undefined} to="/cloud">处理冲突</Link>
    : displayState === 'synced' ? <Link to="/cloud">云端管理</Link>
    : feedback.action ? <button ref={trigger} className={notice ? 'cloud-recovery' : undefined} type="button" onClick={() => setOpen(true)} disabled={busy}>{feedback.action}</button> : null;
  return <>{notice ? feedback.problem && <div className={`cloud-save-notice ${displayState}`} role="alert"><AlertCircle size={15} /><div><strong>{feedback.label}</strong><p>{feedback.description}</p></div>{action}</div>
    : <span className={'cloud-status ' + displayState} title={feedback.description}><span className="cloud-status-label" role="status" aria-live="polite">{displayState === 'syncing' ? <LoaderCircle size={13} className="spin" /> : displayState === 'local' ? <CloudOff size={13} /> : <Cloud size={13} />}{feedback.label}</span>{!compact && action}</span>}
    <Modal open={open} onClose={() => setOpen(false)} returnFocusRef={trigger} title={displayState === 'local' ? '保存这份简历到云端？' : '同步当前修改到云端？'} description="将上传当前简历及照片。本机内容会保留，后续编辑可自动同步。" disableClose={busy}><div className="modal-body">{feedback.problem && <p className="field-error">{feedback.description}</p>}<div className="modal-actions"><Button secondary onClick={() => setOpen(false)} disabled={busy}>取消</Button><Button loading={busy} onClick={() => void save()}>{displayState === 'local' ? '保存到云端' : '立即同步'}</Button></div></div></Modal>
  </>;
}
