import type { Resume } from '../../domain/types';
import { sectionTitle } from '../../domain/registry';
import { paginatePreview, type PaginationResult } from './domPagination';
import { HTML_PREVIEW_MIN_HEIGHT, HTML_PREVIEW_WIDTH, previewSystemFont } from './htmlPreviewDocument';
import { browserFontFamily, createBrowserFontController, type BrowserFontStatus } from './browserFonts';
import { browserFontUsage } from './browserFontUsage';

export interface PreviewLayoutState {
  pages: number;
  height: number;
  revision: number;
  durationMs: number;
  error?: string;
  diagnostics?: PaginationResult;
}

export interface PreviewRuntimeOptions {
  onLayout: (state: PreviewLayoutState) => void;
  onSelect: (sectionId: string) => void;
  onFontStatus?: (status: BrowserFontStatus) => void;
  beforeLayout?: () => void;
  onReveal?: (element: HTMLElement) => void;
}

/** A stable iframe document: input changes update escaped markup, never srcdoc. */
export function createHtmlPreviewRuntime(document: Document, options: PreviewRuntimeOptions) {
  const source = document.getElementById('preview-source')!;
  const destination = document.getElementById('preview-pages')!;
  const theme = document.getElementById('preview-theme')!;
  const fontStyle = document.getElementById('preview-font')!;
  const reading = document.getElementById('preview-reading')!;
  const view = document.defaultView!;
  let current: Resume | undefined, revision = 0, scheduled = 0, disposed = false;
  let lastHtml = '', lastStyle = '', sourceSize = '';
  let fontSignature = '';
  let sectionIds = new Set<string>();
  const focusSection = () => {
    for (const element of destination.querySelectorAll<HTMLElement>('[data-keyboard-focus]')) element.removeAttribute('data-keyboard-focus');
    const id = document.activeElement?.closest<HTMLElement>('#preview-reading [data-section-id]')?.dataset.sectionId;
    if (!id) return;
    const element = [...destination.querySelectorAll<HTMLElement>('[data-section-id]')].find(item => item.dataset.sectionId === id);
    if (element) { element.dataset.keyboardFocus = ''; options.onReveal?.(element); }
  };
  const measure = () => {
    scheduled = 0;
    if (disposed || !current) return;
    const started = performance.now();
    try {
      options.beforeLayout?.();
      const result = paginatePreview(document, source, destination, {
        pageWidth: HTML_PREVIEW_WIDTH, pageHeight: HTML_PREVIEW_MIN_HEIGHT,
        marginPx: current.appearance.marginPx, pageNumbers: current.appearance.pageNumbers,
      });
      destination.dataset.paginationRevision = String(++revision);
      destination.dataset.pageCount = String(result.pages);
      destination.dataset.ready = 'true';
      destination.dataset.lineCuts = String(result.lineCuts);
      destination.dataset.sourceLines = String(result.sourceLines);
      destination.dataset.renderedLines = String(result.renderedLines);
      for (const link of destination.querySelectorAll<HTMLElement>('a,button,input,select,textarea,[tabindex]')) link.setAttribute('tabindex', '-1');
      for (const section of destination.querySelectorAll<HTMLElement>('[data-section-id], .resume-section')) {
        const id = section.dataset.sectionId || section.id;
        if (!sectionIds.has(id)) continue;
        const item = current.sections.find(item => item.id === id)!;
        section.dataset.sectionId = id;
        section.setAttribute('data-preview-interactive', '');
        // Visual slices may repeat portions of a long paragraph. Keep them out
        // of the reading tree; keyboard/SR users have one semantic copy below.
        section.removeAttribute('tabindex');
        section.setAttribute('aria-label', `编辑${sectionTitle(item, current.locale)}`);
        section.setAttribute('title', '点击编辑这个模块');
      }
      const durationMs = performance.now() - started;
      const measured = source.getBoundingClientRect();
      sourceSize = `${measured.width.toFixed(2)}:${measured.height.toFixed(2)}`;
      destination.dataset.layoutDuration = durationMs.toFixed(2);
      options.onLayout({ pages: result.pages, height: result.height, revision, durationMs, diagnostics: result });
      focusSection();
    } catch (error) {
      // Keep the previous complete preview available on a failed measurement.
      options.onLayout({ pages: Number(destination.dataset.pageCount) || 1, height: destination.getBoundingClientRect().height || HTML_PREVIEW_MIN_HEIGHT, revision,
        durationMs: performance.now() - started, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const schedule = () => { if (!disposed && !scheduled) scheduled = view.requestAnimationFrame(measure); };
  const fontController = createBrowserFontController(document, status => {
    if (disposed || !current || status.family !== browserFontFamily(current.appearance.fontFamilyId)) return;
    options.onFontStatus?.(status);
    destination.dataset.fontState = status.state;
    destination.dataset.fontBytes = String(status.bytes);
    destination.dataset.fontError = status.error ?? '';
    destination.dataset.fontMissing = status.missingCharacters.join('');
    if (status.state !== 'loading') {
      fontStyle.textContent = `body{font-family:"${status.family}",${previewSystemFont(current.appearance.fontFamilyId)}!important}`;
      schedule();
    }
  });
  const updateFonts = (force = false) => {
    if (!current) return;
    const usage = browserFontUsage(source);
    const text = usage.map(use => use.text).join('');
    const signature = current.appearance.fontFamilyId + ':' + usage.map(use => `${use.weight}:${use.style}:${[...new Set(Array.from(use.text))].sort().join('')}`).sort().join('|');
    if (!force && signature === fontSignature) return;
    fontSignature = signature;
    fontStyle.textContent = `body{font-family:"${browserFontFamily(current.appearance.fontFamilyId)}",${previewSystemFont(current.appearance.fontFamilyId)}!important}`;
    void fontController.update(current.appearance.fontFamilyId, text, false, usage).catch(error => {
      if (!disposed && (error as Error).name !== 'AbortError') options.onFontStatus?.({ state: 'fallback', family: browserFontFamily(current!.appearance.fontFamilyId), loaded: 0, total: 0, bytes: 0, missingCharacters: [], error: String(error) });
    });
  };
  // Only observe the offscreen source. Output dimensions never trigger another
  // layout pass; repeated identical ResizeObserver entries are ignored.
  const observer = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect;
    const size = `${width.toFixed(2)}:${height.toFixed(2)}`;
    if (sourceSize !== size) { sourceSize = size; schedule(); }
  });
  observer.observe(source);
  const imageLoaded = (event: Event) => { if ((event.target as Element | null)?.tagName === 'IMG') schedule(); };
  source.addEventListener('load', imageLoaded, true);
  const click = (event: Event) => {
    const target = event.target as Element | null;
    if (!target?.closest) return;
    if (target.closest('a')) event.preventDefault();
    const section = target.closest<HTMLElement>('[data-section-id]');
    if (section && sectionIds.has(section.dataset.sectionId!)) { event.preventDefault(); options.onSelect(section.dataset.sectionId!); }
  };
  const keydown = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') click(event); };
  destination.addEventListener('click', click);
  destination.addEventListener('keydown', keydown);
  reading.addEventListener('click', click);
  reading.addEventListener('focusin', focusSection);
  reading.addEventListener('focusout', focusSection);
  const fontsLoaded = () => schedule();
  document.fonts.addEventListener('loadingdone', fontsLoaded);

  return {
    update(html: string, resume: Resume) {
      if (disposed) return;
      current = resume;
      sectionIds = new Set(resume.sections.map(section => section.id));
      if (html === lastHtml) return;
      lastHtml = html;
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const main = parsed.querySelector<HTMLElement>('main.resume');
      if (!main) throw new Error('预览内容不完整');
      const css = [...parsed.querySelectorAll('style')].map(style => style.textContent).join('\n');
      if (css !== lastStyle) { theme.textContent = css; lastStyle = css; }
      document.documentElement.lang = resume.locale;
      document.title = resume.title;
      source.className = main.className;
      destination.className = main.className;
      source.innerHTML = main.innerHTML;
      reading.className = main.className;
      reading.innerHTML = main.innerHTML;
      for (const node of reading.querySelectorAll<HTMLElement>('[id]')) {
        if (node.matches('.resume-section')) node.dataset.sectionId = node.id;
        node.removeAttribute('id');
      }
      for (const section of reading.querySelectorAll<HTMLElement>('[data-section-id]')) {
        const item = current.sections.find(item => item.id === section.dataset.sectionId);
        if (!item) continue;
        const edit = document.createElement('button');
        edit.type = 'button'; edit.textContent = `编辑${sectionTitle(item, current.locale)}`;
        section.prepend(edit);
      }
      // The read-only source is excluded from accessibility and tab order.
      source.setAttribute('inert', '');
      source.setAttribute('aria-hidden', 'true');
      destination.dataset.ready = 'false';
      schedule();
      updateFonts();
    },
    remeasure: schedule,
    retryFonts: () => updateFonts(true),
    source,
    destination,
    dispose() {
      disposed = true;
      fontController.dispose();
      if (scheduled) view.cancelAnimationFrame(scheduled);
      observer.disconnect();
      source.removeEventListener('load', imageLoaded, true);
      destination.removeEventListener('click', click);
      destination.removeEventListener('keydown', keydown);
      reading.removeEventListener('click', click);
      reading.removeEventListener('focusin', focusSection);
      reading.removeEventListener('focusout', focusSection);
      document.fonts.removeEventListener('loadingdone', fontsLoaded);
    },
  };
}
