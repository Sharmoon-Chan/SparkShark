import type { PreviewFieldRegion, PreviewRegion, Resume } from '../domain/types';
import { sectionVisibleWithContent } from './contentLayoutView';
import { A4, pt } from './constants';

export interface OnePageMeasurement { pages: number; fields?: readonly PreviewFieldRegion[]; regions?: readonly PreviewRegion[] }
export const ONE_PAGE_FILL_TARGET = .965;
export const ONE_PAGE_FILL_LIMITS = { spacingScale: 3, fontSizePx: 18, lineHeight: 2, rowGapPx: 16, itemGapPx: 32 };
const MAX_FILL_ATTEMPTS = 16;
type ExpansionMode = 'spacing' | 'typography' | 'font' | 'line';

/** Actual content bounds exclude the page number and respect its reserved space. */
export function onePageUsage(resume: Resume, measured: OnePageMeasurement): number | undefined {
  if (measured.pages !== 1) return undefined;
  const bounds = measured.fields?.length ? measured.fields : measured.regions ?? [];
  const bottoms = bounds.filter(box => box.page === 1 && Number.isFinite(box.y) && Number.isFinite(box.height) && box.height > 0).map(box => box.y + box.height);
  if (!bottoms.length) return undefined;
  const margin = pt(resume.appearance.marginPx);
  const reserve = resume.appearance.pageNumbers ? Math.max(pt(32), margin / 2) + 12 : 0;
  const end = A4.height - Math.max(margin, reserve);
  return Math.max(0, Math.min(1, (Math.max(...bottoms) - margin) / (end - margin)));
}

function enlarge(value: number, limit: number, amount: number, steps = 100): number {
  return value >= limit || amount === 0 ? value : Math.max(value, Math.min(limit, Math.round((value + (limit - value) * amount) * steps) / steps));
}

/** Field order, alignment, visibility, margins, font family and content are retained. */
export function onePageExpansion(original: Resume, amount: number, mode: ExpansionMode): Resume {
  const next = structuredClone(original), t = Math.max(0, Math.min(1, amount));
  if (t === 0) return next;
  const appearance = next.appearance;
  appearance.density = 'custom';
  if (mode === 'spacing') {
    appearance.spacingScale = enlarge(appearance.spacingScale ?? 1, ONE_PAGE_FILL_LIMITS.spacingScale, t);
    for (const section of next.sections) {
      if (!section.contentLayout || !sectionVisibleWithContent(section)) continue;
      section.contentLayout.rowGapPx = enlarge(section.contentLayout.rowGapPx, ONE_PAGE_FILL_LIMITS.rowGapPx, t, 4);
      section.contentLayout.itemGapPx = enlarge(section.contentLayout.itemGapPx, ONE_PAGE_FILL_LIMITS.itemGapPx, t, 4);
    }
  } else {
    if (mode !== 'line') appearance.fontSizePx = enlarge(appearance.fontSizePx, ONE_PAGE_FILL_LIMITS.fontSizePx, t, 4);
    if (mode !== 'font') appearance.lineHeight = enlarge(appearance.lineHeight, ONE_PAGE_FILL_LIMITS.lineHeight, t, 20);
  }
  return next;
}

interface FillSample { resume: Resume; pages: number; usage?: number }
export interface OnePageFillResult { resume: Resume; usage: number; attempts: number; changed: boolean }

/** Expand whitespace first, then type, retaining only measured single-page PDFs. */
export async function fillOnePage(original: Resume, beforeUsage: number, measure: (candidate: Resume) => Promise<OnePageMeasurement>, options: { signal?: AbortSignal; onProgress?: (message: string, attempts: number) => void } = {}): Promise<OnePageFillResult> {
  const source = structuredClone(original);
  let best: FillSample = { resume: source, pages: 1, usage: beforeUsage }, attempts = 0;
  const key = (resume: Resume) => JSON.stringify({ appearance: resume.appearance, layouts: resume.sections.map(section => section.contentLayout ?? null) });
  const sourceKey = key(source), cache = new Map<string, FillSample>([[sourceKey, best]]);
  const cancelled = () => { if (options.signal?.aborted) throw new DOMException('一页排版已取消', 'AbortError'); };
  const inspect = async (candidate: Resume, mode: ExpansionMode): Promise<FillSample | undefined> => {
    cancelled(); const signature = key(candidate); let sample = cache.get(signature);
    if (!sample) {
      if (attempts >= MAX_FILL_ATTEMPTS) return undefined;
      options.onProgress?.(mode === 'spacing' ? '展开段落与模块间距，利用一页剩余空间' : mode === 'font' ? '微调字号，保持行高并贴近页底' : mode === 'line' ? '微调行高，保持字号并贴近页底' : '适度放大字号与行高，继续铺满一页', ++attempts);
      cancelled();
      const rendered = await measure(structuredClone(candidate)); cancelled();
      if (!Number.isInteger(rendered.pages) || rendered.pages < 1) throw new Error('PDF 返回的页数不正确');
      sample = { resume: candidate, pages: rendered.pages, usage: onePageUsage(candidate, rendered) }; cache.set(signature, sample);
    }
    if (sample.pages === 1 && sample.usage !== undefined) {
      const reaches = sample.usage >= ONE_PAGE_FILL_TARGET, selectedReaches = best.usage! >= ONE_PAGE_FILL_TARGET;
      if (reaches ? !selectedReaches || sample.usage < best.usage! : !selectedReaches && sample.usage > best.usage!) best = sample;
    }
    return sample;
  };
  const search = async (anchor: Resume, mode: ExpansionMode) => {
    const maximum = await inspect(onePageExpansion(anchor, 1, mode), mode);
    if (!maximum || (maximum.pages === 1 && (maximum.usage ?? 0) < ONE_PAGE_FILL_TARGET)) return;
    let low = 0, high = 1;
    for (let step = 0; step < 7 && attempts < MAX_FILL_ATTEMPTS; step++) {
      const amount = (low + high) / 2, sample = await inspect(onePageExpansion(anchor, amount, mode), mode);
      if (!sample) break;
      if (sample.pages > 1 || (sample.usage ?? 0) >= ONE_PAGE_FILL_TARGET) high = amount; else low = amount;
    }
  };
  cancelled();
  if (beforeUsage < ONE_PAGE_FILL_TARGET) {
    await search(source, 'spacing');
    if (best.usage! < ONE_PAGE_FILL_TARGET) await search(best.resume, 'typography');
    if (best.usage! < ONE_PAGE_FILL_TARGET) await search(best.resume, 'font');
    if (best.usage! < ONE_PAGE_FILL_TARGET) await search(best.resume, 'line');
  }
  cancelled();
  return { resume: structuredClone(best.resume), usage: best.usage!, attempts, changed: key(best.resume) !== sourceKey };
}
