import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleDot, Download, FileDown, GripVertical, LoaderCircle, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PreviewFieldDrop, PreviewFieldRegion, PreviewRegion, RenderResult } from '../../domain/types';
import { openPdf } from '../../rendering/pdfRuntime';
import { A4 } from '../../rendering/constants';
import { Button, IconButton } from '../../components/ui';
import { PreviewFieldDragProvider, PreviewFieldLayer } from './PreviewFieldLayer';
import type { PreviewAlignmentActions } from './previewAlignment';
import './preview-interaction.css';

const EMPTY_FIELDS: PreviewFieldRegion[] = [];

function PdfPage({ pdf, index, zoom, regions, fields, activeTarget, onHover, onFocusTarget, onSelect, onRendered, onError }: { pdf: PDFDocumentProxy; index: number; zoom: number; regions: PreviewRegion[]; fields: readonly PreviewFieldRegion[]; activeTarget: string | null; onHover: (target: string | null) => void; onFocusTarget: (target: string | null) => void; onSelect?: (target: string) => void; onRendered?: () => void; onError?: (message: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), [links, setLinks] = useState<{ rect: number[]; url: string }[]>([]);
  const errorCallback = useRef(onError); errorCallback.current = onError;
  const renderedCallback = useRef(onRendered); renderedCallback.current = onRendered;
  const scale = zoom * 96 / 72;
  useEffect(() => {
    let render: { cancel: () => void } | undefined; let cancelled = false;
    pdf.getPage(index + 1).then(async page => {
      if (cancelled || !canvas.current) return;
      canvas.current.dataset.rendered = 'false';
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: zoom * 96 / 72 });
      canvas.current.width = Math.ceil(viewport.width * ratio); canvas.current.height = Math.ceil(viewport.height * ratio);
      const task = page.render({ canvas: canvas.current, viewport: page.getViewport({ scale: zoom * ratio * 96 / 72 }) }); render = task;
      await task.promise;
      if (!cancelled && canvas.current) { canvas.current.dataset.rendered = 'true'; renderedCallback.current?.(); }
      const annotations = await page.getAnnotations();
      if (!cancelled) setLinks(annotations.filter(a => a.subtype === 'Link' && a.url).map(a => { const t = viewport.transform; const point = (x: number, y: number) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]]; return { rect: [...point(a.rect[0], a.rect[1]), ...point(a.rect[2], a.rect[3])], url: a.url as string }; }));
    }).catch(error => { if (!cancelled) errorCallback.current?.(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, index, zoom]);
  return <div className="pdf-paper" style={{ width: A4.width * scale, height: A4.height * scale }} data-page={index + 1} onPointerMove={event => { if (!onSelect) return; const box = event.currentTarget.getBoundingClientRect(); const x = (event.clientX - box.left) / scale, y = (event.clientY - box.top) / scale; onHover(regions.find(region => x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height)?.target ?? null); }} onPointerLeave={() => onHover(null)}>
    <canvas ref={canvas} style={{ width: '100%', height: '100%' }} aria-label={`简历第 ${index + 1} 页`} />
    {onSelect && regions.map((region, i) => <button type="button" key={`${region.target}-${i}`} className={`pdf-section-target ${activeTarget === region.target ? 'is-active' : ''} ${region.y * scale < 28 ? 'label-inside' : ''}`} data-preview-target={region.target} aria-label={`编辑${region.label}`} onClick={() => onSelect(region.target)} onFocus={() => onFocusTarget(region.target)} onBlur={() => onFocusTarget(null)} style={{ left: region.x * scale, top: region.y * scale, width: region.width * scale, height: region.height * scale }}><span>{region.label}<small>点击编辑</small></span></button>)}
    {links.map((link, i) => <a key={i} className="pdf-link" href={link.url} target="_blank" rel="noreferrer" aria-label={`打开 ${link.url}`} style={{ left: Math.min(link.rect[0], link.rect[2]), top: Math.min(link.rect[1], link.rect[3]), width: Math.abs(link.rect[2] - link.rect[0]), height: Math.abs(link.rect[3] - link.rect[1]) }} />)}
    <PreviewFieldLayer fields={fields} page={index + 1} scale={scale} />
  </div>;
}
export function PdfPreview({ result, pending: rendering, error, warnings = [], onRetry, onPdf, onPng, onFit, fitting, fitProgress, onUndoFit, exporting, onSectionSelect, onFieldDrop, fieldAlignment, onReady, headingControls, title = '实时预览' }: { result: RenderResult | null; pending: boolean; error: string | null; warnings?: string[]; onRetry: () => void; onPdf?: () => void; onPng?: () => void; onFit?: () => void; fitting?: boolean; fitProgress?: string; onUndoFit?: () => void; exporting?: boolean; onSectionSelect?: (target: string) => void; onFieldDrop?: (drop: PreviewFieldDrop) => void; fieldAlignment?: PreviewAlignmentActions; onReady?: (key: string) => void; title?: string; headingControls?: ReactNode }) {
  const container = useRef<HTMLDivElement>(null), [width, setWidth] = useState(650), [loadedPdf, setLoadedPdf] = useState<{ document: PDFDocumentProxy; result: RenderResult } | null>(null);
  const [hoveredTarget, setHoveredTarget] = useState<string | null>(null), [focusedTarget, setFocusedTarget] = useState<string | null>(null);
  const [fieldMode, setFieldMode] = useState(false);
  const [alignmentToolbar, setAlignmentToolbar] = useState<HTMLDivElement | null>(null);
  const [paintedKey, setPaintedKey] = useState('');
  const [displayError, setDisplayError] = useState<string | null>(null), [displayRetry, setDisplayRetry] = useState(0);
  const visibleError = error ?? displayError;
  const retryDisplay = () => { setDisplayError(null); setDisplayRetry(value => value + 1); onRetry(); };
  const pending = rendering || Boolean(result && result.key !== paintedKey);
  const pdf = loadedPdf?.document;
  const fields = loadedPdf?.result.fields ?? EMPTY_FIELDS;
  const interactive = !pending && result?.key === loadedPdf?.result.key;
  const [manual, setManual] = useState<number | null>(null);
  const fitZoom = Math.max(.15, Math.min(1.15, (width - 56) / (A4.width * 96 / 72)));
  const zoom = manual ?? fitZoom;
  useEffect(() => { const element = container.current; if (!element) return; const observer = new ResizeObserver(entries => { const w = entries[0].contentRect.width; if (w > 0) setWidth(w); }); observer.observe(element); return () => observer.disconnect(); }, []);
  useEffect(() => {
    if (!result) return; let destroyed = false;
    setDisplayError(null);
    const loading = openPdf(result.bytes);
    loading.promise.then(value => { if (!destroyed) { setLoadedPdf({ document: value, result }); setHoveredTarget(null); setFocusedTarget(null); } }).catch(error => { if (!destroyed) setDisplayError(error instanceof Error ? error.message : String(error)); });
    return () => { destroyed = true; void loading.destroy().catch(() => undefined); };
  }, [result, displayRetry]);
  return <section className="preview" aria-label="简历预览"><div className="preview-heading"><span className="preview-title">{title}</span>{headingControls}<div className="preview-layout-controls">{onFieldDrop && <button type="button" className="preview-layout-toggle" aria-label="拖动布局" aria-pressed={fieldMode} disabled={!pdf || pending} onClick={() => { setFieldMode(value => !value); setHoveredTarget(null); setFocusedTarget(null); }}><GripVertical size={13} /><span>拖动布局</span></button>}<span>{result ? `${result.pages} 页 · A4` : 'A4'}</span></div></div>{fieldMode && onFieldDrop && <div className="preview-layout-help" role="status">{fields.length ? '拖动文字到另一字段的左右可同行，上下可换行；点击字段可选择位置与对齐。' : '当前没有可拖动字段，请先填写模块内容。'}</div>}{fieldMode && fieldAlignment && <div ref={setAlignmentToolbar} />}<div className="preview-scroll" ref={container}>
    {warnings.length > 0 && <div className="preview-notice" role="status"><strong>部分内容待核对</strong><p>{warnings.slice(0, 3).join('；')}{warnings.length > 3 ? `等 ${warnings.length} 个字段` : ''}含有 PDF 校对标记。预览以“?”显示，请在内容编辑中对照原文补齐。</p></div>}
    {visibleError && <div className="preview-error" role="alert"><strong>预览暂未生成</strong><p>{visibleError}</p><Button secondary onClick={retryDisplay}>重新生成</Button></div>}
    {!pdf && <div className="pdf-paper placeholder"><div className="preview-placeholder">{pending ? <><LoaderCircle className="spin" size={24} /><span>正在排版简历</span><small>首次载入中文字体可能需要一些时间</small></> : <span>在左侧填写内容，预览会自动更新</span>}</div></div>}
    {fitting && <div className="preview-fit-status" role="status"><LoaderCircle size={14} className="spin" /><span>{fitProgress || '正在智能排版'}</span></div>}
    {pdf && <PreviewFieldDragProvider enabled={fieldMode && interactive && !fitting && Boolean(onFieldDrop)} fields={fields} scale={zoom * 96 / 72} scrollContainer={container} onDrop={onFieldDrop} alignment={fieldAlignment} toolbarTarget={alignmentToolbar}><div className={`pdf-pages ${pending ? 'updating' : ''}`} style={{ minWidth: A4.width * 96 / 72 * zoom + 56 }}>{Array.from({ length: pdf.numPages }, (_, index) => <PdfPage onError={setDisplayError} onRendered={index === 0 ? () => { const key = loadedPdf!.result.key; setPaintedKey(key); onReady?.(key); } : undefined} key={`${loadedPdf?.result.key}-${index}`} pdf={pdf} index={index} zoom={zoom} regions={(loadedPdf?.result.regions ?? []).filter(region => region.target !== 'basics' && region.page === index + 1)} fields={fields.filter(field => field.page === index + 1)} activeTarget={hoveredTarget ?? focusedTarget} onHover={setHoveredTarget} onFocusTarget={setFocusedTarget} onSelect={interactive && !fieldMode && !fitting ? onSectionSelect : undefined} />)}</div></PreviewFieldDragProvider>}
    {pdf && pending && <div className="preview-updating" role="status"><LoaderCircle size={13} className="spin" />预览更新中</div>}
  </div><div className="preview-toolbar"><div className="zoom-controls"><IconButton label="缩小预览" onClick={() => setManual(Math.max(.15, zoom - .1))}><Minus size={16} /></IconButton><select aria-label="预览缩放" value={manual === null ? 'fit' : String(Math.round(manual * 100))} onChange={event => setManual(event.target.value === 'fit' ? null : Number(event.target.value) / 100)}><option value="fit">适应宽度</option>{[30, 50, 70, 75, 100, 125, 150, 200].map(value => <option key={value} value={value}>{value}%</option>)}{manual !== null && ![30, 50, 70, 75, 100, 125, 150, 200].includes(Math.round(manual * 100)) && <option value={Math.round(manual * 100)}>{Math.round(manual * 100)}%</option>}</select><IconButton label="放大预览" onClick={() => setManual(Math.min(2, zoom + .1))}><Plus size={16} /></IconButton></div><div className="toolbar-divider" /><IconButton label="适应宽度" onClick={() => setManual(null)}><Maximize2 size={16} /></IconButton><IconButton label="回到第一页并居中" onClick={() => container.current?.scrollTo({ top: 0, left: 0, behavior: 'smooth' })}><CircleDot size={16} /></IconButton>
    {onFit && <><div className="toolbar-divider" /><IconButton label={fitting ? '取消智能一页' : '智能一页'} title={fitting ? '取消智能一页' : '智能一页：多页自动收紧，不满一页自动铺满'} disabled={!fitting && (!pdf || pending || exporting)} onClick={onFit}>{fitting ? <LoaderCircle size={16} className="spin" /> : <FileDown size={16} />}</IconButton></>}
    {onUndoFit && <IconButton label="还原智能一页前的排版" disabled={fitting} onClick={onUndoFit}><RotateCcw size={16} /></IconButton>}
    {onPdf && <><div className="toolbar-spacer" /><IconButton label="下载 PDF" disabled={exporting} onClick={onPdf}><Download size={17} /></IconButton><IconButton label="下载图片" disabled={exporting} onClick={onPng}><FileDown size={17} /></IconButton></>}
  </div></section>;
}
