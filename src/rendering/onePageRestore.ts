import type { Appearance, Layout, Resume, SectionContentLayout } from '../domain/types';
import { defaultContentLayout } from '../domain/contentLayout';

interface FormatState { appearance: Appearance; layout: Layout; sections: Record<string, SectionContentLayout | null> }
export interface OnePageRestore { resumeId: string; before: FormatState; after: FormatState }
const formatState = (resume: Resume): FormatState => ({ appearance: structuredClone(resume.appearance), layout: structuredClone(resume.layout), sections: Object.fromEntries(resume.sections.map(section => [section.id, section.contentLayout ? structuredClone(section.contentLayout) : null])) });
const different = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

export function captureOnePageRestore(before: Resume, after: Resume): OnePageRestore { return { resumeId: before.id, before: formatState(before), after: formatState(after) }; }

/** Restore changed formatting while retaining edits to content and unrelated appearance. */
export function restoreOnePageFormat(current: Resume, record: OnePageRestore): Resume {
  if (current.id !== record.resumeId) return structuredClone(current);
  const next = structuredClone(current), { before, after } = record;
  const appearance = next.appearance as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(before.appearance), ...Object.keys(after.appearance)])) {
    if (key === 'avatar') continue;
    const a = (before.appearance as unknown as Record<string, unknown>)[key], b = (after.appearance as unknown as Record<string, unknown>)[key];
    if (!different(a, b)) continue;
    if (a === undefined) delete appearance[key]; else appearance[key] = structuredClone(a);
  }
  for (const key of Object.keys(before.appearance.avatar) as (keyof Appearance['avatar'])[]) {
    if (different(before.appearance.avatar[key], after.appearance.avatar[key])) (next.appearance.avatar as unknown as Record<string, unknown>)[key] = structuredClone(before.appearance.avatar[key]);
  }
  if (different(before.layout, after.layout)) {
    next.layout = structuredClone(before.layout);
    const existing = new Set(next.sections.map(section => section.id));
    next.layout.groups.forEach(group => { group.main = group.main.filter(id => existing.has(id)); group.sidebar = group.sidebar.filter(id => existing.has(id)); });
    const placed = new Set(next.layout.groups.flatMap(group => [...group.main, ...group.sidebar]));
    next.layout.groups[0].main.push(...next.sections.filter(section => !placed.has(section.id)).map(section => section.id));
  }
  for (const section of next.sections) {
    const a = before.sections[section.id], b = after.sections[section.id];
    if (a === undefined || !different(a, b)) continue;
    const c = section.contentLayout;
    if (!different(c ?? null, b)) {
      if (a) section.contentLayout = structuredClone(a); else delete section.contentLayout;
    } else if (c && b) {
      // Keep field moves made after fitting; undo only the fitted spacing values.
      const original = a ?? defaultContentLayout(section);
      if (c.rowGapPx === b.rowGapPx) c.rowGapPx = original.rowGapPx;
      if (c.itemGapPx === b.itemGapPx) c.itemGapPx = original.itemGapPx;
    }
  }
  return next;
}
