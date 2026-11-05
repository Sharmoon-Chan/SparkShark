import { zipSync } from 'fflate';
import type { Asset, Resume } from '../../domain/types';
import { bytesBlob, repository } from '../../persistence/repository';
import { prepareAssets } from '../../persistence/media';
import { downloadBlob, filename, loadPdf, renderPdf } from '../../rendering/client';

export async function exportPdf(resume: Resume, assets: Record<string, Asset>, signal?: AbortSignal) { const result = await renderPdf(structuredClone(resume), assets, signal); downloadBlob(bytesBlob(result.bytes), `${filename(resume.title)}.pdf`); return result; }
export async function exportHtml(resume: Resume, assets: Record<string, Asset>, signal?: AbortSignal) {
  const snapshot = structuredClone(resume);
  if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
  const { renderResumeHtml } = await import('../../rendering/html');
  if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
  const prepared = await prepareAssets(snapshot, assets);
  if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
  const html = renderResumeHtml(snapshot, prepared);
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${filename(snapshot.title)}.html`);
}
export async function exportImages(resume: Resume, assets: Record<string, Asset>, dpi: number, signal?: AbortSignal, progress?: (current: number, total: number) => void) {
  const result = await renderPdf(structuredClone(resume), assets, signal), pdf = await loadPdf(result.bytes);
  const pages: Record<string, Uint8Array> = {};
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
      progress?.(i, pdf.numPages);
      const page = await pdf.getPage(i), viewport = page.getViewport({ scale: dpi / 72 });
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const task = page.render({ canvas, viewport }); const abort = () => task.cancel(); signal?.addEventListener('abort', abort, { once: true });
      try { await task.promise; } finally { signal?.removeEventListener('abort', abort); }
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片生成失败')), 'image/png'));
      const name = `${filename(resume.title)}-${i}.png`; pages[name] = new Uint8Array(await blob.arrayBuffer());
      canvas.width = 0; canvas.height = 0;
      if (pdf.numPages === 1) { downloadBlob(blob, `${filename(resume.title)}.png`); return; }
    }
    if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
    downloadBlob(bytesBlob(zipSync(pages, { level: 0 }), 'application/zip'), `${filename(resume.title)}-图片.zip`);
  } finally { await pdf.loadingTask.destroy(); }
}
export async function exportBackup(resumes: Resume[], includeHistory = false, assets: Record<string, Asset> = {}) {
  const data = await repository.exportBackup(resumes, includeHistory, assets);
  downloadBlob(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }), `${resumes.length === 1 ? filename(resumes[0].title) : 'SparkShark-全部简历'}.json`);
}
