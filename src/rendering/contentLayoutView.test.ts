import { describe, expect, it } from 'vitest';
import { createExample } from '../domain/resume';
import { defaultContentLayout } from '../domain/contentLayout';
import { checkGlyphs } from './fonts';
import { importMarkerFields } from './importMarkers';
import { moduleContentRows, sectionVisibleWithContent } from './contentLayoutView';

describe('configured module content', () => {
  it('keeps hidden problematic text in the data while excluding it from glyph and marker checks', () => {
    const resume = createExample(), work = resume.sections.find(section => section.kind === 'work')!;
    if (work.kind !== 'work') throw new Error('fixture');
    work.contentLayout = defaultContentLayout(work);
    work.items[0].fields.location = '隐藏地点 \uFFFD 🦄';
    work.contentLayout.fields.find(field => field.key === 'location')!.visible = false;
    expect(() => checkGlyphs(resume)).not.toThrow();
    expect(importMarkerFields(resume)).not.toContain('工作经历 · 第 1 条 · 地点');
    expect(moduleContentRows(work, work.items[0]).flat().some(cell => cell.layout.key === 'location')).toBe(false);
    expect(work.items[0].fields.location).toContain('🦄');
  });
  it('suppresses fully hidden modules and retains visible numeric levels', () => {
    const resume = createExample(), skills = resume.sections.find(section => section.kind === 'skills')!;
    if (skills.kind !== 'skills') throw new Error('fixture');
    skills.contentLayout = defaultContentLayout(skills);
    skills.contentLayout.fields.forEach(field => { field.visible = false; });
    expect(sectionVisibleWithContent(skills)).toBe(false);
    skills.contentLayout.fields.find(field => field.key === 'level')!.visible = true;
    expect(sectionVisibleWithContent(skills)).toBe(true);
    expect(moduleContentRows(skills, skills.items[0]).flat().map(cell => cell.text)).toEqual(['3 / 5']);
  });
});
