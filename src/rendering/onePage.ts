import type { Appearance, Resume } from '../domain/types';
import { updatePageAppearance } from '../domain/typographyBinding';
import { compactUnconfiguredFields, describeOnePageChanges, estimateOnePageCost, mergeOnePageGroups, spacingCandidate } from './onePageStrategies';
import { fillOnePage, onePageUsage, ONE_PAGE_FILL_TARGET, type OnePageMeasurement } from './onePageFill';

export const ONE_PAGE_MINIMUM = { fontSizePx: 12, lineHeight: 1.25, marginPx: 14 };

export function onePageAppearance(original: Appearance, amount: number): Appearance {
  const t = Math.max(0, Math.min(1, amount));
  // A previously chosen smaller setting is preserved, never reduced further.
  const reduce = (value: number, minimum: number, steps: number) => value <= minimum || t === 0 ? value
    : Math.max(minimum, Math.min(value, Math.round((value + (minimum - value) * t) * steps) / steps));
  return { ...original,
    fontSizePx: reduce(original.fontSizePx, ONE_PAGE_MINIMUM.fontSizePx, 4),
    lineHeight: reduce(original.lineHeight, ONE_PAGE_MINIMUM.lineHeight, 20),
    marginPx: reduce(original.marginPx, ONE_PAGE_MINIMUM.marginPx, 1),
    density: 'custom',
  };
}

export interface SmartOnePageOptions { signal?: AbortSignal; onProgress?: (message: string, attempts: number) => void }
export interface SmartOnePageResult { status: 'already' | 'fit' | 'filled' | 'unfit'; resume: Resume; beforePages: number; pages: number; attempts: number; changes: string[]; usage?: number; fill?: { before: number; after: number; complete: boolean } }
interface Measurement { resume: Resume; pages: number; cost: number; usage?: number }
interface Structure { resume: Resume; message: string; best?: Measurement }
type CompressionMode = 'spacing' | 'margins' | 'typography';
const MAX_ATTEMPTS = 20;

function renderKey(resume: Resume): string {
  const { density: _density, ...appearance } = resume.appearance;
  return JSON.stringify({ appearance: { ...appearance, spacingScale: appearance.spacingScale ?? 1 }, layout: resume.layout,
    contentLayouts: resume.sections.map(section => section.contentLayout ?? null) });
}
function structureKey(resume: Resume): string {
  return JSON.stringify({ layout: resume.layout, contentLayouts: resume.sections.map(section => section.contentLayout ?? null) });
}

