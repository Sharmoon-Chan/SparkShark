import { describe, expect, it } from 'vitest';
import { createResume, newItem, plainRich } from '../domain/resume';
import { checkGlyphs } from './fonts';
import { importMarkerFields, preparePdfImportMarkers } from './importMarkers';

describe('unreadable import markers', () => {
  it('renders explicit placeholders while retaining the original field and blocking affected links', () => {
    const resume = createResume(), section = resume.sections.find(section => section.kind === 'projects')!;
    if (section.kind !== 'projects') throw new Error('Missing projects');
    const item = newItem('projects'); item.fields.name = '校对项目'; item.fields.dateText = '����.�� - ����.��';
    item.fields.summary = plainRich('模型名称 BGE-M�'); item.fields.url = 'https://example.com/�'; section.items = [item];
    const before = structuredClone(resume), result = preparePdfImportMarkers(resume);
    expect(resume).toEqual(before);
    expect(importMarkerFields(resume)).toContain('项目经历 · 第 1 条 · 日期');
    expect(JSON.stringify(result.resume)).not.toContain('�');
    expect(JSON.stringify(result.resume)).toContain('????.?? - ????.??');
    expect(result.blockedLinks.has('https://example.com/?')).toBe(true);
    expect(() => checkGlyphs(result.resume)).not.toThrow();
  });
  it('continues to reject genuine unsupported characters', () => {
    const resume = createResume(); resume.basics.name = '\u{10ffff}';
    expect(() => checkGlyphs(preparePdfImportMarkers(resume).resume)).toThrow(/缺少可用字形/);
  });
});
