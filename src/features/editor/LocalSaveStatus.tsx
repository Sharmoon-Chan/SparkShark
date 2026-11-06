import { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import { Button, Modal } from '../../components/ui';
import { localSavePresentation, type LocalSaveState } from '../../cloud/savePresentation';
import './save-feedback.css';

export function LocalSaveStatus({ state, error, onRetry, onBackup, onConflict }: { state: LocalSaveState; error?: string | null; onRetry: () => Promise<boolean>; onBackup: () => void; onConflict: () => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const view = localSavePresentation(state);
  const close = () => setOpen(false);
  return <><button ref={trigger} type="button" className={`save-indicator save-status-trigger ${state}`} onClick={() => setOpen(true)} aria-label={`保存状态：${view.label}`} title={`${view.label}，点击查看保存详情`}>
    {state === 'saving' ? <LoaderCircle size={14} className="spin" /> : view.problem ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}<span>{view.label}</span>
  </button><span className="sr-only" role="status" aria-live="polite">{view.label}</span>
    <Modal open={open} onClose={close} returnFocusRef={trigger} title="本机保存状态" description={view.description}>
      <div className="modal-body"><p className="save-detail">本机内容保存在当前浏览器。下载备份后，可以在其他浏览器中恢复编辑。</p>
        {view.problem && error && <p className="field-error" role="alert">{error}</p>}
        <div className="modal-actions"><Button secondary onClick={onBackup}>下载当前草稿</Button>{state === 'conflict' ? <Button onClick={() => { setOpen(false); onConflict(); }}>处理冲突</Button> : state !== 'saved' ? <Button disabled={state === 'saving'} onClick={async () => { if (await onRetry()) close(); }}>重试保存</Button> : <Button onClick={close}>知道了</Button>}</div>
      </div>
    </Modal>
  </>;
}
