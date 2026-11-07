import { describe, expect, it } from 'vitest';
import { alignPreviewField, previewAlignmentState } from './fieldAlignment';
import { contentLayoutRows, defaultContentLayout, resolveContentLayout } from './contentLayout';
import { movePreviewField } from './fieldDrop';
import { createExample, parseResume, remapResume, snapshotOf } from './resume';
import { diffSnapshots } from '../features/history/diff';
import type { Section, TextAlignment } from './types';

const fixture = () => {
  const resume = createExample();
  const section = resume.sections.find(section => section.kind === 'education')!;
  section.contentLayout = defaultContentLayout(section);
  return { resume, section };
};
const rowKeys = (section: Section) => contentLayoutRows(section).map(row => row.map(field => field.key));

describe('preview alignment respects containing layout levels', () => {
  it('changes only one text field within its slot and keeps peers and row order intact', () => {
    const { section } = fixture(), before = structuredClone(section);
    const changed = alignPreviewField(section, 'major', 'field', 'center')!;
    expect(changed.fields.find(field => field.key === 'major')).toMatchObject({ align: 'center', inline: false });
    expect(changed.fields.filter(field => field.key !== 'major')).toEqual(before.contentLayout!.fields.filter(field => field.key !== 'major'));
    expect(rowKeys({ ...section, contentLayout: changed })).toEqual(rowKeys(before));
    expect(section).toEqual(before);
  });

  it('aligns a whole row including hidden leaders, without leaking into other rows', () => {
    const { section } = fixture();
    section.contentLayout!.fields.find(field => field.key === 'major')!.visible = false;
    const changed = alignPreviewField(section, 'studyType', 'row', 'center')!;
    expect(changed.fields.filter(field => field.rowAlign).map(field => field.key)).toEqual(['major', 'studyType', 'score']);
    const resolved = contentLayoutRows({ ...section, contentLayout: changed });
    expect(resolved.find(row => row.some(field => field.key === 'studyType'))!.every(field => field.rowAlign === 'center')).toBe(true);
    expect(resolved[0].every(field => field.rowAlign === undefined)).toBe(true);
    // A group alignment can be cleared without leaving new inline packing behind.
    const reset = alignPreviewField({ ...section, contentLayout: changed }, 'studyType', 'row', null)!;
    expect(reset).toEqual(section.contentLayout);
  });

  it('uses a row override above the module default, and replaces overrides on module-wide selection', () => {
    const { section } = fixture();
    section.contentLayout = alignPreviewField(section, 'institution', 'module', 'right')!;
    section.contentLayout = alignPreviewField(section, 'major', 'row', 'center')!;
    expect(previewAlignmentState(section, 'major')).toMatchObject({ row: 'center', module: 'right' });
    expect(previewAlignmentState(section, 'institution')).toMatchObject({ row: 'right', module: 'right' });
    section.contentLayout = alignPreviewField(section, 'institution', 'module', 'left')!;
    expect(section.contentLayout.fields.every(field => field.rowAlign === undefined)).toBe(true);
    expect(contentLayoutRows(section).flat().every(field => field.rowAlign === 'left')).toBe(true);
    expect(alignPreviewField(section, 'institution', 'module', 'left')).toBeNull();
  });

  it('inherits destination row alignment on merge and carries source alignment on a new row', () => {
    const { section } = fixture();
    section.contentLayout = alignPreviewField(section, 'institution', 'row', 'right')!;
    section.contentLayout = alignPreviewField(section, 'major', 'row', 'center')!;
    section.contentLayout = movePreviewField(section, 'major', 'institution', 'after')!;
    expect(contentLayoutRows(section)[0].every(field => field.rowAlign === 'right')).toBe(true);
    expect(previewAlignmentState(section, 'score').row).toBe('center');
    section.contentLayout = movePreviewField(section, 'major', 'summary', 'above')!;
    expect(previewAlignmentState(section, 'major').row).toBe('right');
    expect(previewAlignmentState(section, 'summary').row).toBeNull();
  });

  it('overrides paragraph alignment without editing rich-text content and preserves new metadata across copies', () => {
    const { resume, section } = fixture(), before = snapshotOf(resume), data = structuredClone(section);
    section.contentLayout = alignPreviewField(section, 'summary', 'field', 'right')!;
    section.contentLayout = alignPreviewField(section, 'institution', 'module', 'center')!;
    const copied = remapResume(parseResume(JSON.parse(JSON.stringify(resume)))).sections.find(section => section.kind === 'education')!;
    expect(resolveContentLayout(copied)).toMatchObject({ rowAlign: 'center' });
    expect(copied.contentLayout!.fields.find(field => field.key === 'summary')!.paragraphAlign).toBe('right');
    expect(section.kind === 'education' && section.items).toEqual(data.kind === 'education' && data.items);
    expect(diffSnapshots(before, snapshotOf(resume)).find(change => change.label === '教育背景 · 模块内排版')!.after).toContain('模块各行居中');
  });

  it('rejects invalid alignments and ignores unknown or hidden fields', () => {
    const { resume, section } = fixture();
    expect(alignPreviewField(section, 'absent', 'row', 'center')).toBeNull();
    expect(alignPreviewField(section, 'institution', 'row', 'outside' as TextAlignment)).toBeNull();
    section.contentLayout!.fields[0].visible = false;
    expect(alignPreviewField(section, section.contentLayout!.fields[0].key, 'row', 'right')).toBeNull();
    for (const key of ['rowAlign', 'paragraphAlign']) {
      const broken = structuredClone(resume), target = broken.sections.find(s => s.id === section.id)!;
      Object.assign(target.contentLayout!.fields[1], { [key]: 'outside' });
      expect(() => parseResume(broken)).toThrow();
    }
    Object.assign(section.contentLayout!, { rowAlign: 'outside' });
    expect(() => parseResume(resume)).toThrow();
  });
});
