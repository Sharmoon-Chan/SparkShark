import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_APPEARANCE } from '../domain/registry';
import { createResume, newItem, parseResume, plainRich, uid } from '../domain/resume';
import { defaultContentLayout } from '../domain/contentLayout';
import type { Resume } from '../domain/types';
import { onePageAppearance, smartOnePage } from './onePage';

function fitExample(): Resume {
  const resume = createResume('一页测试');
  resume.basics.name = '林测试';
  resume.layout.mode = 'single';
  resume.layout.groups[0].main.push(...resume.layout.groups[0].sidebar); resume.layout.groups[0].sidebar = [];
  for (const section of resume.sections) section.visible = false;
  const work = resume.sections.find(section => section.kind === 'work')!;
  if (work.kind === 'work') { work.visible = true; work.items = [{ ...newItem('work'), fields: { ...newItem('work').fields,
    company: '测试公司', position: '工程师', dateText: '2024.01—至今', location: '测试城市', summary: plainRich('工作经历的完整正文应始终保留。'.repeat(4)) } }]; }
  const education = resume.sections.find(section => section.kind === 'education')!;
  if (education.kind === 'education') { education.visible = true; education.items = [{ ...newItem('education'), fields: { ...newItem('education').fields, institution: '测试大学', major: '计算机科学', studyType: '本科', dateText: '2020—2024' } }]; }
  const skills = resume.sections.find(section => section.kind === 'skills')!;
  if (skills.kind === 'skills') { skills.visible = true; skills.items = [{ ...newItem('skills'), fields: { name: 'TypeScript', description: '组件开发与类型建模', level: 3, keywords: ['React'] } }]; }
  const languages = resume.sections.find(section => section.kind === 'languages')!;
  if (languages.kind === 'languages') { languages.visible = true; languages.items = [{ ...newItem('languages'), fields: { name: '中文', description: '工作沟通', level: 5 } }]; }
  return resume;
}

function unchangedData(resume: Resume) {
  const { appearance: _appearance, layout: _layout, sections, ...rest } = resume;
  return { ...rest, sections: sections.map(({ contentLayout: _contentLayout, ...section }) => section) };
}

describe('one-page readability limits', () => {
  it('keeps the TalenCat compact margin and bounds automatic typography reductions', () => {
    const result = onePageAppearance(DEFAULT_APPEARANCE, 1);
    expect(result.fontSizePx).toBeGreaterThanOrEqual(12);
    expect(result.lineHeight).toBeGreaterThanOrEqual(1.25);
    expect(result.marginPx).toBeGreaterThanOrEqual(14);
  });
  it('does not further shrink earlier explicit settings below the recommendation', () => {
    const original = { ...DEFAULT_APPEARANCE, fontSizePx: 11.33, lineHeight: 1.23, marginPx: 11.7 };
    const result = onePageAppearance(original, 1);
    expect(result.fontSizePx).toBe(original.fontSizePx);
    expect(result.lineHeight).toBe(original.lineHeight);
    expect(result.marginPx).toBe(original.marginPx);
  });
});