/** Searches layouts first and reduces typography only after checking the actual PDF. */
async function reduceToOnePage(original: Resume, measure: (candidate: Resume) => Promise<OnePageMeasurement>, options: SmartOnePageOptions = {}): Promise<SmartOnePageResult> {
  const source = structuredClone(original), cache = new Map<string, Measurement>(), structures = new Map<string, Structure>();
  let attempts = 0, best: Measurement | undefined, beforePages = 0;
  const checkCancelled = () => { if (options.signal?.aborted) throw new DOMException('一页排版已取消', 'AbortError'); };
  const register = (resume: Resume, message: string): Structure => {
    const key = structureKey(resume); if (!structures.has(key)) structures.set(key, { resume, message }); return structures.get(key)!;
  };
  const inspect = async (candidate: Resume, message: string, structure?: Structure): Promise<Measurement | undefined> => {
    checkCancelled(); const key = renderKey(candidate); let result = cache.get(key);
    if (!result) {
      if (attempts >= MAX_ATTEMPTS) return undefined;
      attempts++;
      options.onProgress?.(message, attempts);
      checkCancelled();
      const rendered = await measure(structuredClone(candidate)); checkCancelled();
      if (!Number.isInteger(rendered.pages) || rendered.pages < 1) throw new Error('PDF 返回的页数不正确');
      result = { resume: structuredClone(candidate), pages: rendered.pages, cost: estimateOnePageCost(candidate), usage: onePageUsage(candidate, rendered) }; cache.set(key, result);
    }
    if (!best || result.pages < best.pages || (result.pages === best.pages && result.cost < best.cost)) best = result;
    if (structure && (!structure.best || result.pages < structure.best.pages || (result.pages === structure.best.pages && result.cost < structure.best.cost))) structure.best = result;
    return result;
  };
  const finish = (status: SmartOnePageResult['status'], result: Measurement): SmartOnePageResult => ({
    status, resume: structuredClone(result.resume), beforePages, pages: result.pages, attempts, changes: describeOnePageChanges(source, result.resume), usage: result.usage,
  });
  const candidate = (structure: Resume, amount: number, mode: CompressionMode) => {
    const next = spacingCandidate(structure, amount);
    if (mode === 'typography') updatePageAppearance(next, { ...onePageAppearance(structure.appearance, amount), spacingScale: next.appearance.spacingScale });
    else if (mode === 'margins') next.appearance.marginPx = onePageAppearance(structure.appearance, amount).marginPx;
    return next;
  };
  const refine = async (structure: Structure, upper: number, mode: CompressionMode, successful: Measurement): Promise<SmartOnePageResult> => {
    let selected = successful, low = 0, high = upper;
    const unchanged = await inspect(candidate(structure.resume, 0, mode), '回退检查，尽量保留原字号和留白', structure);
    if (unchanged?.pages === 1) return finish('fit', unchanged);
    for (let step = 0; step < 5 && attempts < MAX_ATTEMPTS; step++) {
      const amount = (low + high) / 2;
      const result = await inspect(candidate(structure.resume, amount, mode), '微调一页结果，寻找更宽松的可读排版', structure);
      if (!result) break;
      if (result.pages === 1) { high = amount; selected = result; } else low = amount;
    }
    return finish('fit', selected);
  };
  const baseline = (await inspect(source, '检查当前 PDF 页数'))!; beforePages = baseline.pages;
  if (baseline.pages === 1) return finish('already', baseline);
  const merged = mergeOnePageGroups(source), base = register(merged, '合并手动分页，保持模块与正文完整');
  const mergedResult = await inspect(merged, base.message, base);
  if (mergedResult?.pages === 1) return finish('fit', mergedResult);
  for (const amount of [.35, .65, 1]) {
    const result = await inspect(candidate(base.resume, amount, 'spacing'), '优先收紧空隙，保留当前字号', base);
    if (result?.pages === 1) return refine(base, amount, 'spacing', result);
  }
  const compact = register(compactUnconfiguredFields(merged), '合并相关短字段，保留富文本完整段落');
  for (const amount of [.65, 1]) {
    const result = await inspect(candidate(compact.resume, amount, 'spacing'), compact.message, compact);
    if (result?.pages === 1) return refine(compact, amount, 'spacing', result);
  }
  const rank = (a: Structure, b: Structure) => (a.best?.pages ?? Infinity) - (b.best?.pages ?? Infinity)
    || (a.best?.cost ?? estimateOnePageCost(a.resume)) - (b.best?.cost ?? estimateOnePageCost(b.resume));
  const ranked = [...structures.values()].sort(rank);
  for (const structure of ranked.filter(item => item.resume.appearance.marginPx > ONE_PAGE_MINIMUM.marginPx).slice(0, 2)) {
    // Try printable margins before altering type, leaving room for font search.
    if (attempts >= MAX_ATTEMPTS - 4) break;
    const result = await inspect(candidate(structure.resume, 1, 'margins'), '先调整打印边距，保留当前字号和行高', structure);
    if (result?.pages === 1) return refine(structure, 1, 'margins', result);
  }
  ranked.sort(rank);
  for (const structure of ranked) {
    // Reserve enough actual measurements to retreat from a successful maximum.
    if (attempts >= MAX_ATTEMPTS - 2) break;
    const result = await inspect(candidate(structure.resume, 1, 'typography'), '最后在可读下限内检查字号和行高', structure);
    if (result?.pages === 1) return refine(structure, 1, 'typography', result);
  }
  checkCancelled(); return finish('unfit', best!);
}

/** Multi-page resumes tighten; underfilled single-page resumes expand by real PDF bounds. */
export async function smartOnePage(original: Resume, measure: (candidate: Resume) => Promise<OnePageMeasurement>, options: SmartOnePageOptions = {}): Promise<SmartOnePageResult> {
  const result = await reduceToOnePage(original, measure, options);
  if (result.pages !== 1 || result.usage === undefined || result.usage >= ONE_PAGE_FILL_TARGET) return result;
  const expanded = await fillOnePage(result.resume, result.usage, measure, { signal: options.signal, onProgress: (message, attempts) => options.onProgress?.(message, result.attempts + attempts) });
  const attempts = result.attempts + expanded.attempts;
  if (!expanded.changed) return { ...result, attempts };
  return { ...result, status: result.status === 'already' ? 'filled' : 'fit', resume: expanded.resume, attempts,
    changes: describeOnePageChanges(original, expanded.resume), usage: expanded.usage,
    fill: { before: result.usage, after: expanded.usage, complete: expanded.usage >= ONE_PAGE_FILL_TARGET } };
}
