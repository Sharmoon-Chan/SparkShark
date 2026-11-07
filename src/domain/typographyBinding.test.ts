import { describe, expect, it } from 'vitest';
import { defaultContentLayout } from './contentLayout';
import { createExample, parseResume, remapResume, snapshotOf } from './resume';
import { resetResumeFontSizes, updatePageAppearance } from './typographyBinding';
import { contentFontSize } from '../rendering/contentLayoutView';
import { movePreviewField } from './fieldDrop';
import { onePageExpansion } from '../rendering/onePageFill';
import { captureOnePageRestore, restoreOnePageFormat } from '../rendering/onePageRestore';
import { diffSnapshots } from '../features/history/diff';

function fixture() {
  const resume = createExample(); resume.appearance.fontSizePx = 13;
  const project = resume.sections.find(section => section.kind === 'projects')!;
  project.contentLayout = defaultContentLayout(project);
  for (const [key, size] of [['name', 12.5], ['description', 10], ['summary', 12]] as const) project.contentLayout.fields.find(field => field.key === key)!.fontSizePx = size;
  return resume;
}
const project = (resume: ReturnType<typeof fixture>) => {
  const section = resume.sections.find(section => section.kind === 'projects');
  if (section?.kind !== 'projects') throw new Error('Missing projects fixture');
  return section;
};
const field = (resume: ReturnType<typeof fixture>, key = 'name') => project(resume).contentLayout!.fields.find(field => field.key === key)!;

describe('page and field typography binding', () => {
  it('converts legacy pixel overrides at a page size change without changing content or placement', () => {
    const resume = fixture(), before = structuredClone(resume);
    updatePageAppearance(resume, { themeColor: '#123456' });
    expect(field(resume).fontSizePx).toBe(12.5);
    updatePageAppearance(resume, { fontSizePx: 16 });
    expect(contentFontSize(field(resume), 16, { primary: true })).toBeCloseTo(12.5 * 16 / 13);
    expect(contentFontSize(field(resume, 'summary'), 16)).toBeCloseTo(12 * 16 / 13);
    expect(field(resume).fontSizePx).toBeUndefined();
    expect(project(resume).items).toEqual(project(before).items);
    expect(resume.layout).toEqual(before.layout);
    expect(project(resume).contentLayout!.fields.map(({ fontSizePx: _px, fontSizeRatio: _ratio, ...rest }) => rest)).toEqual(project(before).contentLayout!.fields.map(({ fontSizePx: _px, ...rest }) => rest));
    for (const size of [24, 10, 18, 13]) { updatePageAppearance(resume, { fontSizePx: size }); expect(() => parseResume(resume)).not.toThrow(); }
    expect(contentFontSize(field(resume), 13)).toBeCloseTo(12.5);
  });

  it('resets only field sizes and restores the same title/body hierarchy in every module', () => {
    const resume = fixture(); field(resume).italic = true; field(resume).underline = true;
    const before = structuredClone(resume);
    resetResumeFontSizes(resume);
    expect(contentFontSize(field(resume), 13, { primary: true })).toBeCloseTo(13 * 18 / 14);
    expect(contentFontSize(field(resume, 'summary'), 13)).toBe(13);
    expect(contentFontSize(field(resume, 'description'), 13)).toBe(13);
    expect(field(resume)).toMatchObject({ italic: true, underline: true });
    expect(project(resume).contentLayout!.rowGapPx).toBe(project(before).contentLayout!.rowGapPx);
    expect(resume.basics).toEqual(before.basics);
  });

  it('retains ratios through backup, copying, movement and human-readable history', () => {
    const resume = fixture(), before = snapshotOf(resume);
    updatePageAppearance(resume, { fontSizePx: 16 });
    const copy = remapResume(parseResume(JSON.parse(JSON.stringify(resume))));
    const moved = movePreviewField(project(copy), 'name', 'summary', 'below')!;
    expect(moved.fields.find(field => field.key === 'name')!.fontSizeRatio).toBe(12.5 / 13);
    expect(diffSnapshots(before, snapshotOf(resume)).find(change => change.label === '项目经历 · 模块内排版')!.after).toContain('字号随页面');
  });

  it('rejects invalid or ambiguous overrides while keeping old backups readable', () => {
    const resume = fixture();
    for (const value of [0, .1, 3.61, Infinity, null]) {
      const broken = structuredClone(resume); delete field(broken).fontSizePx;
      Object.assign(field(broken), { fontSizeRatio: value });
      expect(() => parseResume(broken)).toThrow();
    }
    field(resume).fontSizeRatio = 1.2;
    expect(() => parseResume(resume)).toThrow();
    delete field(resume).fontSizeRatio;
    expect(() => parseResume(resume)).not.toThrow();
  });

  it('scales configured sizes during smart expansion and restores them after a later field move', () => {
    const original = fixture(), expanded = onePageExpansion(original, 1, 'typography');
    expect(expanded.appearance.fontSizePx).toBe(18);
    expect(expanded.appearance.lineHeight).toBe(2);
    expect(contentFontSize(field(expanded), 18)).toBeCloseTo(12.5 * 18 / 13);
    const record = captureOnePageRestore(original, expanded);
    project(expanded).contentLayout!.fields.reverse();
    field(expanded, 'description').fontSizeRatio = 1.3;
    const restored = restoreOnePageFormat(expanded, record);
    expect(field(restored).fontSizePx).toBe(12.5);
    expect(field(restored).fontSizeRatio).toBeUndefined();
    expect(field(restored, 'description').fontSizeRatio).toBe(1.3);
    expect(field(restored, 'description').fontSizePx).toBeUndefined();
    expect(project(restored).contentLayout!.fields.map(field => field.key)).toEqual(project(expanded).contentLayout!.fields.map(field => field.key));
    expect(() => parseResume(restored)).not.toThrow();
  });
});
