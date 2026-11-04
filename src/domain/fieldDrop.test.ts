import { describe, expect, it } from 'vitest';
import { contentLayoutRows, defaultContentLayout } from './contentLayout';
import { movePreviewField } from './fieldDrop';
import { createExample, parseResume, plainRich } from './resume';
import type { CustomSection, FieldDropPlacement, Section, SectionContentLayout } from './types';

const rows = (section: Section, contentLayout: SectionContentLayout) => contentLayoutRows({ ...section, contentLayout }).map(row => row.map(field => field.key));

describe('field drops in the preview', () => {
  it('puts the major after the school while keeping degree and score on their original row', () => {
    const resume = createExample(), section = resume.sections.find(section => section.kind === 'education')!;
    const original = structuredClone(section);
    const changed = movePreviewField(section, 'major', 'institution', 'after')!;
    expect(rows(section, changed)).toEqual([['institution', 'major', 'dateText'], ['studyType', 'score'], ['officialUrl'], ['summary']]);
    expect(changed.fields.find(field => field.key === 'studyType')!.newLine).toBe(true);
    expect(section).toEqual(original);
    section.contentLayout = changed;
    expect(parseResume(resume).sections.find(item => item.id === section.id)!.contentLayout).toEqual(changed);
    expect(section.kind === 'education' && section.items).toEqual(original.kind === 'education' && original.items);
  });

  it('inserts above or below the entire target row rather than splitting its fields', () => {
    const section = createExample().sections.find(section => section.kind === 'work')!;
    const above = movePreviewField(section, 'url', 'location', 'above')!;
    expect(rows(section, above)).toEqual([['company', 'dateText'], ['url'], ['position', 'location'], ['summary']]);
    const below = movePreviewField(section, 'dateText', 'location', 'below')!;
    expect(rows(section, below)).toEqual([['company'], ['position', 'location'], ['dateText'], ['url'], ['summary']]);
    expect(below.fields.find(field => field.key === 'dateText')!.align).toBe('right');
  });

  it('supports insertion before a field and repairs an emptied source row', () => {
    const section = createExample().sections.find(section => section.kind === 'education')!;
    const changed = movePreviewField(section, 'dateText', 'major', 'before')!;
    expect(rows(section, changed)).toEqual([['institution'], ['dateText', 'major', 'studyType', 'score'], ['officialUrl'], ['summary']]);
    const movedSchool = movePreviewField(section, 'institution', 'score', 'after')!;
    expect(rows(section, movedSchool)).toEqual([['dateText'], ['major', 'studyType', 'score', 'institution'], ['officialUrl'], ['summary']]);
  });

  it('preserves hidden neighbours, their style and spacing when their visible row leader moves', () => {
    const section = createExample().sections.find(section => section.kind === 'education')!;
    section.contentLayout = defaultContentLayout(section);
    section.contentLayout.rowGapPx = 3; section.contentLayout.itemGapPx = 17;
    const degree = section.contentLayout.fields.find(field => field.key === 'studyType')!;
    degree.visible = false; degree.align = 'center'; degree.emphasis = 'normal';
    const original = structuredClone(section);
    const changed = movePreviewField(section, 'major', 'institution', 'after')!;
    expect(rows(section, changed)).toEqual([['institution', 'major', 'dateText'], ['score'], ['officialUrl'], ['summary']]);
    expect(changed).toMatchObject({ rowGapPx: 3, itemGapPx: 17 });
    expect(changed.fields.find(field => field.key === 'studyType')).toMatchObject({ visible: false, align: 'center', emphasis: 'normal', newLine: true });
    expect(new Set(changed.fields.map(field => field.key))).toEqual(new Set(section.contentLayout.fields.map(field => field.key)));
    expect(section).toEqual(original);
  });

  it('keeps rich text alone and preserves boundaries implied by a rich row', () => {
    const section = createExample().sections.find(section => section.kind === 'work')!;
    const movedRich = movePreviewField(section, 'summary', 'company', 'after')!;
    expect(rows(section, movedRich)).toEqual([['company', 'dateText'], ['summary'], ['position', 'location'], ['url']]);
    const movedBesideRich = movePreviewField(section, 'position', 'summary', 'after')!;
    expect(rows(section, movedBesideRich)).toEqual([['company', 'dateText'], ['location'], ['url'], ['summary'], ['position']]);
    const defaults = defaultContentLayout(section), map = new Map(defaults.fields.map(field => [field.key, field]));
    section.contentLayout = { ...defaults, fields: ['company', 'dateText', 'summary', 'position', 'location', 'url'].map(key => ({ ...map.get(key)!, newLine: key === 'company' })) };
    const changed = movePreviewField(section, 'company', 'url', 'above')!;
    expect(rows(section, changed)).toEqual([['dateText'], ['summary'], ['company'], ['position', 'location', 'url']]);
  });

  it('includes newly defined custom fields without changing their data or hiding them', () => {
    const section: CustomSection = { id: 'custom-section', kind: 'custom', titleOverride: '作品', visible: true,
      fieldDefinitions: [{ id: 'name', type: 'name', label: '名称', visible: true }, { id: 'body', type: 'summary', label: '说明', visible: true }],
      items: [{ id: 'custom-item', visible: true, values: { name: '作品示例', body: plainRich('保留的正文'), link: 'https://example.com' } }] };
    section.contentLayout = defaultContentLayout(section);
    section.fieldDefinitions.push({ id: 'link', type: 'url', label: '新链接', visible: true });
    const original = structuredClone(section), changed = movePreviewField(section, 'link', 'name', 'after')!;
    expect(rows(section, changed)).toEqual([['name', 'link'], ['body']]);
    expect(changed.fields.find(field => field.key === 'link')!.visible).toBe(true);
    expect(section).toEqual(original);
  });

  it('packs the major beside the school, recognizes existing packing, and clears it on a new row', () => {
    const section = createExample().sections.find(section => section.kind === 'education')!;
    const original = structuredClone(section);
    const packed = movePreviewField(section, 'major', 'institution', 'after')!;
    expect(packed.fields.find(field => field.key === 'institution')!.inline).toBe(true);
    expect(packed.fields.find(field => field.key === 'major')!.inline).toBe(true);
    expect(section).toEqual(original);
    section.contentLayout = packed;
    expect(movePreviewField(section, 'major', 'institution', 'after')).toBeNull();

    // A same-row layout saved before preview packing still needs a presentation update.
    section.contentLayout = structuredClone(packed);
    section.contentLayout.fields.filter(field => ['institution', 'major'].includes(field.key)).forEach(field => { delete field.inline; });
    const newlyPacked = movePreviewField(section, 'major', 'institution', 'after')!;
    expect(rows(section, newlyPacked)).toEqual(rows(section, packed));
    expect(newlyPacked.fields.filter(field => ['institution', 'major'].includes(field.key)).every(field => field.inline)).toBe(true);
    section.contentLayout = newlyPacked;
    expect(movePreviewField(section, 'major', 'institution', 'after')).toBeNull();

    const separate = movePreviewField(section, 'major', 'score', 'below')!;
    expect(separate.fields.find(field => field.key === 'major')!.inline).toBe(false);
    expect(separate.fields.find(field => field.key === 'institution')!.inline).toBe(true);
    expect(separate.fields.find(field => field.key === 'score')!.inline).toBeUndefined();
    expect(rows(section, separate)).toEqual([['institution', 'dateText'], ['studyType', 'score'], ['major'], ['officialUrl'], ['summary']]);
  });

  it('ignores invalid, hidden, identical and unchanged drops', () => {
    const section = createExample().sections.find(section => section.kind === 'work')!;
    expect(movePreviewField(section, 'company', 'company', 'after')).toBeNull();
    expect(movePreviewField(section, 'missing', 'company', 'after')).toBeNull();
    expect(movePreviewField(section, 'company', 'missing', 'after')).toBeNull();
    const packed = movePreviewField(section, 'company', 'dateText', 'before')!;
    expect(movePreviewField({ ...section, contentLayout: packed }, 'company', 'dateText', 'before')).toBeNull();
    expect(movePreviewField(section, 'url', 'location', 'below')).toBeNull();
    expect(movePreviewField(section, 'company', 'dateText', 'outside' as FieldDropPlacement)).toBeNull();
    section.contentLayout = defaultContentLayout(section);
    section.contentLayout.fields.find(field => field.key === 'dateText')!.visible = false;
    expect(movePreviewField(section, 'dateText', 'company', 'after')).toBeNull();
    expect(movePreviewField(section, 'company', 'dateText', 'after')).toBeNull();
  });
});
