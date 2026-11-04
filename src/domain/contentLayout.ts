import type { ContentFieldLayout, Section, SectionContentLayout } from './types';
import { FIELD_SPECS } from './registry';

export interface ContentFieldSpec {
  key: string;
  label: string;
  type: 'text' | 'url' | 'rich' | 'tags' | 'level';
  primary?: boolean;
}

/** The displayable data fields; icons remain part of the template. */
export function contentFieldSpecs(section: Section): ContentFieldSpec[] {
  if (section.kind === 'summary') return [{ key: 'summary', label: '正文', type: 'rich' }];
  if (section.kind === 'custom') return section.fieldDefinitions.filter(field => field.visible).map(field => ({
    key: field.id, label: field.label,
    type: field.type === 'summary' ? 'rich' : field.type === 'keywords' ? 'tags' : field.type === 'url' ? 'url' : 'text',
    primary: field.type === 'name',
  }));
  return FIELD_SPECS[section.kind].filter(field => field.key !== 'iconId').map((field, index) => ({
    key: field.key, label: field.label, type: field.type === 'textarea' ? 'text' : field.type,
    primary: index === 0 && field.type === 'text',
  }));
}

export function defaultContentLayout(section: Section): SectionContentLayout {
  const specs = contentFieldSpecs(section);
  const primary = specs.find(field => field.primary);
  const right = specs.find(field => field.key === 'dateText') ?? specs.find(field => field.type === 'level');
  let ordered: ContentFieldSpec[];
  if (section.kind === 'custom' || section.kind === 'summary') ordered = specs;
  else ordered = [...(primary ? [primary] : []), ...(right && right !== primary ? [right] : []),
    ...specs.filter(field => field !== primary && field !== right && field.type !== 'url' && field.type !== 'rich'),
    ...specs.filter(field => field.type === 'url'), ...specs.filter(field => field.type === 'rich')];
  const fields = ordered.map((field, index): ContentFieldLayout => {
    const previous = ordered[index - 1];
    const special = field.type === 'url' || field.type === 'rich';
    const firstDetail = index > 0 && previous && (previous === primary || previous === right) && field !== right;
    return { key: field.key,
      newLine: section.kind === 'custom' || index === 0 || special || Boolean(firstDetail),
      align: field === right && section.kind !== 'custom' ? 'right' : 'left',
      emphasis: field.primary ? 'bold' : field.type === 'rich' ? 'normal' : 'muted', visible: true };
  });
  return { fields, rowGapPx: 4, itemGapPx: 8 };
}

const bounded = (value: number, fallback: number, max: number) => Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;

/** Resolves stale definitions and new fields without mutating stored data. */
export function resolveContentLayout(section: Section): SectionContentLayout {
  const defaults = defaultContentLayout(section);
  if (!section.contentLayout) return defaults;
  const available = new Map(defaults.fields.map(field => [field.key, field]));
  const seen = new Set<string>();
  const fields: ContentFieldLayout[] = [];
  for (const field of section.contentLayout.fields) {
    if (!available.has(field.key) || seen.has(field.key)) continue;
    seen.add(field.key); fields.push({ ...field });
  }
  fields.push(...defaults.fields.filter(field => !seen.has(field.key)).map(field => ({ ...field })));
  return { fields, rowGapPx: bounded(section.contentLayout.rowGapPx, defaults.rowGapPx, 32), itemGapPx: bounded(section.contentLayout.itemGapPx, defaults.itemGapPx, 64) };
}

/** Rich content spans a row, preserving its paragraph-level formatting. */
export function contentLayoutRows(section: Section): ContentFieldLayout[][] {
  const types = new Map(contentFieldSpecs(section).map(field => [field.key, field.type]));
  const rows: ContentFieldLayout[][] = [];
  let row: ContentFieldLayout[] = [], afterRich = false;
  const flush = () => { if (row.length) rows.push(row); row = []; };
  for (const field of resolveContentLayout(section).fields) {
    const rich = types.get(field.key) === 'rich';
    if (field.newLine || rich || afterRich) flush();
    if (field.visible) row.push(field);
    afterRich = rich;
  }
  flush();
  return rows;
}
