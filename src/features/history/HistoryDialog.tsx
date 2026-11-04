import { useEffect, useMemo, useState } from 'react';
import { Clock, Eye, GitCompareArrows, RotateCcw } from 'lucide-react';
import type { HistoryEntry, Resume } from '../../domain/types';
import { parseResume, snapshotOf } from '../../domain/resume';
import { useApp } from '../../app/store';
import { repository } from '../../persistence/repository';
import { Button, Modal } from '../../components/ui';
import { usePdf } from '../preview/usePdf';
import { PdfPreview } from '../preview/PdfPreview';
import { diffSnapshots } from './diff';

export function HistoryDialog({ open, onClose, resume }: { open: boolean; onClose: () => void; resume: Resume }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]), [selected, setSelected] = useState<HistoryEntry | null>(null), [mode, setMode] = useState<'diff' | 'preview'>('diff'), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [assets, setAssets] = useState(useApp.getState().assets), [retry, setRetry] = useState(0);
  useEffect(() => { if (open) repository.history(resume.id).then(list => { setEntries(list); setSelected(previous => previous ?? list[0] ?? null); }).catch(error => setError(error.message)); }, [open, resume.id, resume.revision]);
  const historic = useMemo(() => selected ? parseResume({ ...resume, ...selected.snapshot, id: resume.id }) : null, [selected]);
  useEffect(() => { if (historic) repository.assetsFor(historic).then(setAssets).catch(() => setAssets({})); }, [historic]);
  const rendered = usePdf(open && mode === 'preview' ? historic : null, assets, retry);
  const diff = selected ? diffSnapshots(selected.snapshot, snapshotOf(resume)) : [];
  return <><Modal open={open} onClose={onClose} title="历史记录" description="保留最近 50 个版本。恢复之前，会先保存当前内容。" wide><div className="history-layout"><aside className="history-list">{entries.map((entry, index) => <button type="button" key={entry.id} className={selected?.id === entry.id ? 'selected' : ''} onClick={() => { setSelected(entry); setError(''); }}><Clock size={15} /><span><strong>{entry.reason}</strong><small>{new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(entry.createdAt))}</small></span>{index === 0 && <em>最近</em>}</button>)}</aside><div className="history-detail"><div className="history-toolbar"><div className="segmented"><button type="button" className={mode === 'diff' ? 'active' : ''} onClick={() => setMode('diff')}><GitCompareArrows size={14} />查看差异</button><button type="button" className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}><Eye size={14} />完整预览</button></div><Button secondary disabled={!selected} onClick={() => setConfirm(true)}><RotateCcw size={14} />恢复此版本</Button></div>{mode === 'preview' ? <div className="history-preview"><PdfPreview {...rendered} onRetry={() => setRetry(value => value + 1)} /></div> : <div className="diff-list">{diff.length === 0 ? <div className="diff-empty">这个版本与当前内容相同</div> : diff.map((item, index) => <div className="diff-item" key={index}><strong>{item.label}<small>{item.kind === 'move' ? '位置变化' : item.kind === 'add' ? '新增' : item.kind === 'remove' ? '删除' : '修改'}</small></strong><div><p className="before">{item.before || '空'}</p><p className="after">{item.after || '空'}</p></div></div>)}</div>}{error && <p className="field-error">{error}</p>}</div></div></Modal>
    <Modal open={confirm} onClose={() => setConfirm(false)} title="恢复这个历史版本？" description="恢复前会保存当前内容，之后仍可以恢复回来。"><div className="modal-body"><div className="modal-actions"><Button secondary onClick={() => setConfirm(false)}>取消</Button><Button loading={busy} onClick={async () => {
      if (!selected) return; setBusy(true); setError('');
      try { await useApp.getState().flush(); const current = useApp.getState().current!; await repository.snapshot(current, '恢复前'); const next = parseResume({ ...current, ...selected.snapshot, id: current.id, revision: current.revision, createdAt: current.createdAt, updatedAt: new Date().toISOString() }); const historicAssets = await repository.assetsFor(next); useApp.setState({ assets: historicAssets }); useApp.getState().replace(next); const saved = await useApp.getState().flush(); if (!saved) throw new Error('恢复后的内容还未保存，请先下载备份'); await repository.snapshot(useApp.getState().current!, '已恢复', selected.id); useApp.getState().notify({ message: '已恢复历史版本，恢复前的内容保留在历史中' }); setConfirm(false); setSelected(null); setEntries(await repository.history(resume.id)); }
      catch (error) { setError(error instanceof Error ? error.message : String(error)); setConfirm(false); } finally { setBusy(false); }
    }}>确认恢复</Button></div></div></Modal></>;
}
