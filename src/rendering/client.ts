import type { Asset, RenderResult, Resume } from '../domain/types';
import { contentHash } from '../persistence/repository';
import { prepareAssets } from '../persistence/media';
import manifest from '../../public/fonts/manifest.json';
import { RENDER_VERSION } from './constants';
import { RenderQueue, renderCancelled, type RenderPriority } from './renderQueue';

let worker: Worker | null = null;
const queue = new RenderQueue<RenderResult>();
const waiting = new Map<string, { resolve: (result: RenderResult) => void; reject: (error: Error) => void; key: string }>();
const cache = new Map<string, RenderResult>();
function startWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/pdf.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = event => { const { id, error, bytes, pages, regions, fields } = event.data; const job = waiting.get(id); if (!job) return; waiting.delete(id); if (error) job.reject(new Error(error)); else job.resolve({ bytes, pages, regions, fields, key: job.key }); };
  worker.onerror = event => { for (const job of waiting.values()) job.reject(new Error(event.message || 'PDF 生成失败')); waiting.clear(); worker?.terminate(); worker = null; };
  return worker;
}
export async function renderPdf(resume: Resume, assets: Record<string, Asset> = {}, signal?: AbortSignal, options: { priority?: RenderPriority } = {}): Promise<RenderResult> {
  if (signal?.aborted) throw renderCancelled();
  const photo = resume.basics.avatarAssetId ? assets[resume.basics.avatarAssetId] : undefined;
  const key = `${RENDER_VERSION}:${manifest.version}:${await contentHash(resume)}:${photo?.sha256 ?? ''}`;
  if (signal?.aborted) throw renderCancelled();
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return cached; }
  return queue.enqueue(key, async taskSignal => {
    const prepared = await prepareAssets(resume, assets); if (taskSignal.aborted) throw renderCancelled();
    const id = crypto.randomUUID();
    const result = await new Promise<RenderResult>((resolve, reject) => {
      const activeWorker = startWorker();
      const abort = () => activeWorker.postMessage({ cancel: id });
      taskSignal.addEventListener('abort', abort, { once: true });
      const cleanup = () => taskSignal.removeEventListener('abort', abort);
      waiting.set(id, { resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); }, key });
      activeWorker.postMessage({ id, resume, assets: prepared, fontBase: new URL(`${import.meta.env.BASE_URL}fonts`, window.location.origin).href });
    });
    if (taskSignal.aborted) throw renderCancelled();
    cache.set(key, result);
    // A full catalog fits in the cache without thumbnail traffic evicting it.
    while (cache.size > 40 || (cache.size > 1 && [...cache.values()].reduce((bytes, item) => bytes + item.bytes.byteLength, 0) > 24 * 1024 * 1024)) cache.delete(cache.keys().next().value!);
    return result;
  }, { signal, priority: options.priority });
}
export const loadPdf = async (bytes: Uint8Array) => (await import('./pdfRuntime')).openPdf(bytes).promise;
export async function thumbnail(bytes: Uint8Array, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) throw renderCancelled();
  const { openPdf } = await import('./pdfRuntime');
  if (signal?.aborted) throw renderCancelled();
  const loading = openPdf(bytes);
  const abort = () => { void loading.destroy(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const document = await loading.promise;
    if (signal?.aborted) throw renderCancelled();
    const page = await document.getPage(1); const viewport = page.getViewport({ scale: .42 });
    const canvas = window.document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    if (signal?.aborted) throw renderCancelled();
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('缩略图生成失败')), 'image/png'));
  } finally { signal?.removeEventListener('abort', abort); await loading.destroy(); }
}
export function downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
export function filename(title: string): string { let name = title.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim().replace(/[. ]+$/, '').slice(0, 100); if (!name) name = '简历'; if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name += '-简历'; return name; }
