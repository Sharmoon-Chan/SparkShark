import { useEffect, useState, type ComponentType } from 'react';
import { Button, Modal } from './ui';

/** Declare once at module scope. Closed dialogs never request their code. */
export function deferredDialog<P extends { open: boolean; onClose: () => void }>(load: () => Promise<ComponentType<P>>, title: string) {
  let pending: Promise<ComponentType<P>> | undefined;
  return function DeferredDialog(props: P) {
    const [Content, setContent] = useState<ComponentType<P> | null>(null);
    const [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
    useEffect(() => {
      if (!props.open || Content) return;
      let active = true;
      setError(false);
      pending ??= load().catch(reason => { pending = undefined; throw reason; });
      void pending.then(component => { if (active) setContent(() => component); }, () => { if (active) setError(true); });
      return () => { active = false; };
    }, [props.open, Content, attempt]);
    if (Content) return <Content {...props} />;
    if (!props.open) return null;
    return <Modal open onClose={props.onClose} title={title} description={error ? '暂时无法打开，请检查网络后重试。' : '正在打开，请稍候。'}>
      <div className="modal-body"><div className="modal-actions"><Button secondary onClick={props.onClose}>取消</Button>{error && <Button onClick={() => setAttempt(value => value + 1)}>重试</Button>}</div></div>
    </Modal>;
  };
}
