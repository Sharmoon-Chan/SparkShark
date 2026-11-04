import { describe, expect, it } from 'vitest';
import { contentFieldSpecs, contentLayoutRows, defaultContentLayout, resolveContentLayout } from './contentLayout';
import { createExample, parseResume, remapResume, snapshotOf, uid } from './resume';
import type { CustomSection } from './types';
import { diffSnapshots } from '../features/history/diff';
import { movePreviewField } from './fieldDrop';

describe('module content layouts', () => {
  it('preserves field typography through backup, copy and preview movement with readable history', () => {
    const original = createExample(), before = snapshotOf(original), work = original.sections.find(section => section.kind === 'work')!;
    const originalData = structuredClone(work);
    work.contentLayout = defaultContentLayout(work);
    Object.assign(work.contentLayout.fields.find(field => field.key === 'position')!, { fontSizePx: 18, italic: true, underline: true });
    const restored = parseResume(JSON.parse(JSON.stringify(original))), copy = remapResume(restored), copied = copy.sections.find(section => section.kind === 'work')!;
    expect(copied.contentLayout!.fields.find(field => field.key === 'position')).toMatchObject({ fontSizePx: 18, italic: true, underline: true });
    const moved = movePreviewField(copied, 'position', 'company', 'after')!;
    expect(moved.fields.find(field => field.key === 'position')).toMatchObject({ fontSizePx: 18, italic: true, underline: true, inline: true });
    expect(work.kind === 'work' && work.items).toEqual(originalData.kind === 'work' && originalData.items);
    const change = diffSnapshots(before, snapshotOf(original)).find(item => item.label === '工作经历 · 模块内排版')!;
    expect(change.after).toContain('字号 18px'); expect(change.after).toContain('斜体'); expect(change.after).toContain('下划线');
  });

  it('rejects invalid typography without requiring these settings in old backups', () => {
    const original = createExample(), work = original.sections.find(section => section.kind === 'work')!;
    work.contentLayout = defaultContentLayout(work);
    for (const invalid of [{ fontSizePx: 7 }, { fontSizePx: 37 }, { fontSizePx: null }, { italic: 'yes' }, { underline: 1 }]) {
      const broken = structuredClone(original), target = broken.sections.find(section => section.kind === 'work')!.contentLayout!.fields[0];
      Object.assign(target, invalid);
      expect(() => parseResume(broken)).toThrow();
    }
    expect(() => parseResume(original)).not.toThrow();
  });
  it('reads old resumes without adding presentation settings', () => {
    const original = createExample();
    const restored = parseResume(JSON.parse(JSON.stringify(original)));
    expect(restored.sections.every(section => !Object.hasOwn(section, 'contentLayout'))).toBe(true);
    const work = restored.sections.find(section => section.kind === 'work')!;
    expect(defaultContentLayout(work)).toMatchObject({ rowGapPx: 4, itemGapPx: 8 });
    expect(contentLayoutRows(work).map(row => row.map(field => field.key))).toEqual([
      ['company', 'dateText'], ['position', 'location'], ['url'], ['summary'],
    ]);
    expect(restored).toEqual(original);
  });

  it('keeps a hidden field row boundary and isolates rich content after reordering', () => {
    const resume = createExample(), work = resume.sections.find(section => section.kind === 'work')!;
    const original = structuredClone(work);
    const defaults = defaultContentLayout(work), byKey = new Map(defaults.fields.map(field => [field.key, field]));
    work.contentLayout = { ...defaults, fields: ['summary', 'company', 'dateText', 'location', 'position', 'url'].map(key => ({
      ...byKey.get(key)!, newLine: key === 'dateText', visible: key !== 'dateText',
    })) };
    expect(contentLayoutRows(work).map(row => row.map(field => field.key))).toEqual([
      ['summary'], ['company'], ['location', 'position', 'url'],
    ]);
    expect(work.kind === 'work' && work.items).toEqual(original.kind === 'work' && original.items);
  });

  it('ignores removed and hidden definitions, appends new fields, and preserves stored settings', () => {
    const section: CustomSection = { id: uid('section'), kind: 'custom', titleOverride: '作品', visible: true,
      fieldDefinitions: [{ id: 'name-field', type: 'name', label: '名称', visible: true }, { id: 'hidden-field', type: 'description', label: '备注', visible: false }, { id: 'new-field', type: 'url', label: '链接', visible: true }],
      items: [], contentLayout: { fields: [
        { key: 'gone-field', newLine: true, align: 'left', emphasis: 'normal', visible: true },
        { key: 'hidden-field', newLine: true, align: 'right', emphasis: 'muted', visible: true },
        { key: 'name-field', newLine: true, align: 'center', emphasis: 'bold', visible: false },
      ], rowGapPx: 3, itemGapPx: 12 } };
    const original = structuredClone(section), resolved = resolveContentLayout(section);
    expect(contentFieldSpecs(section).map(field => field.key)).toEqual(['name-field', 'new-field']);
    expect(resolved.fields.map(field => field.key)).toEqual(['name-field', 'new-field']);
    expect(resolved.fields[0]).toMatchObject({ visible: false, align: 'center', emphasis: 'bold' });
    expect(contentLayoutRows(section).map(row => row.map(field => field.key))).toEqual([['new-field']]);
    expect(section).toEqual(original);
  });

  it('rejects duplicated fields, invalid alignment and unsafe spacing in backups', () => {
    const original = createExample(), work = original.sections.find(section => section.kind === 'work')!;
    work.contentLayout = defaultContentLayout(work);
    for (const mutate of [
      (layout: Record<string, unknown>) => { const fields = layout.fields as unknown[]; fields.push(fields[0]); },
      (layout: Record<string, unknown>) => { (layout.fields as Record<string, unknown>[])[0].align = 'justify'; },
      (layout: Record<string, unknown>) => { layout.rowGapPx = -1; },
      (layout: Record<string, unknown>) => { layout.itemGapPx = 65; },
    ]) {
      const broken = structuredClone(original);
      mutate(broken.sections.find(section => section.kind === 'work')!.contentLayout as unknown as Record<string, unknown>);
      expect(() => parseResume(broken)).toThrow();
    }
  });

  it('remaps custom layout references during a copy and records readable history changes', () => {
    const original = createExample(), custom = original.sections.find(section => section.kind === 'custom') as CustomSection;
    custom.contentLayout = defaultContentLayout(custom);
    const copy = remapResume(original), copied = copy.sections.find(section => section.kind === 'custom') as CustomSection;
    expect(copied.contentLayout!.fields.map(field => field.key)).toEqual(copied.fieldDefinitions.filter(field => field.visible).map(field => field.id));
    expect(copied.contentLayout!.fields.every(field => !custom.fieldDefinitions.some(definition => definition.id === field.key))).toBe(true);
    const before = snapshotOf(original), after = structuredClone(before), work = after.sections.find(section => section.kind === 'work')!;
    work.contentLayout = defaultContentLayout(work);
    const change = diffSnapshots(before, after).find(difference => difference.label === '工作经历 · 模块内排版');
    expect(change).toMatchObject({ kind: 'change', before: '模板默认排版' });
    expect(change?.after).toContain('公司'); expect(change?.after).toContain('日期'); expect(change?.after).toContain('条目间距 8px');
  });
});
