/** A measured HTML paginator. This deliberately does not claim react-pdf parity. */
export interface VerticalInterval { start: number; end: number }
export interface ColumnSlice extends VerticalInterval { capacity: number }
export interface SlicePlanOptions {
  height: number;
  intervals: readonly VerticalInterval[];
  keepTogether?: readonly VerticalInterval[];
  firstCapacity: number;
  capacity: number;
  maxPages?: number;
}

const EPSILON = .2;
export const PAGE_GAP = 24;

/** Merge overlapping glyph rectangles, including mixed bold/plain inline runs. */
export function mergeLineIntervals(intervals: readonly VerticalInterval[]): VerticalInterval[] {
  const sorted = intervals.filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .map(item => ({ start: item.start, end: item.end })).sort((a, b) => a.start - b.start || a.end - b.end);
  const result: VerticalInterval[] = [];
  for (const item of sorted) {
    const last = result.at(-1);
    if (last && item.start < last.end - EPSILON) last.end = Math.max(last.end, item.end);
    else result.push(item);
  }
  return result;
}

const crosses = (point: number, interval: VerticalInterval) => point > interval.start + EPSILON && point < interval.end - EPSILON;

/**
 * Greedy, monotonic cuts: text/image intervals are hard constraints. Small
 * headings and blocks are soft constraints, relaxed only when they cannot fit
 * on a fresh page. An empty first slice lets a tall initial block follow a
 * short first-page header without clipping it.
 */
export function planColumnSlices({ height, intervals, keepTogether = [], firstCapacity, capacity, maxPages = 300 }: SlicePlanOptions): ColumnSlice[] {
  if (![height, firstCapacity, capacity].every(Number.isFinite) || height < 0 || capacity <= 0 || firstCapacity < 0) throw new Error('预览分页尺寸无效');
  if (height <= EPSILON) return [];
  const hard = mergeLineIntervals(intervals);
  const soft = keepTogether.filter(item => item.end > item.start && item.end - item.start <= capacity + EPSILON);
  const slices: ColumnSlice[] = [];
  // Font glyph bounds can extend above their CSS line/element box. Preserve
  // that negative first extent instead of declaring the cropped part absent.
  let start = Math.min(0, hard[0]?.start ?? 0);
  while (start < height - EPSILON) {
    if (slices.length >= maxPages) throw new Error('简历预览页数过多，请缩短内容后重试');
    const available = slices.length ? capacity : firstCapacity - Math.min(0, start);
    const limit = Math.min(height, start + available);
    let end = limit;
    // Walk backwards to a fixed point; overlapping keep-with-next ranges may
    // otherwise leave a title in the prior slice when a later range moves it.
    for (let attempts = 0; attempts <= hard.length + soft.length; attempts++) {
      const crossing = [...hard, ...soft].filter(item => crosses(end, item) && item.start >= start - EPSILON);
      if (!crossing.length) break;
      const previous = end;
      end = Math.min(...crossing.map(item => item.start));
      if (previous - end < EPSILON) break;
    }
    if (end <= start + EPSILON) {
      // The first page may have a header leaving less than a complete block.
      if (!slices.length && firstCapacity < capacity - EPSILON) { slices.push({ start, end: start, capacity: available }); continue; }
      // Relax a block-keep request, but never cut a glyph or an image in half.
      end = limit;
      for (let attempts = 0; attempts <= hard.length; attempts++) {
        const crossing = hard.filter(item => crosses(end, item));
        if (!crossing.length) break;
        end = Math.min(...crossing.map(item => item.start));
      }
      if (end <= start + EPSILON) throw new Error('某个内容块高于整页，暂时无法安全分页');
    }
    if (hard.some(item => crosses(end, item))) throw new Error('无法找到不截断文字的分页位置');
    slices.push({ start, end: Math.min(end, height), capacity: available });
    start = end;
  }
  return slices;
}

interface MeasuredFlow {
  element: HTMLElement;
  rect: DOMRect;
  height: number;
  intervals: VerticalInterval[];
  keepTogether: VerticalInterval[];
  children: { element: HTMLElement; rect: DOMRect; children?: { element: HTMLElement; rect: DOMRect }[] }[];
}

