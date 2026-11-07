import type { CustomSection, FieldValue, ResumeItem, RichDocument, Section, ContentFieldLayout } from '../domain/types';
import { contentFieldSpecs, contentLayoutRows, type ContentFieldSpec } from '../domain/contentLayout';
import { hasContent, richText, safeLink, sectionHasContent } from '../domain/resume';
import { resumeTypeSize } from '../domain/typography';

type ContentItem = ResumeItem | CustomSection['items'][number];
export interface ContentCell { layout: ContentFieldLayout; spec: ContentFieldSpec; value: FieldValue; text: string; href?: string; rich?: RichDocument }

/** Keep group placement distinct from alignment inside an allocated text cell. */
export function contentRowPresentation(row: readonly ContentCell[]) {
  const rich = row.some(cell => cell.rich), alignment = row.find(cell => cell.layout.rowAlign !== undefined)?.layout.rowAlign;
  return { alignment, inline: !rich && (Boolean(alignment) || row.some(cell => cell.layout.inline)), justify: alignment === 'right' ? 'flex-end' as const : alignment === 'center' ? 'center' as const : 'flex-start' as const };
}

export function contentFontSize(layout: ContentFieldLayout, basePx: number, spec?: Pick<ContentFieldSpec, 'primary'>): number {
  return layout.fontSizeRatio !== undefined ? basePx * layout.fontSizeRatio : layout.fontSizePx ?? resumeTypeSize(basePx, spec?.primary ? 'entry' : 'body');
}

export function contentTextDecoration(underline: boolean, strike = false): 'none' | 'underline' | 'line-through' | 'underline line-through' {
  return underline ? strike ? 'underline line-through' : 'underline' : strike ? 'line-through' : 'none';
}

export function moduleContentRows(section: Section, item?: ContentItem): ContentCell[][] {
  const values: Record<string, FieldValue> = section.kind === 'summary' ? { summary: section.content } : item ? 'fields' in item ? item.fields : item.values : {};
  const specs = new Map(contentFieldSpecs(section).map(spec => [spec.key, spec]));
  return contentLayoutRows(section).map(row => row.flatMap(layout => {
    const spec = specs.get(layout.key), value = values[layout.key];
    if (!spec || !(typeof value === 'number' || hasContent(value))) return [];
    const rich = spec.type === 'rich' && value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
    const text = rich ? richText(rich) : Array.isArray(value) ? value.join(' · ') : typeof value === 'number' ? `${value} / 5` : String(value ?? '');
    return [{ layout, spec, value, text, rich, href: spec.type === 'url' ? safeLink(text) ?? undefined : undefined }];
  })).filter(row => row.length > 0);
}

export function sectionVisibleWithContent(section: Section): boolean {
  if (!section.contentLayout) return sectionHasContent(section);
  if (!section.visible) return false;
  return section.kind === 'summary' ? moduleContentRows(section).length > 0 : section.items.some(item => item.visible && moduleContentRows(section, item).length > 0);
}
