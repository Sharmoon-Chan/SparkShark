import { describe, expect, it } from 'vitest';
import { applyTemplate, createExample, createResume, moveSection, parseResume, remapResume, removePage, uid } from './resume';
import { parseBackup, parseText, resumeFromText } from '../features/import-export/parsers';

const placed = (resume: ReturnType<typeof createResume>) => resume.layout.groups.flatMap(group => [...group.main, ...group.sidebar]);
describe('resume invariants', () => {
  it('duplicates independently and remaps custom values and every layout reference', () => {
    const original = createExample(), before = structuredClone(original), copy = remapResume(original, '副本');
    expect(copy.id).not.toBe(original.id);
    expect(copy.sections.map(section => section.id).some(id => original.sections.some(section => section.id === id))).toBe(false);
    expect(new Set(placed(copy))).toEqual(new Set(copy.sections.map(section => section.id)));
    copy.basics.name = '另一个姓名';
    const custom = copy.sections.find(section => section.kind === 'custom');
    if (custom?.kind === 'custom') expect(Object.keys(custom.items[0].values).every(id => custom.fieldDefinitions.some(field => field.id === id))).toBe(true);
    expect(original).toEqual(before);
  });
  it('moves a hidden section across pages without dropping or duplicating data', () => {
    const resume = createExample(), section = resume.sections.find(section => !section.visible)!;
    resume.layout.groups.push({ id: uid('page'), main: [], sidebar: [] });
    const next = moveSection(resume, section.id, resume.layout.groups.at(-1)!.id, 'sidebar', 0);
    expect(placed(next).filter(id => id === section.id)).toHaveLength(1);
    expect(next.sections.find(item => item.id === section.id)).toEqual(section);
    expect(() => parseResume(next)).not.toThrow();
  });
  it('removes a populated page by moving its sections in order', () => {
    const resume = createExample(); const page = resume.layout.groups[1], target = resume.layout.groups[0];
    const next = removePage(resume, page.id, target.id);
    expect(next.layout.groups).toHaveLength(1);
    expect(next.layout.groups[0].main).toEqual([...target.main, ...page.main]);
    expect(next.sections).toEqual(resume.sections);
  });
  it('changes a template without changing content, font, color or stored placement', () => {
    const original = createExample(); const next = applyTemplate(original, 'clean');
    expect(next.sections).toEqual(original.sections); expect(next.basics).toEqual(original.basics);
    expect(next.layout.groups).toEqual(original.layout.groups); expect(next.appearance.fontFamilyId).toBe(original.appearance.fontFamilyId); expect(next.appearance.themeColor).toBe(original.appearance.themeColor);
  });
  it('rejects newer backups rather than losing unknown data', () => {
    expect(() => parseBackup(JSON.stringify({ format: 'myresume', schemaVersion: 2, resumes: [] }))).toThrow(/版本/);
  });
  it('keeps unmapped Markdown content in a custom section', () => {
    const source = '# 个人总结\n\n熟悉 React。\n\n# 校园活动\n\n组织活动，原始日期：2024—至今。';
    const candidate = parseText(source, '文本测试'); const resume = resumeFromText(candidate, 'zh-CN');
    const custom = resume.sections.find(section => section.kind === 'custom');
    expect(custom?.titleOverride).toBe('校园活动'); expect(JSON.stringify(custom)).toContain('组织活动'); expect(JSON.stringify(custom)).toContain('2024—至今');
    expect(() => parseResume(resume)).not.toThrow();
  });
  it('keeps inline HTML as plain text without producing nested block nodes', () => {
    const resume = resumeFromText(parseText('# 个人总结\n\n保留 <b>原文</b>，不执行标签。'), 'zh-CN');
    expect(JSON.stringify(resume)).toContain('<b>');
    expect(() => parseResume(resume)).not.toThrow();
  });
});
