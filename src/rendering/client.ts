import { openPdf, pdfjs } from './pdfRuntime';
import type { Asset, RenderResult, Resume } from '../domain/types';
import { contentHash } from '../persistence/repository';
import { prepareAssets } from '../persistence/media';
import manifest from '../../public/fonts/manifest.json';
import { RENDER_VERSION } from './constants';

let worker: Worker | null = null;
let chain: Promise<unknown> = Promise.resolve();
const waiting = new Map<string, { resolve: (result: RenderResult) => void; reject: (error: Error) => void; key: string }>();
const cache = new Map<string, RenderResult>();
function startWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/pdf.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = event => { const { id, error, bytes, pages, regions, fields } = event.data; const job = waiting.get(id); if (!job) return; waiting.delete(id); if (error) job.reject(new Error(error)); else job.resolve({ bytes, pages, regions, fields, key: job.key }); };
  worker.onerror = event => { for (const job of waiting.values()) job.reject(new Error(event.message || 'PDF 生成失败')); waiting.clear(); worker?.terminate(); worker = null; };
  return worker;
}
const cancelled = () => new DOMException('操作已取消', 'AbortError');
export async function renderPdf(resume: Resume, assets: Record<string, Asset> = {}, signal?: AbortSignal): Promise<RenderResult> {
  const key = `${RENDER_VERSION}:${manifest.version}:${await contentHash(resume)}`;
  if (signal?.aborted) throw cancelled();
  if (cache.has(key)) return cache.get(key)!;
  const task = chain.catch(() => undefined).then(async () => {
    if (signal?.aborted) throw cancelled();
    if (cache.has(key)) return cache.get(key)!;
    const prepared = await prepareAssets(resume, assets); if (signal?.aborted) throw cancelled();
    const id = crypto.randomUUID();
    const result = await new Promise<RenderResult>((resolve, reject) => {
      waiting.set(id, { resolve, reject, key });
      startWorker().postMessage({ id, resume, assets: prepared, fontBase: new URL(`${import.meta.env.BASE_URL}fonts`, window.location.origin).href });
    });
    cache.set(key, result); if (cache.size > 12) cache.delete(cache.keys().next().value!);
    if (signal?.aborted) throw cancelled(); return result;
  });
  chain = task; return task;
}
export const loadPdf = (bytes: Uint8Array) => openPdf(bytes).promise;
export async function thumbnail(bytes: Uint8Array): Promise<Blob> {
  const document = await loadPdf(bytes);
  try {
    const page = await document.getPage(1); const viewport = page.getViewport({ scale: .42 });
    const canvas = window.document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('缩略图生成失败')), 'image/png'));
  } finally { await document.loadingTask.destroy(); }
}
export function downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
export function filename(title: string): string { let name = title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim().replace(/[. ]+$/, '').slice(0, 100); if (!name) name = '简历'; if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name += '-简历'; return name; }
export { pdfjs };
