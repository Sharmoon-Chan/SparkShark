import { describe, expect, it } from 'vitest';
import { createExample, createResume, parseResume } from '../domain/resume';
import { defaultContentLayout } from '../domain/contentLayout';
import { estimateOnePageCost, mergeOnePageGroups, spacingCandidate } from './onePageStrategies';

describe('one-page structure preservation', () => {
  it('estimates primary titles at their inherited size while keeping weight separate', () => {
    const resume = createExample(), work = resume.sections.find(section => section.kind === 'work')!;
    work.contentLayout = defaultContentLayout(work);
    const primary = work.contentLayout.fields.find(field => field.key === 'company')!;
    const normal = estimateOnePageCost(resume);
    primary.emphasis = 'normal';
    work.contentLayout.fields.find(field => field.key === 'position')!.emphasis = 'bold';
    expect(estimateOnePageCost(resume)).toBe(normal);
    primary.fontSizePx = resume.appearance.fontSizePx;
    expect(estimateOnePageCost(resume)).toBeLessThan(normal);
  });
  it('keeps every spacing interpolation candidate schema-valid, including the minimum endpoint', () => {
    for (const scale of [undefined, 1, .9, .7, .45]) {
      const original = createResume(); if (scale !== undefined) original.appearance.spacingScale = scale;
      for (const amount of [0, .35, .65, .999999999999, 1, 2]) {
        const candidate = spacingCandidate(original, amount);
        expect(() => parseResume(candidate)).not.toThrow();
        expect(candidate.appearance.spacingScale ?? 1).toBeGreaterThanOrEqual(.45);
        expect(candidate.appearance.spacingScale ?? 1).toBeLessThanOrEqual(scale ?? 1);
      }
      expect(spacingCandidate(original, 1).appearance.spacingScale).toBe(.45);
    }
  });
  it('merges breaks and tightens gaps without reallocating double-column modules or widths', () => {
    const resume = createResume();
    const before = structuredClone(resume);
    const merged = mergeOnePageGroups(resume);
    for (const amount of [0, .65, 1]) {
      const candidate = spacingCandidate(merged, amount);
      expect(candidate.layout).toEqual(resume.layout);
      expect(candidate.appearance.columnGapPx).toBe(resume.appearance.columnGapPx);
    }
    expect(resume).toEqual(before);
  });
});
