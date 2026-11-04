import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import type { Resume } from '../../domain/types';
import { remapResume } from '../../domain/resume';
import { useApp } from '../../app/store';
import { repository } from '../../persistence/repository';

export function DraftRecovery() {
  const records = useApp(state => state.records), navigate = useNavigate();
  const [drafts, setDrafts] = useState<{ id: string; resume: Resume; updatedAt: string }[]>([]), [busy, setBusy] = useState(false);
  useEffect(() => { repository.db.drafts.toArray().then(setDrafts).catch(() => undefined); }, [records]);
  if (!drafts.length) return null;
  return <section className="draft-recovery" role="status"><AlertCircle size={18} /><div><strong>发现保留的未保存草稿</strong><p>可以恢复为新简历，原版本会保留。</p>{drafts.map(draft => <div key={draft.id}><span>{draft.resume.title || '未命名简历'}</span><button type="button" disabled={busy} onClick={async () => { setBusy(true); try { const copy = remapResume(draft.resume, `${draft.resume.title || '简历'} · 恢复的草稿`); await repository.create(copy); await repository.db.drafts.delete(draft.id); await useApp.getState().refresh(); navigate(`/resume/${copy.id}`); } catch (error) { useApp.getState().notify({ message: error instanceof Error ? error.message : String(error), error: true }); } finally { setBusy(false); } }}>恢复为新简历</button></div>)}</div></section>;
}