describe('smart one-page search', () => {
  it('checks an already single-page PDF without changing any settings', async () => {
    const original = fitExample(), before = structuredClone(original), measure = vi.fn(async () => ({ pages: 1 }));
    const result = await smartOnePage(original, measure);
    expect(result).toMatchObject({ status: 'already', beforePages: 1, pages: 1, attempts: 1, changes: [] });
    expect(result.resume).toEqual(before); expect(original).toEqual(before); expect(measure).toHaveBeenCalledTimes(1);
  });

  it.each(['single', 'double'] as const)('merges manual pages in %s reading order without shrinking typography or dropping hidden sections', async mode => {
    const original = fitExample(); original.layout.mode = mode;
    const ids = original.layout.groups[0].main;
    original.layout.groups = [{ id: original.layout.groups[0].id, main: ids.slice(0, 3), sidebar: ids.slice(3, 5) }, { id: uid('page'), main: ids.slice(5, 10), sidebar: ids.slice(10) }];
    const before = structuredClone(original);
    const result = await smartOnePage(original, async candidate => ({ pages: candidate.layout.groups.length }));
    const group = result.resume.layout.groups[0];
    expect(result.status).toBe('fit'); expect(result.attempts).toBe(2); expect(result.resume.appearance).toEqual(original.appearance);
    expect(group.main).toEqual(mode === 'single' ? original.layout.groups.flatMap(page => [...page.main, ...page.sidebar]) : original.layout.groups.flatMap(page => page.main));
    expect(group.sidebar).toEqual(mode === 'single' ? [] : original.layout.groups.flatMap(page => page.sidebar));
    expect(new Set([...group.main, ...group.sidebar])).toEqual(new Set(original.sections.map(section => section.id)));
    expect(unchangedData(result.resume)).toEqual(unchangedData(original)); expect(original).toEqual(before);
  });

  it('tightens whitespace while keeping manual field order, visibility, inline options and alignment', async () => {
    const original = fitExample(), work = original.sections.find(section => section.kind === 'work')!;
    work.contentLayout = defaultContentLayout(work); work.contentLayout.fields.reverse();
    work.contentLayout.fields.find(field => field.key === 'location')!.visible = false;
    work.contentLayout.fields.find(field => field.key === 'company')!.inline = false;
    work.contentLayout.fields.find(field => field.key === 'position')!.align = 'center';
    const before = structuredClone(original);
    const result = await smartOnePage(original, async candidate => ({ pages: (candidate.appearance.spacingScale ?? 1) < .7 ? 1 : 2 }));
    const after = result.resume.sections.find(section => section.kind === 'work')!;
    expect(result.status).toBe('fit'); expect(after.contentLayout!.fields).toEqual(work.contentLayout.fields);
    expect(after.contentLayout!.rowGapPx).toBeLessThan(work.contentLayout.rowGapPx);
    expect(result.resume.appearance.fontSizePx).toBe(original.appearance.fontSizePx);
    expect(result.resume.appearance.lineHeight).toBe(original.appearance.lineHeight);
    expect(result.resume.appearance.avatar).toEqual(original.appearance.avatar);
    expect(unchangedData(result.resume)).toEqual(unchangedData(before)); expect(original).toEqual(before);
  });

  it('tries natural-width field layouts before reducing fonts and never hides a displayed field', async () => {
    const original = fitExample(), measured: Resume[] = [];
    const result = await smartOnePage(original, async candidate => {
      measured.push(candidate);
      return { pages: candidate.sections.find(section => section.kind === 'work')?.contentLayout?.fields.some(field => field.key === 'position' && field.inline) ? 1 : 2 };
    });
    expect(result.status).toBe('fit'); expect(measured.every(candidate => candidate.appearance.fontSizePx === original.appearance.fontSizePx)).toBe(true);
    const work = result.resume.sections.find(section => section.kind === 'work')!;
    expect(work.contentLayout!.fields.every(field => field.visible)).toBe(true);
    expect(work.contentLayout!.fields.find(field => field.key === 'summary')!.newLine).toBe(true);
    expect(work.contentLayout!.fields.find(field => field.key === 'summary')!.inline).toBe(false);
    expect(unchangedData(result.resume)).toEqual(unchangedData(original)); expect(() => parseResume(result.resume)).not.toThrow();
  });

  it('uses actual PDF feedback to balance multiple modules before font reduction', async () => {
    const original = fitExample(), measured: Resume[] = [];
    const result = await smartOnePage(original, async candidate => {
      measured.push(candidate);
      const side = candidate.layout.groups[0].sidebar;
      return { pages: candidate.layout.mode === 'double' && side.some(id => candidate.sections.find(section => section.id === id)?.visible) ? 1 : 2 };
    });
    expect(result.status).toBe('fit'); expect(result.resume.layout.mode).toBe('double');
    expect(measured.every(candidate => candidate.appearance.fontSizePx === original.appearance.fontSizePx)).toBe(true);
    const placed = result.resume.layout.groups.flatMap(group => [...group.main, ...group.sidebar]);
    expect(new Set(placed).size).toBe(placed.length); expect(new Set(placed)).toEqual(new Set(original.sections.map(section => section.id)));
    expect(result.resume.appearance.templateId).toBe(original.appearance.templateId);
    expect(result.resume.appearance.fontFamilyId).toBe(original.appearance.fontFamilyId);
    expect(result.resume.appearance.themeColor).toBe(original.appearance.themeColor);
    expect(unchangedData(result.resume)).toEqual(unchangedData(original));
  });

  it('retreats from a measured successful minimum to a more readable measured one-page result', async () => {
    const original = fitExample(), fonts: number[] = [];
    const result = await smartOnePage(original, async candidate => {
      fonts.push(candidate.appearance.fontSizePx);
      return { pages: candidate.appearance.fontSizePx <= 12.75 ? 1 : 2 };
    });
    expect(result.status).toBe('fit'); expect(result.resume.appearance.fontSizePx).toBe(12.75);
    expect(result.resume.appearance.lineHeight).toBeGreaterThanOrEqual(1.25);
    expect(result.resume.appearance.marginPx).toBeGreaterThanOrEqual(14);
    const minimum = fonts.indexOf(12);
    expect(minimum).toBeGreaterThan(0); expect(fonts.slice(minimum + 1).some(font => font > 12)).toBe(true);
    expect(result.attempts).toBeLessThanOrEqual(20); expect(result.pages).toBe(1);
  });

  it('reduces wide printable margins before touching font size or line height', async () => {
    const original = fitExample(); original.appearance.marginPx = 80;
    const before = structuredClone(original), measured: Resume[] = [];
    const result = await smartOnePage(original, async candidate => {
      measured.push(candidate);
      return { pages: candidate.appearance.marginPx <= 14 ? 1 : 2 };
    });
    expect(result.status).toBe('fit'); expect(result.resume.appearance.marginPx).toBe(14);
    expect(result.resume.appearance.fontSizePx).toBe(original.appearance.fontSizePx);
    expect(result.resume.appearance.lineHeight).toBe(original.appearance.lineHeight);
    expect(measured.every(candidate => candidate.appearance.fontSizePx === original.appearance.fontSizePx && candidate.appearance.lineHeight === original.appearance.lineHeight)).toBe(true);
    expect(result.attempts).toBe(measured.length); expect(result.attempts).toBeLessThanOrEqual(20);
    expect(unchangedData(result.resume)).toEqual(unchangedData(before)); expect(original).toEqual(before);
  });

  it('returns the best real page count on failure within the budget and keeps smaller manual typography intact', async () => {
    const original = fitExample(), before = structuredClone(original), measured: Resume[] = [], progress: [string, number][] = [];
    const result = await smartOnePage(original, async candidate => { measured.push(candidate); return { pages: candidate.appearance.fontSizePx <= 12 ? 2 : 4 }; }, { onProgress: (message, attempts) => progress.push([message, attempts]) });
    expect(result.status).toBe('unfit'); expect(result.beforePages).toBe(4); expect(result.pages).toBe(2);
    expect(result.attempts).toBe(measured.length); expect(result.attempts).toBeLessThanOrEqual(20);
    expect(progress.map(([, count]) => count)).toEqual(Array.from({ length: measured.length }, (_, index) => index + 1));
    expect(progress.every(([message]) => /[\u4e00-\u9fff]/.test(message))).toBe(true);
    expect(unchangedData(result.resume)).toEqual(unchangedData(original)); expect(original).toEqual(before);
    const smaller = fitExample(); Object.assign(smaller.appearance, { fontSizePx: 11.33, lineHeight: 1.23, marginPx: 11.7, spacingScale: .45 });
    const limits: Resume[] = [];
    await smartOnePage(smaller, async candidate => { limits.push(candidate); return { pages: 2 }; });
    expect(limits.every(candidate => candidate.appearance.fontSizePx === 11.33 && candidate.appearance.lineHeight === 1.23 && candidate.appearance.marginPx === 11.7 && candidate.appearance.spacingScale! >= .45)).toBe(true);
  });

  it('honours cancellation before and during real measurements', async () => {
    const original = fitExample(), controller = new AbortController(), skipped = vi.fn(async () => ({ pages: 2 })); controller.abort();
    await expect(smartOnePage(original, skipped, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(skipped).not.toHaveBeenCalled();
    const running = new AbortController(); let calls = 0;
    await expect(smartOnePage(original, async () => { if (++calls === 2) running.abort(); return { pages: 2 }; }, { signal: running.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(2);
  });
});
