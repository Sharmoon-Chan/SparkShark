import { useState } from 'react';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, Modal } from '../components/ui';
import { useApp } from '../app/store';
import { accountScope, useCloud } from './account';
import { retryCloudSave, saveChosenResumes } from './sync';
import { cloudDisplayState } from './links';
export function CloudStatus({ localId, compact = false }: { localId: string; compact?: boolean }) {
  const link = useCloud(state => state.links[localId]), user = useCloud(state => state.user);
  const localRevision = useApp(state => state.current?.id === localId ? state.current.revision : state.records.find(row => row.id === localId)?.revision);
  const dirty = useApp(state => state.current?.id === localId && state.dirty);
  const displayState = cloudDisplayState(link, localRevision, dirty);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const label = displayState === 'local' ? '仅本机' : displayState === 'synced' ? '已存云端' : displayState === 'syncing' ? '正在同步' : displayState === 'conflict' ? '云端版本冲突' : '云端未同步';
  const owned = !link?.userId || link.userId === user?.id;
  if (!owned) return null;
  const save = async () => {
    setBusy(true);
    try {
      if (useApp.getState().current?.id === localId && !(await useApp.getState().flush())) throw new Error('请先处理本机保存问题');
      const row = await useApp.getState().records.find(row => row.id === localId);
      const result = link ? await retryCloudSave(localId) : row ? await saveChosenResumes([row.resume], 'cloud', accountScope().userId) : undefined;
      useApp.getState().notify({ message: result?.failed ? '云端保存未成功，本机内容已保留。请在云端简历页重试。' : '已保存到云端', error: Boolean(result?.failed) }); setOpen(false);
    } catch (error) { useApp.getState().notify({ message: error instanceof Error ? error.message : '云端保存失败，本机内容已保留', error: true }); }
    finally { setBusy(false); }
  };
  return <span className={'cloud-status ' + displayState} title={link?.error ?? label}><span>{link ? <Cloud size={13} /> : <CloudOff size={13} />}{label}</span>{!compact && (link?.state === 'conflict' ? <Link to="/cloud">处理冲突</Link> : <button type="button" onClick={() => setOpen(true)} disabled={busy || link?.state === 'syncing'}>{!link || link.localOnly ? '保存到云端' : link.state === 'synced' ? '云端管理' : <><RefreshCw size={12} />重试</>}</button>)}<Modal open={open} onClose={() => setOpen(false)} title={link?.state === 'synced' && !link.localOnly ? '云端简历' : '保存这份简历到云端？'} description="将上传当前简历及照片。本机内容会保留，后续编辑可自动同步。" disableClose={busy}><div className="modal-body">{link?.state === 'synced' && !link.localOnly ? <Link className="button primary" to="/cloud" onClick={() => setOpen(false)}>打开云端简历管理</Link> : <div className="modal-actions"><Button secondary onClick={() => setOpen(false)} disabled={busy}>取消</Button><Button loading={busy} onClick={() => void save()}>保存到云端</Button></div>}</div></Modal></span>;
}
