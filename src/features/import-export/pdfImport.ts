import type { PDFPageProxy } from 'pdfjs-dist';
import { openPdf, pdfjs } from '../../rendering/pdfRuntime';
import { candidateFromPdf, pdfTextSize, type PdfCandidate, type PdfPageText, type PdfSpan } from './pdfLayout';

export interface ImportedPhoto { blob: Blob; width: number; height: number }
export interface PdfImportResult { candidate: PdfCandidate; bytes: Uint8Array; photo: ImportedPhoto | null }
type Matrix = number[];
const identity = () => [1, 0, 0, 1, 0, 0];
function multiply(a: Matrix, b: Matrix): Matrix { return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]; }
function point(matrix: Matrix, x: number, y: number) { return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]; }
function abortIfNeeded(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('读取已取消', 'AbortError'); }

async function detectPhoto(page: PDFPageProxy, signal?: AbortSignal): Promise<ImportedPhoto | null> {
  abortIfNeeded(signal);
  const viewport = page.getViewport({ scale: 1 }), operators = await page.getOperatorList();
  let matrix = identity(); const stack: Matrix[] = []; const candidates: { x: number; y: number; width: number; height: number }[] = [];
  for (let i = 0; i < operators.fnArray.length; i++) {
    const op = operators.fnArray[i], args = operators.argsArray[i];
    if (op === pdfjs.OPS.save) stack.push(matrix.slice());
    else if (op === pdfjs.OPS.restore) matrix = stack.pop() ?? identity();
    else if (op === pdfjs.OPS.transform) matrix = multiply(matrix, args as number[]);
    else if (op === pdfjs.OPS.paintFormXObjectBegin) { stack.push(matrix.slice()); if (args[0]) matrix = multiply(matrix, args[0] as number[]); }
    else if (op === pdfjs.OPS.paintFormXObjectEnd) matrix = stack.pop() ?? identity();
    else if (op === pdfjs.OPS.paintImageXObject || op === pdfjs.OPS.paintInlineImageXObject) {
      const imageMatrix = multiply(viewport.transform, matrix); const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => point(imageMatrix, x, y));
      const x = Math.min(...corners.map(p => p[0])), y = Math.min(...corners.map(p => p[1]));
      const width = Math.max(...corners.map(p => p[0])) - x, height = Math.max(...corners.map(p => p[1])) - y;
      if (x >= -1 && y >= -1 && y < viewport.height * .3 && width >= 30 && height >= 30 && width <= viewport.width * .35 && height <= 220 && width / height >= .45 && width / height <= 1.9) candidates.push({ x: Math.max(0, x), y: Math.max(0, y), width, height });
    }
  }
  const best = candidates.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!best) return null;
  abortIfNeeded(signal);
  const canvas = document.createElement('canvas'), scale = Math.min(3, 2400 / Math.max(viewport.width, viewport.height)); const full = page.getViewport({ scale });
  canvas.width = Math.ceil(full.width); canvas.height = Math.ceil(full.height);
  const task = page.render({ canvas, viewport: full }); const cancel = () => task.cancel(); signal?.addEventListener('abort', cancel, { once: true });
  try { await task.promise; } finally { signal?.removeEventListener('abort', cancel); }
  abortIfNeeded(signal);
  const crop = document.createElement('canvas'); crop.width = Math.max(1, Math.round(best.width * scale)); crop.height = Math.max(1, Math.round(best.height * scale));
  crop.getContext('2d')!.drawImage(canvas, best.x * scale, best.y * scale, best.width * scale, best.height * scale, 0, 0, crop.width, crop.height);
  const blob = await new Promise<Blob | null>(resolve => crop.toBlob(resolve, 'image/png'));
  canvas.width = 0; canvas.height = 0;
  return blob ? { blob, width: crop.width, height: crop.height } : null;
}

export async function readPdfResume(file: File, options: { signal?: AbortSignal; onProgress?: (page: number, total: number) => void } = {}): Promise<PdfImportResult> {
  if (file.size > 10 * 1024 * 1024) throw new Error('PDF 文件需要小于 10 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new Error('这个文件不是有效的 PDF，请重新选择。');
  abortIfNeeded(options.signal);
  const loading = openPdf(bytes); const abort = () => { void loading.destroy(); }; options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const pdf = await loading.promise;
    if (pdf.numPages > 100) throw new Error('请使用不超过 100 页的简历 PDF');
    const pages: PdfPageText[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      abortIfNeeded(options.signal); options.onProgress?.(number, pdf.numPages);
      const page = await pdf.getPage(number), viewport = page.getViewport({ scale: 1 });
      const text = await page.getTextContent({ disableNormalization: true });
      const annotations = await page.getAnnotations();
      const links = annotations.filter(annotation => annotation.subtype === 'Link' && annotation.url).map(annotation => { const a = point(viewport.transform, annotation.rect[0], annotation.rect[1]), b = point(viewport.transform, annotation.rect[2], annotation.rect[3]); return { url: annotation.url as string, left: Math.min(a[0], b[0]), right: Math.max(a[0], b[0]), top: Math.min(a[1], b[1]), bottom: Math.max(a[1], b[1]) }; });
      // Loading the operator list also makes available readable embedded-font
      // names used to identify titles, while all processing stays local.
      await page.getOperatorList();
      const spans: PdfSpan[] = [];
      for (const item of text.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const transformed = multiply(viewport.transform, item.transform), height = Math.max(item.height, Math.hypot(transformed[2], transformed[3]), 1);
        const x = transformed[4], y = transformed[5];
        const font = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) as { name?: string } : null;
        const url = links.find(link => x + item.width / 2 >= link.left - 2 && x + item.width / 2 <= link.right + 2 && y - height * .35 >= link.top - 3 && y - height * .35 <= link.bottom + 3)?.url;
        spans.push({ text: item.str.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '�'), x, y, width: item.width, height, page: number, bold: /bold|black|heavy|semibold/i.test(font?.name ?? text.styles[item.fontName]?.fontFamily ?? ''), ...(url ? { url } : {}) });
      }
      pages.push({ number, width: viewport.width, height: viewport.height, spans });
    }
    const candidate = candidateFromPdf(pages, file.name.replace(/\.pdf$/i, ''));
    if (pdfTextSize(candidate) < 8) throw new Error('没有读取到可编辑文字。这可能是扫描件或图片型 PDF；请使用带文字的 PDF，或粘贴简历正文。');
    if (candidate.sourceText.length > 1_000_000) throw new Error('PDF 文字内容过多，请使用较短的简历文件');
    let photo: ImportedPhoto | null = null;
    try { photo = await detectPhoto(await pdf.getPage(1), options.signal); }
    catch { if (!options.signal?.aborted) candidate.warnings.push({ kind: 'image', message: '照片未能自动提取，导入后可以重新选择照片。' }); }
    abortIfNeeded(options.signal);
    return { candidate, bytes, photo };
  } catch (error) {
    if (options.signal?.aborted) throw new DOMException('读取已取消', 'AbortError');
    if (error && typeof error === 'object' && 'name' in error && error.name === 'PasswordException') throw new Error('这个 PDF 需要密码。请先提供可直接打开的 PDF 文件。');
    if (error && typeof error === 'object' && 'name' in error && error.name === 'InvalidPDFException') throw new Error('PDF 文件无法读取，内容可能已损坏。请重新选择文件。');
    throw error instanceof Error ? error : new Error('PDF 无法读取，文件可能已损坏。');
  } finally { options.signal?.removeEventListener('abort', abort); await loading.destroy().catch(() => undefined); }
}