export interface PaginationOptions {
  pageWidth: number;
  pageHeight: number;
  marginPx: number;
  pageNumbers: boolean;
}
export interface PaginationSliceDiagnostic {
  page: number;
  group: number;
  column: 'header' | 'main' | 'sidebar';
  start: number;
  end: number;
  capacity: number;
  lineCount: number;
  lineCuts: number;
}
export interface PaginationResult {
  pages: number;
  height: number;
  sourceLines: number;
  renderedLines: number;
  lineCuts: number;
  slices: PaginationSliceDiagnostic[];
  warnings: string[];
}

function elementRect(element: Element): DOMRect { return element.getBoundingClientRect(); }
function measureFlow(document: Document, element: HTMLElement, capacity: number): MeasuredFlow {
  const rect = elementRect(element);
  const raw: VerticalInterval[] = [];
  const walker = document.createTreeWalker(element, 4);
  const range = document.createRange();
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const box of Array.from(range.getClientRects())) if (box.width > 0 && box.height > 0) raw.push({ start: box.top - rect.top, end: box.bottom - rect.top });
  }
  for (const atomic of element.querySelectorAll<HTMLElement>('img,svg,.level')) {
    const box = elementRect(atomic);
    if (box.height > 0) raw.push({ start: box.top - rect.top, end: box.bottom - rect.top });
  }
  const intervals = mergeLineIntervals(raw);
  const keepTogether: VerticalInterval[] = [];
  const relative = (box: DOMRect) => ({ start: box.top - rect.top, end: box.bottom - rect.top });
  for (const block of element.querySelectorAll<HTMLElement>('.short-item,.content-layout-row:not(.has-rich)')) {
    const bounds = relative(elementRect(block));
    if (bounds.end - bounds.start <= capacity * .45) keepTogether.push(bounds);
  }
  // Protect a header and the next two physical lines. Headers larger than half
  // a page remain splittable; otherwise long user-supplied names could loop.
  for (const heading of element.querySelectorAll<HTMLElement>('.item-header,h2,h3:not(.item-name),h4,h5')) {
    const bounds = relative(elementRect(heading));
    const following = intervals.filter(item => item.start >= bounds.end - EPSILON).slice(0, 2);
    const end = following.at(-1)?.end ?? bounds.end;
    if (end - bounds.start <= capacity * .5) keepTogether.push({ start: bounds.start, end });
  }
  // Paragraph/list widow and orphan guards use measured line boxes rather than
  // character counts, so CJK, links, rich marks and custom font sizes are safe.
  for (const paragraph of element.querySelectorAll<HTMLElement>('p,pre,li')) {
    const bounds = relative(elementRect(paragraph));
    const lines = intervals.filter(item => item.start >= bounds.start - EPSILON && item.end <= bounds.end + EPSILON);
    if (lines.length >= 2) {
      keepTogether.push({ start: lines[0].start, end: lines[1].end });
      keepTogether.push({ start: lines.at(-2)!.start, end: lines.at(-1)!.end });
    }
  }
  const children = Array.from(element.children).map(child => {
    const item = { element: child as HTMLElement, rect: elementRect(child) };
    // Section children are positioned from their measured boxes; omitting
    // off-page items avoids cloning a complete ten-page resume ten times.
    return child.matches('.resume-section')
      ? { ...item, children: Array.from(child.children).map(nested => ({ element: nested as HTMLElement, rect: elementRect(nested) })) }
      : item;
  });
  const height = Math.max(rect.height, intervals.at(-1)?.end ?? 0);
  return { element, rect, height, intervals, keepTogether, children };
}

function cleanClone(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  for (const item of [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('*'))]) {
    if (item.matches('.resume-section') && item.id) item.dataset.sectionId = item.id;
    item.removeAttribute('id');
    // Editing callbacks are delegated from the stable iframe document. Do not
    // duplicate live controls or tab stops from the hidden measuring surface.
    item.removeAttribute('tabindex');
  }
  return clone;
}

function setBox(element: HTMLElement, rectangle: DOMRect, origin: DOMRect) {
  Object.assign(element.style, { position: 'absolute', top: `${rectangle.top - origin.top}px`, left: `${rectangle.left - origin.left}px`, width: `${rectangle.width}px`, margin: '0', boxSizing: 'border-box' });
}

