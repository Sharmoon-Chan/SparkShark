import { describe, expect, it } from 'vitest';
import { createExample, newSection, parseResume } from '../domain/resume';
import { defaultContentLayout } from '../domain/contentLayout';
import { captureOnePageRestore, restoreOnePageFormat } from './onePageRestore';

describe('smart fit restoration', () => {
  it('restores merged pages and fitted spacing while preserving new content, theme and avatar shape', () => {
    const original = createExample(), fitted = structuredClone(original);
    fitted.layout.groups = [{ ...fitted.layout.groups[0], main: fitted.layout.groups.flatMap(group => group.main), sidebar: fitted.layout.groups.flatMap(group => group.sidebar) }];
    fitted.appearance.spacingScale = .6; fitted.appearance.avatar.widthPx = 64;
    const work = fitted.sections.find(section => section.kind === 'work')!; work.contentLayout = defaultContentLayout(work);
    const record = captureOnePageRestore(original, fitted);
    fitted.basics.headline = '保留新职位'; fitted.appearance.themeColor = '#334155'; fitted.appearance.avatar.radiusPx = 0;
    const added = newSection('summary'); fitted.sections.push(added); fitted.layout.groups[0].main.push(added.id);
    const restored = restoreOnePageFormat(fitted, record);
    expect(restored.basics.headline).toBe('保留新职位'); expect(restored.appearance.themeColor).toBe('#334155'); expect(restored.appearance.avatar.radiusPx).toBe(0);
    expect(restored.appearance.avatar.widthPx).toBe(original.appearance.avatar.widthPx);
    expect(restored.layout.groups.length).toBe(original.layout.groups.length);
    expect(restored.layout.groups.flatMap(group => [...group.main, ...group.sidebar])).toContain(added.id);
    expect(restored.sections.find(section => section.id === work.id)!.contentLayout).toBeUndefined();
    expect(() => parseResume(restored)).not.toThrow();
  });
  it('retains field moves performed after fitting', () => {
    const original = createExample(), fitted = structuredClone(original), section = fitted.sections.find(section => section.kind === 'education')!;
    section.contentLayout = defaultContentLayout(section); section.contentLayout.rowGapPx = 1;
    const record = captureOnePageRestore(original, fitted);
    section.contentLayout.fields.reverse();
    const order = section.contentLayout.fields.map(field => field.key);
    const restored = restoreOnePageFormat(fitted, record), settings = restored.sections.find(item => item.id === section.id)!.contentLayout!;
    expect(settings.fields.map(field => field.key)).toEqual(order); expect(settings.rowGapPx).toBe(4);
  });
});
