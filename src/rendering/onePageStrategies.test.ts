import { describe, expect, it } from 'vitest';
import { createResume, newItem, parseResume, plainRich } from '../domain/resume';
import { onePageLayoutCandidates, spacingCandidate } from './onePageStrategies';

describe('one-page column eligibility', () => {
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
  it('does not narrow a long dominant module just to create a sidebar', () => {
    const resume = createResume(); resume.layout.mode = 'single';
    resume.layout.groups[0].main.push(...resume.layout.groups[0].sidebar); resume.layout.groups[0].sidebar = [];
    resume.sections.forEach(section => { section.visible = false; });
    const work = resume.sections.find(section => section.kind === 'work')!;
    if (work.kind === 'work') { work.visible = true; work.items = [{ ...newItem('work'), fields: { ...newItem('work').fields, company: '公司', summary: plainRich('长正文应保持充分阅读宽度。'.repeat(200)) } }]; }
    for (const kind of ['skills', 'languages'] as const) {
      const section = resume.sections.find(item => item.kind === kind)!;
      if (section.kind === kind) { section.visible = true; section.items = [{ ...newItem(kind), fields: { ...newItem(kind).fields, name: kind } }]; }
    }
    expect(onePageLayoutCandidates(resume).some(candidate => candidate.resume.layout.mode === 'double')).toBe(false);
  });
});