function flowSlice(document: Document, flow: MeasuredFlow, slice: ColumnSlice): HTMLElement {
  const clip = document.createElement('div');
  clip.className = 'preview-column-clip';
  clip.dataset.sourceStart = String(slice.start);
  clip.dataset.sourceEnd = String(slice.end);
  Object.assign(clip.style, { position: 'absolute', overflow: 'hidden', width: `${flow.rect.width}px`, height: `${Math.max(0, slice.end - slice.start)}px` });
  const content = flow.element.cloneNode(false) as HTMLElement;
  content.removeAttribute('id');
  Object.assign(content.style, { position: 'relative', width: `${flow.rect.width}px`, height: `${flow.height}px`, minHeight: '0', margin: '0', transform: `translateY(${-slice.start}px)`, boxSizing: 'border-box' });
  // Headers are short and may contain flex layout spanning multiple children;
  // preserve their exact flow instead of positioning their children separately.
  if (flow.element.matches('.resume-header')) {
    const clone = cleanClone(flow.element);
    clone.style.margin = '0';
    clone.style.width = `${flow.rect.width}px`;
    clone.style.height = `${flow.rect.height}px`;
    clone.style.boxSizing = 'border-box';
    clone.style.transform = `translateY(${-slice.start}px)`;
    clip.append(clone);
    return clip;
  }
  for (const child of flow.children) {
    const top = child.rect.top - flow.rect.top, bottom = child.rect.bottom - flow.rect.top;
    if (bottom <= slice.start + EPSILON || top >= slice.end - EPSILON) continue;
    const clone = cleanClone(child.element);
    clone.dataset.sourceTop = String(top);
    clone.dataset.sourceBottom = String(bottom);
    setBox(clone, child.rect, flow.rect);
    if (child.children) {
      clone.replaceChildren();
      clone.style.height = `${child.rect.height}px`;
      for (const nested of child.children) {
        if (nested.rect.bottom - flow.rect.top <= slice.start + EPSILON || nested.rect.top - flow.rect.top >= slice.end - EPSILON) continue;
        const nestedClone = cleanClone(nested.element);
        setBox(nestedClone, nested.rect, child.rect);
        clone.append(nestedClone);
      }
    }
    content.append(clone);
  }
  clip.append(content);
  return clip;
}

/**
 * Source must be measurable at pageWidth (offscreen/visibility:hidden is fine).
 * Destination receives fixed-height pages; source and its document stay intact.
 * Caller batches calls after source changes, font completion and image decode.
 */
