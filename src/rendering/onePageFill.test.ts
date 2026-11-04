import { describe, expect, it, vi } from 'vitest';
import { createResume, newItem, parseResume, plainRich, snapshotOf, uid } from '../domain/resume';
import { defaultContentLayout } from '../domain/contentLayout';
import type { Resume } from '../domain/types';
import { A4, pt } from './constants';
import { smartOnePage } from './onePage';
import { onePageExpansion, onePageUsage, ONE_PAGE_FILL_TARGET, type OnePageMeasurement } from './onePageFill';
import { captureOnePageRestore, restoreOnePageFormat } from './onePageRestore';

function fixture(): Resume {
  const resume = createResume('铺满一页 · 虚构资料');
  resume.basics.name = '林测试'; resume.basics.headline = '研发工程师';
  resume.layout.mode = 'single'; resume.layout.groups[0].main.push(...resume.layout.groups[0].sidebar); resume.layout.groups[0].sidebar = [];
  resume.sections.forEach(section => { section.visible = section.kind === 'work'; });
  const work = resume.sections.find(section => section.kind === 'work')!;
  if (work.kind === 'work') {
    work.items = [{ ...newItem('work'), fields: { ...newItem('work').fields, company: '虚构公司', position: '工程师', summary: plainRich('自动撑满一页时，全部正文与字段应完整保留。') } }];
    work.contentLayout = defaultContentLayout(work); work.contentLayout.fields.reverse();
    work.contentLayout.fields.find(field => field.key === 'location')!.visible = false;
    work.contentLayout.fields.find(field => field.key === 'position')!.align = 'center';
  }
  return resume;
}

function measured(resume: Resume, usage: number): OnePageMeasurement {
  const margin = pt(resume.appearance.marginPx), end = A4.height - (resume.appearance.pageNumbers ? Math.max(margin, Math.max(pt(32), margin / 2) + 12) : margin);
  return { pages: usage > 1 ? 2 : 1, fields: [{ page: 1, sectionId: 'work', itemId: 'item', fieldKey: 'summary', label: '详情', x: margin, y: margin, width: 400, height: (end - margin) * usage, columnX: margin, columnWidth: 400, rich: true }] };
}

const withoutFormatting = (resume: Resume) => ({ basics: resume.basics, sections: resume.sections.map(({ contentLayout: _format, ...section }) => section), layout: resume.layout });

