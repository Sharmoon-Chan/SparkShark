import type { PreparedAsset, Resume } from '../domain/types';
import { Buffer } from 'buffer/';

const scope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null; postMessage: (value: unknown, transfer?: Transferable[]) => void };
// Some browser-targeted PDF dependencies access window for built-in globals.
// The rendering code itself is DOM-free and runs in this dedicated worker.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
const renderer = import('../rendering/pdf');
let queue = Promise.resolve();
const controllers = new Map<string, AbortController>();
scope.onmessage = event => {
  if (event.data.cancel) { controllers.get(event.data.cancel)?.abort(); return; }
  const { id, resume, assets, fontBase } = event.data as { id: string; resume: Resume; assets: Record<string, PreparedAsset>; fontBase: string };
  const controller = new AbortController(); controllers.set(id, controller);
  queue = queue.then(async () => {
    try { const { renderResume } = await renderer; const result = await renderResume(resume, assets, fontBase, undefined, controller.signal); scope.postMessage({ id, ...result }, [result.bytes.buffer as ArrayBuffer]); }
    catch (error) { scope.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
    finally { controllers.delete(id); }
  });
};
