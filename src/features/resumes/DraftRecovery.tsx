import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import type { Resume } from '../../domain/types';
import { remapResume } from '../../domain/resume';
import { useApp } from '../../app/store';
import { repository } from '../../persistence/repository';
import { Button, Modal } from '../../components/ui';
import { StorageChoice } from '../../cloud/AccountUI';
import { accountScope, useCloud } from '../../cloud/account';
import { markPrivateCopy, saveChosenResumes, visibleLocalId, type StorageLocation } from '../../cloud/sync';
type Draft = { id: string; resume: Resume; updatedAt: string };
export function DraftRecovery() {
  const records = useApp(state => state.records), epoch = useCloud(state => state.epoch), links = useCloud(state => state.links), navigate = useNavigate();
  const [drafts, setDrafts] = useState<Draft[]>([]), [selected, setSelected] = useState<Draft | null>(null), [location, setLocation] = useState<StorageLocation>('local'), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; void repository.db.drafts.toArray().then(drafts => { if (active) setDrafts(drafts.filter(draft => visibleLocalId(draft.resume.id))); }).catch(() => undefined); return () => { active = false; }; }, [records, epoch, links]);
  useEffect(() => { setSelected(null); }, [epoch]);
  const shown = drafts.filter(draft => visibleLocalId(draft.resume.id));
  if (!shown.length) return null;
  return <><section className="draft-recovery" role="status"><AlertCircle size={18} /><div><strong>发现保留的未保存草稿</strong><p>可以恢复为新简历，原版本会保留。</p>{shown.map(draft => <div key={draft.id}><span>{draft.resume.title || '未命名简历'}</span><button type="button" disabled={busy} onClick={() => { setLocation('local'); setSelected(draft); }}>恢复为新简历</button></div>)}</div></section><Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="恢复草稿为新简历" disableClose={busy}><div className="modal-body"><StorageChoice value={location} onChange={setLocation} disabled={busy} /><div className="modal-actions"><Button secondary disabled={busy} onClick={() => setSelected(null)}>取消</Button><Button loading={busy} onClick={async () => { if (!selected) return; const owner = accountScope().userId; setBusy(true); try { if (!visibleLocalId(selected.resume.id)) throw new Error('请先登录草稿所属账号'); const copy = remapResume(selected.resume, (selected.resume.title || '简历') + ' · 恢复的草稿'); await markPrivateCopy(copy, selected.resume.id); await repository.create(copy); await repository.db.drafts.delete(selected.id); const result = await saveChosenResumes([copy], location, owner); await useApp.getState().refresh(); setSelected(null); if (result.failed) useApp.getState().notify({ message: '已恢复本机草稿，云端保存未成功，可在云端简历页重试。', error: true }); navigate('/resume/' + copy.id); } catch (error) { useApp.getState().notify({ message: error instanceof Error ? error.message : String(error), error: true }); } finally { setBusy(false); } }}>恢复草稿</Button></div></div></Modal></>;
}