export function paginatePreview(document: Document, source: HTMLElement, destination: HTMLElement, options: PaginationOptions): PaginationResult {
  const { pageWidth, pageHeight, marginPx, pageNumbers } = options;
  // Mirror the PDF renderer's footer reservation, converted from points to px.
  const bottomInset = pageNumbers ? Math.max(marginPx, Math.max(32, marginPx / 2) + 16) : marginPx;
  const capacity = pageHeight - marginPx - bottomInset;
  if (!Number.isFinite(capacity) || capacity < 40 || pageWidth <= marginPx * 2) throw new Error('页面边距过大，无法显示简历内容');
  const groups = Array.from(source.querySelectorAll<HTMLElement>(':scope > .layout-page'));
  const result: PaginationResult = { pages: 0, height: 0, sourceLines: 0, renderedLines: 0, lineCuts: 0, slices: [], warnings: [] };
  const fragment = document.createDocumentFragment();
  const addPage = (original: HTMLElement, group: number) => {
    const page = original.cloneNode(false) as HTMLElement;
    page.removeAttribute('id');
    page.dataset.previewPage = String(++result.pages);
    page.dataset.previewGroup = String(group);
    page.dataset.logicalGroup = String(group);
    page.setAttribute('aria-label', `简历第 ${result.pages} 页`);
    Object.assign(page.style, { position: 'relative', boxSizing: 'border-box', width: `${pageWidth}px`, height: `${pageHeight}px`, minHeight: `${pageHeight}px`, padding: '0', margin: `0 0 ${PAGE_GAP}px`, overflow: 'hidden' });
    if (pageNumbers) {
      const number = document.createElement('div');
      number.className = 'preview-page-number';
      number.textContent = String(result.pages);
      Object.assign(number.style, { position: 'absolute', bottom: `${Math.max(32, marginPx / 2)}px`, left: '0', width: '100%', textAlign: 'center', fontFamily: 'Arial,sans-serif', fontSize: '10.6667px', lineHeight: '14px', color: '#657181' });
      page.append(number);
    }
    fragment.append(page);
    return page;
  };
  const appendFlow = (page: HTMLElement, flow: MeasuredFlow, slice: ColumnSlice, left: number, top: number, group: number, column: PaginationSliceDiagnostic['column']) => {
    if (slice.end - slice.start <= EPSILON) return;
    const clip = flowSlice(document, flow, slice);
    clip.dataset.logicalGroup = String(group);
    clip.dataset.previewColumn = column;
    const physicalTop = top + Math.min(0, slice.start);
    if (physicalTop < -EPSILON || physicalTop + slice.end - slice.start > pageHeight + EPSILON) throw new Error('字体超出页面可显示区域，请增加边距或减小字号');
    clip.style.left = `${left}px`; clip.style.top = `${physicalTop}px`;
    page.append(clip);
    const lineCount = flow.intervals.filter(line => line.start >= slice.start - EPSILON && line.end <= slice.end + EPSILON).length;
    const lineCuts = flow.intervals.filter(line => crosses(slice.start, line) || crosses(slice.end, line)).length;
    result.renderedLines += lineCount; result.lineCuts += lineCuts;
    result.slices.push({ page: Number(page.dataset.previewPage), group, column, start: slice.start, end: slice.end, capacity: slice.capacity, lineCount, lineCuts });
  };
  groups.forEach((group, index) => {
    const box = elementRect(group);
    const headerElement = group.querySelector<HTMLElement>(':scope > .resume-header');
    const columnElements = Array.from(group.querySelectorAll<HTMLElement>(':scope > .columns > .main-column,:scope > .columns > .sidebar-column,:scope > .main-column'));
    const header = headerElement ? measureFlow(document, headerElement, capacity) : null;
    const columns = columnElements.map(element => measureFlow(document, element, capacity));
    result.sourceLines += (header?.intervals.length ?? 0) + columns.reduce((sum, column) => sum + column.intervals.length, 0);
    const firstColumnY = columns.length ? Math.min(...columns.map(column => column.rect.top)) - box.top : marginPx + (header?.height ?? 0);
    const headerReserve = header ? Math.max(header.height, firstColumnY - marginPx) : 0;
    const separateHeader = header && headerReserve > capacity - 50;
    if (separateHeader) {
      for (const slice of planColumnSlices({ ...header, firstCapacity: capacity, capacity })) {
        const page = addPage(group, index + 1);
        appendFlow(page, header, slice, header.rect.left - box.left, marginPx, index + 1, 'header');
      }
    }
    const reserve = separateHeader ? 0 : headerReserve;
    const plans = columns.map(column => planColumnSlices({ ...column, firstCapacity: Math.max(0, capacity - reserve), capacity }));
    const count = Math.max(...plans.map(plan => plan.length), header && !separateHeader ? 1 : 0, columns.some(column => column.height > EPSILON) ? 1 : 0);
    if (!count && !separateHeader) { addPage(group, index + 1); return; }
    for (let number = 0; number < count; number++) {
      const page = addPage(group, index + 1);
      if (number === 0 && header && !separateHeader) appendFlow(page, header, { start: Math.min(0, header.intervals[0]?.start ?? 0), end: header.height, capacity }, header.rect.left - box.left, marginPx, index + 1, 'header');
      columns.forEach((column, columnIndex) => {
        const slice = plans[columnIndex][number];
        if (slice) appendFlow(page, column, slice, column.rect.left - box.left, marginPx + (number ? 0 : reserve), index + 1, column.element.matches('.sidebar-column') ? 'sidebar' : 'main');
      });
    }
  });
  if (!groups.length) {
    const blank = document.createElement('article'); blank.className = 'layout-page'; addPage(blank, 1);
  }
  if (result.lineCuts || result.sourceLines !== result.renderedLines) throw new Error('分页校验未通过，请使用精确 PDF 查看完整简历');
  (fragment.lastElementChild as HTMLElement | null)?.style.setProperty('margin-bottom', '0');
  destination.className = source.className;
  destination.style.width = `${pageWidth}px`; destination.style.maxWidth = 'none'; destination.style.margin = '0';
  destination.replaceChildren(fragment);
  result.height = result.pages * pageHeight + Math.max(0, result.pages - 1) * PAGE_GAP;
  destination.dataset.previewPages = String(result.pages);
  return result;
}
