import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { CircleDot, Download, FileDown, GripVertical, LoaderCircle, Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import type { Asset, PreviewFieldDrop, PreviewFieldRegion, Resume } from '../../domain/types';
import { prepareAssets } from '../../persistence/media';
import { IconButton } from '../../components/ui';
import { HTML_PREVIEW_MIN_HEIGHT, HTML_PREVIEW_WIDTH, HTML_PREVIEW_SHELL, previewPhotoDataUrl, renderHtmlPreview } from './htmlPreviewDocument';
import { createHtmlPreviewRuntime, type PreviewLayoutState } from './htmlPreviewRuntime';
import type { BrowserFontStatus } from './browserFonts';
import { capturePreviewAnchor, restorePreviewAnchor } from './previewScrollAnchor';
import type { HtmlFieldOverlayProps } from './HtmlFieldOverlay';
import './html-preview.css';
import './preview-fields.css';

let overlayLoad: Promise<ComponentType<HtmlFieldOverlayProps>> | undefined;
const loadOverlay = () => overlayLoad ??= import('./HtmlFieldOverlay').then(module => module.HtmlFieldOverlay).catch(error => { overlayLoad = undefined; throw error; });
const EMPTY_FIELDS: PreviewFieldRegion[] = [];

export interface HtmlPreviewProps {
  resume: Resume;
  assets: Record<string, Asset>;
  onPdf?: () => void;
  onPng?: () => void;
  onFit?: () => void;
  fitting?: boolean;
  fitProgress?: string;
  onUndoFit?: () => void;
  exporting?: boolean;
  onSectionSelect?: (target: string) => void;
  onFieldDrop?: (drop: PreviewFieldDrop) => void;
  title?: string;
  headingControls?: ReactNode;
}

export function HtmlPreview({ resume, assets, onPdf, onPng, onFit, fitting, fitProgress, onUndoFit, exporting, onSectionSelect, onFieldDrop, headingControls, title = '预览' }: HtmlPreviewProps) {
  const container = useRef<HTMLDivElement>(null), frame = useRef<HTMLIFrameElement>(null);
  const [availableWidth, setAvailableWidth] = useState(650), [documentHeight, setDocumentHeight] = useState(HTML_PREVIEW_MIN_HEIGHT);
  const [manualZoom, setManualZoom] = useState<number | null>(null), [frameRevision, setFrameRevision] = useState(0);
  const [photo, setPhoto] = useState<{ key: string; dataUrl?: string; error?: string }>({ key: '' });
  const runtime = useRef<ReturnType<typeof createHtmlPreviewRuntime> | null>(null);
  const [pagination, setPagination] = useState<PreviewLayoutState>({ pages: 0, height: HTML_PREVIEW_MIN_HEIGHT, revision: 0, durationMs: 0 });
  const [fontStatus, setFontStatus] = useState<BrowserFontStatus | null>(null);
  const [fieldMode, setFieldMode] = useState(false), [fieldReady, setFieldReady] = useState(false);
  const [FieldOverlay, setFieldOverlay] = useState<ComponentType<HtmlFieldOverlayProps> | null>(null);
  const [overlayError, setOverlayError] = useState(false), [overlayRetry, setOverlayRetry] = useState(0);
  const zoomRef = useRef(1);
  const scrollAnchor = useRef<ReturnType<typeof capturePreviewAnchor>>(null);
  const selectSection = useRef(onSectionSelect); selectSection.current = onSectionSelect;
  const avatarId = resume.appearance.avatar.visible ? resume.basics.avatarAssetId : null;
  const asset = avatarId ? assets[avatarId] : undefined;
  const photoKey = asset ? `${asset.sha256}:${JSON.stringify(resume.appearance.avatar.crop)}` : '';
  const photoBlob = asset?.blob;
  useEffect(() => {
    if (!fieldMode || FieldOverlay) return;
    let cancelled = false; setOverlayError(false);
    void loadOverlay().then(component => { if (!cancelled) setFieldOverlay(() => component); }, () => { if (!cancelled) setOverlayError(true); });
    return () => { cancelled = true; };
  }, [fieldMode, FieldOverlay, overlayRetry]);

  useEffect(() => {
    let cancelled = false;
    if (!asset || !avatarId) { setPhoto({ key: '' }); return; }
    // Only the selected image and crop are relevant; content edits do not
    // re-read or re-rasterize assets. All text remains immediately visible.
    void prepareAssets(resume, { [avatarId]: asset }).then(prepared => {
      if (!cancelled) setPhoto({ key: photoKey, dataUrl: previewPhotoDataUrl(prepared[avatarId]) });
    }).catch(error => { if (!cancelled) setPhoto({ key: photoKey, error: error instanceof Error ? error.message : String(error) }); });
    return () => { cancelled = true; };
  }, [photoKey, photoBlob]);

  const dataUrl = photo.key === photoKey ? photo.dataUrl : undefined;
  const rendered = useMemo(() => {
    try { return { html: renderHtmlPreview(resume, dataUrl, fieldMode), error: null }; }
    catch (error) { return { html: '', error: error instanceof Error ? error.message : String(error) }; }
  }, [resume, dataUrl, fieldMode]);
  const zoom = manualZoom ?? Math.max(.15, Math.min(1.15, availableWidth / HTML_PREVIEW_WIDTH));
  zoomRef.current = zoom;

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(entries => { if (entries[0].contentRect.width > 0) setAvailableWidth(entries[0].contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const document = frame.current?.contentDocument;
    if (!document?.getElementById('preview-source')) return;
    const preview = createHtmlPreviewRuntime(document, {
      beforeLayout: () => {
        const scroll = container.current, stage = frame.current?.parentElement;
        scrollAnchor.current = scroll && stage ? capturePreviewAnchor(document, (scroll.getBoundingClientRect().top - stage.getBoundingClientRect().top) / zoomRef.current) : null;
      },
      onLayout: state => {
        setPagination(state); setDocumentHeight(state.height);
        setFieldReady(!state.error);
        const anchor = scrollAnchor.current;
        if (anchor) requestAnimationFrame(() => {
          const scroll = container.current, stage = frame.current?.parentElement;
          const offset = restorePreviewAnchor(document, anchor);
          if (scroll && stage && offset !== null) {
            const stageTop = stage.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
            scroll.scrollTop = stageTop + offset * zoomRef.current;
          }
        });
      },
      onFontStatus: setFontStatus,
      onFieldLayoutPending: () => setFieldReady(false),
      onReveal: element => {
        const scroll = container.current, stage = frame.current?.parentElement;
        if (!scroll || !stage) return;
        const top = stage.getBoundingClientRect().top - scroll.getBoundingClientRect().top + element.getBoundingClientRect().top * zoomRef.current;
        if (top < 0 || top > scroll.clientHeight - 80) scroll.scrollTop += top - 24;
      },
      onSelect: id => selectSection.current?.(id),
    });
    runtime.current = preview;
    return () => { preview.dispose(); if (runtime.current === preview) runtime.current = null; };
  }, [frameRevision]);

  useEffect(() => {
    if (rendered.html) runtime.current?.update(rendered.html, resume, fieldMode);
  }, [frameRevision, rendered.html, fieldMode]);

  const fields = pagination.fields ?? EMPTY_FIELDS;
  const canDrag = fieldMode && fieldReady && pagination.html === rendered.html && !rendered.error && !pagination.error && !fitting && !exporting && fontStatus?.state !== 'loading';

  return <section className={`preview html-preview ${fieldMode ? 'field-mode' : ''}`} aria-label="简历即时预览">
    <div className="preview-heading"><span className="preview-title">{title}</span>{headingControls}{onFieldDrop && <button type="button" className="preview-layout-toggle" aria-label="拖动布局" aria-pressed={fieldMode} onClick={() => setFieldMode(value => !value)}><GripVertical size={13} /><span>拖动布局</span></button>}<span className="html-preview-heading-meta" title="即时 A4 分页，最终导出请用精确 PDF 核对。">{fontStatus?.state === 'loading' && <span className="preview-font-status" role="status">字体加载中</span>}{fontStatus?.state === 'fallback' && (fontStatus.error ? <button type="button" className="preview-font-retry" title={fontStatus.error} onClick={() => runtime.current?.retryFonts()}>字体待重试</button> : <span className="preview-font-status" title={`部分字符使用系统字体：${fontStatus.missingCharacters.slice(0, 6).join(' ')}`}>部分字形替代</span>)}{pagination.pages ? `${pagination.pages} 页 · A4` : 'A4'}</span></div>
    {fieldMode && <div className="preview-layout-help" role="status">{overlayError ? <>拖动工具加载失败。<button type="button" className="text-button" onClick={() => setOverlayRetry(value => value + 1)}>重试拖动工具</button></> : !FieldOverlay ? '正在打开拖动工具…' : !canDrag ? '正在更新布局，稍后可拖动。' : fields.length ? '拖到同一条目字段的左右可同行，上下可换行；点击或按 Enter 也可选择位置。' : '先填写模块字段，再调整位置。'}</div>}
    <div className="preview-scroll html-preview-scroll" ref={container}>
      {(rendered.error || pagination.error) && <div className="preview-error" role="alert"><strong>暂时无法显示预览</strong><p>{rendered.error || pagination.error}</p></div>}
      {photo.key === photoKey && photo.error && <div className="html-preview-photo-error" role="status">头像暂未显示：{photo.error}</div>}
      {fitting && <div className="preview-fit-status" role="status"><LoaderCircle size={14} className="spin" /><span>{fitProgress || '正在检查精确 PDF 排版'}</span></div>}
      {rendered.html && <div className="html-preview-stage" style={{ width: HTML_PREVIEW_WIDTH * zoom, height: documentHeight * zoom }}>
        <iframe ref={frame} className="html-preview-frame" title="即时简历内容" sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={HTML_PREVIEW_SHELL} width={HTML_PREVIEW_WIDTH} height={documentHeight} style={{ transform: `scale(${zoom})` }} onLoad={() => setFrameRevision(value => value + 1)} />
        {fieldMode && onFieldDrop && FieldOverlay && <FieldOverlay fields={fields} enabled={Boolean(canDrag)} zoom={zoom} scrollContainer={container} onDrop={onFieldDrop} />}
      </div>}
    </div>
    <div className="preview-toolbar">
      <div className="zoom-controls"><IconButton label="缩小预览" onClick={() => setManualZoom(Math.max(.15, zoom - .1))}><Minus size={16} /></IconButton><select aria-label="预览缩放" value={manualZoom === null ? 'fit' : String(Math.round(manualZoom * 100))} onChange={event => setManualZoom(event.target.value === 'fit' ? null : Number(event.target.value) / 100)}><option value="fit">适应宽度</option>{[30, 50, 70, 75, 100, 125, 150, 200].map(value => <option key={value} value={value}>{value}%</option>)}{manualZoom !== null && ![30, 50, 70, 75, 100, 125, 150, 200].includes(Math.round(manualZoom * 100)) && <option value={Math.round(manualZoom * 100)}>{Math.round(manualZoom * 100)}%</option>}</select><IconButton label="放大预览" onClick={() => setManualZoom(Math.min(2, zoom + .1))}><Plus size={16} /></IconButton></div>
      <div className="toolbar-divider" /><IconButton label="适应宽度" onClick={() => setManualZoom(null)}><Maximize2 size={16} /></IconButton><IconButton label="回到顶部并居中" onClick={() => container.current?.scrollTo({ top: 0, left: 0, behavior: 'smooth' })}><CircleDot size={16} /></IconButton>
      {onFit && <><div className="toolbar-divider" /><IconButton label={fitting ? '取消智能一页' : '智能一页'} title="使用精确 PDF 检查并调整为一页" disabled={exporting && !fitting} onClick={onFit}>{fitting ? <LoaderCircle size={16} className="spin" /> : <FileDown size={16} />}</IconButton></>}
      {onUndoFit && <IconButton label="还原智能一页前的排版" disabled={fitting} onClick={onUndoFit}><RotateCcw size={16} /></IconButton>}
      <div className="toolbar-spacer" />
      {onPdf && <IconButton label="下载 PDF" disabled={exporting} onClick={onPdf}><Download size={17} /></IconButton>}
      {onPng && <IconButton label="下载图片" disabled={exporting} onClick={onPng}><FileDown size={17} /></IconButton>}
    </div>
  </section>;
}