describe('smart expansion of a single page', () => {
  it('measures the body rather than the page number, and treats missing content as unmeasurable', () => {
    const resume = fixture(), pdf = measured(resume, .6);
    expect(onePageUsage(resume, pdf)).toBeCloseTo(.6);
    expect(onePageUsage({ ...resume, appearance: { ...resume.appearance, pageNumbers: false } }, pdf)).toBeLessThan(.6);
    expect(onePageUsage(resume, { pages: 1, fields: [] })).toBeUndefined();
    expect(onePageUsage(resume, { ...pdf, pages: 2 })).toBeUndefined();
  });

  it('expands a half page using measured whitespace before increasing type or moving fields', async () => {
    const original = fixture(), before = structuredClone(original), candidates: Resume[] = [];
    const measure = async (candidate: Resume) => { candidates.push(candidate); return measured(candidate, .45 + ((candidate.appearance.spacingScale ?? 1) - 1) * .38); };
    const result = await smartOnePage(original, measure);
    expect(result).toMatchObject({ status: 'filled', beforePages: 1, pages: 1, fill: { complete: true } });
    expect(result.usage).toBeGreaterThanOrEqual(ONE_PAGE_FILL_TARGET);
    expect(result.usage).toBeLessThanOrEqual(1);
    expect(result.resume.appearance.fontSizePx).toBe(14); expect(result.resume.appearance.lineHeight).toBe(1.5);
    expect(result.resume.appearance.marginPx).toBe(18); expect(result.resume.appearance.avatar).toEqual(original.appearance.avatar);
    expect(result.resume.sections.find(section => section.kind === 'work')!.contentLayout!.fields).toEqual(original.sections.find(section => section.kind === 'work')!.contentLayout!.fields);
    expect(candidates.some(candidate => measureHeight(candidate) > 1)).toBe(true);
    expect(withoutFormatting(result.resume)).toEqual(withoutFormatting(original)); expect(original).toEqual(before);
    expect(() => parseResume(result.resume)).not.toThrow();
    const restored = restoreOnePageFormat(result.resume, captureOnePageRestore(original, result.resume));
    expect(snapshotOf(restored)).toEqual(snapshotOf(original));
  });

  it('keeps a full page unchanged and makes a second fill idempotent', async () => {
    const original = fixture(), measure = vi.fn(async (candidate: Resume) => measured(candidate, .98));
    const result = await smartOnePage(original, measure);
    expect(result.status).toBe('already'); expect(result.resume).toEqual(original); expect(measure).toHaveBeenCalledTimes(1);
    const changing = async (candidate: Resume) => measured(candidate, .5 + ((candidate.appearance.spacingScale ?? 1) - 1) * .35);
    const filled = await smartOnePage(original, changing), repeated = await smartOnePage(filled.resume, changing);
    expect(repeated.status).toBe('already'); expect(repeated.resume).toEqual(filled.resume); expect(repeated.attempts).toBe(1);
  });

  it('first merges multiple pages, then fills the remaining space in the same action', async () => {
    const original = fixture(), ids = original.layout.groups[0].main;
    original.layout.groups = [{ ...original.layout.groups[0], main: ids.slice(0, 4) }, { id: uid('page'), main: ids.slice(4), sidebar: [] }];
    const result = await smartOnePage(original, async candidate => candidate.layout.groups.length > 1 ? { pages: 2 } : measured(candidate, .5 + ((candidate.appearance.spacingScale ?? 1) - 1) * .35));
    expect(result).toMatchObject({ status: 'fit', beforePages: 2, pages: 1, fill: { complete: true } });
    expect(result.resume.layout.groups).toHaveLength(1);
    expect(result.resume.layout.groups[0].main).toEqual(ids);
    expect(result.attempts).toBeLessThanOrEqual(36);
  });

  it('uses larger type only when spacing cannot reach a full page, and bounds sparse content', async () => {
    const original = fixture(), measuredCandidates: Resume[] = [];
    const result = await smartOnePage(original, async candidate => { measuredCandidates.push(candidate); return measured(candidate, .2 + .03 * ((candidate.appearance.spacingScale ?? 1) - 1) + .015 * (candidate.appearance.fontSizePx - 14) + .06 * (candidate.appearance.lineHeight - 1.5)); });
    expect(result).toMatchObject({ status: 'filled', pages: 1, fill: { complete: false } });
    expect(result.usage).toBeGreaterThan(.2);
    expect(result.resume.appearance).toMatchObject({ spacingScale: 3, fontSizePx: 18, lineHeight: 2, marginPx: 18 });
    expect(measuredCandidates.every(candidate => candidate.appearance.fontSizePx <= 18 && candidate.appearance.lineHeight <= 2 && (candidate.appearance.spacingScale ?? 1) <= 3)).toBe(true);
    expect(withoutFormatting(result.resume)).toEqual(withoutFormatting(original));
  });

  it('preserves large manual values and validates every expansion candidate', () => {
    const original = fixture(); original.appearance.fontSizePx = 20; original.appearance.lineHeight = 2;
    for (const mode of ['spacing', 'typography'] as const) for (const amount of [0, .35, .65, 1]) {
      const result = onePageExpansion(original, amount, mode);
      expect(result.appearance.fontSizePx).toBe(20);
      expect(result.appearance.lineHeight).toBe(2);
      expect(() => parseResume(result)).not.toThrow();
    }
  });

  it('adjusts font independently when the next line-height step would overflow', async () => {
    const original = fixture();
    const result = await smartOnePage(original, async candidate => {
      const geometry = measured(candidate, .4 + .23 * ((candidate.appearance.spacingScale ?? 1) - 1) + .04 * (candidate.appearance.fontSizePx - 14));
      return candidate.appearance.lineHeight > 1.8 ? { pages: 2 } : geometry;
    });
    expect(result).toMatchObject({ status: 'filled', pages: 1, fill: { complete: true } });
    expect(result.resume.appearance.lineHeight).toBeLessThanOrEqual(1.8);
    expect(result.resume.appearance.fontSizePx).toBeGreaterThan(16.5);
    expect(result.usage).toBeGreaterThanOrEqual(ONE_PAGE_FILL_TARGET);
  });

  it('cancels during expansion or progress without changing the original or starting a rejected measurement', async () => {
    const original = fixture(), before = structuredClone(original), controller = new AbortController(); let calls = 0;
    await expect(smartOnePage(original, async candidate => { if (++calls === 2) controller.abort(); return measured(candidate, .5); }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(2); expect(original).toEqual(before);
    const progressCancel = new AbortController(), measure = vi.fn(async (candidate: Resume) => measured(candidate, .5));
    await expect(smartOnePage(original, measure, { signal: progressCancel.signal, onProgress: message => { if (message.startsWith('展开')) progressCancel.abort(); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(measure).toHaveBeenCalledTimes(1);
  });
});

function measureHeight(resume: Resume) { return .45 + ((resume.appearance.spacingScale ?? 1) - 1) * .38; }
