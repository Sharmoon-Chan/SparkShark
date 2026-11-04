import { describe, expect, it } from 'vitest';
import { applyTemplate, createExample, defaultAppearanceForTemplate, parseResume } from './resume';
import { TEMPLATES } from './templates';

describe('template adaptation', () => {
  it('restores each template font and theme together with TalenCat standard page settings', () => {
    const essential = defaultAppearanceForTemplate('essential'), modern = defaultAppearanceForTemplate('modern');
    expect(essential).toMatchObject({ templateId: 'essential', fontFamilyId: 'noto-serif-sc', fontSizePx: 14, lineHeight: 1.5, marginPx: 18, hideIcons: true, underlineLinks: false });
    expect(modern).toMatchObject({ templateId: 'modern', fontFamilyId: 'noto-sans-sc', themeColor: '#2563EB', marginPx: 18 });
    essential.avatar.widthPx = 100;
    expect(defaultAppearanceForTemplate('essential').avatar.widthPx).toBe(80);
  });
  it('keeps content, hidden records and placement through every template and a JSON round trip', () => {
    const original = createExample(); const before = structuredClone(original);
    for (const template of TEMPLATES) {
      const changed = applyTemplate(original, template.id);
      const restored = parseResume(JSON.parse(JSON.stringify(changed)));
      expect(restored.basics).toEqual(original.basics);
      expect(restored.sections).toEqual(original.sections);
      expect(restored.layout.groups).toEqual(original.layout.groups);
      expect(restored.appearance.templateId).toBe(template.id);
      expect(restored.layout.mode).toBe(template.mode);
    }
    expect(original).toEqual(before);
  });
  it('retains custom appearance when the current adapted template is selected again', () => {
    const changed = applyTemplate(createExample(), 'modernSplit');
    changed.appearance.themeColor = '#AB1234'; changed.appearance.fontFamilyId = 'noto-serif-sc';
    changed.appearance.columnGapPx = 32; changed.layout.mainRatio = .62; changed.layout.sidebarSide = 'left';
    const selected = applyTemplate(changed, 'modernSplit');
    expect(selected.appearance).toEqual(changed.appearance);
    expect(selected.layout).toEqual(changed.layout);
  });
  it('uses distinct serif and right-sidebar defaults while preserving an explicit page layout', () => {
    const original = createExample();
    const essential = applyTemplate(original, 'essential'), modernSplit = applyTemplate(original, 'modernSplit');
    expect(essential.appearance.fontFamilyId).toBe('noto-serif-sc');
    expect(essential.layout.mode).toBe('single');
    expect(modernSplit.appearance.fontFamilyId).toBe('noto-sans-sc');
    expect(modernSplit.layout.sidebarSide).toBe('right');
    expect(modernSplit.layout.mainRatio).toBeGreaterThan(original.layout.mainRatio);
    expect(modernSplit.layout.groups).toEqual(original.layout.groups);
  });
  it('adapts a single-column import to a sidebar without losing, duplicating or moving sections across manual pages', () => {
    const original = createExample(); original.layout.mode = 'single';
    original.layout.groups.forEach(group => { group.main.push(...group.sidebar); group.sidebar = []; });
    const changed = applyTemplate(original, 'gradient');
    const placed = changed.layout.groups.flatMap(group => [...group.main, ...group.sidebar]);
    expect(new Set(placed).size).toBe(placed.length);
    expect(new Set(placed)).toEqual(new Set(original.sections.map(section => section.id)));
    expect(changed.basics).toEqual(original.basics); expect(changed.sections).toEqual(original.sections);
    original.layout.groups.forEach((group, index) => {
      const adapted = changed.layout.groups[index];
      expect(adapted.id).toBe(group.id);
      expect(new Set([...adapted.main, ...adapted.sidebar])).toEqual(new Set(group.main));
      expect(adapted.sidebar.every(id => ['profiles', 'skills', 'languages', 'interests'].includes(original.sections.find(section => section.id === id)!.kind))).toBe(true);
    });
    expect(changed.layout.groups[0].sidebar.length).toBeGreaterThan(0);
  });
});
