import { contentFieldSpecs, resolveContentLayout } from './contentLayout';
import type { ContentFieldLayout, FieldDropPlacement, Section, SectionContentLayout } from './types';

/** Retain hidden fields in their rows so moving a neighbour cannot change their placement. */
function fullRows(fields: ContentFieldLayout[], richKeys: ReadonlySet<string>): ContentFieldLayout[][] {
  const rows: ContentFieldLayout[][] = [];
  let row: ContentFieldLayout[] = [], afterRich = false;
  const flush = () => { if (row.length) rows.push(row); row = []; };
  for (const field of fields) {
    const rich = richKeys.has(field.key);
    if (field.newLine || rich || afterRich) flush();
    row.push(field); afterRich = rich;
  }
  flush();
  return rows;
}

/** Moves presentation only. The section and its item values are never mutated. */
export function movePreviewField(section: Section, sourceKey: string, targetKey: string, placement: FieldDropPlacement): SectionContentLayout | null {
  if (sourceKey === targetKey || !['before', 'after', 'above', 'below'].includes(placement)) return null;
  const settings = resolveContentLayout(section);
  const source = settings.fields.find(field => field.key === sourceKey);
  const target = settings.fields.find(field => field.key === targetKey);
  if (!source?.visible || !target?.visible) return null;
  const richKeys = new Set(contentFieldSpecs(section).filter(field => field.type === 'rich').map(field => field.key));
  const original = fullRows(settings.fields, richKeys);
  const rows = original.map(row => row.filter(field => field.key !== sourceKey)).filter(row => row.length > 0);
  const targetRowIndex = rows.findIndex(row => row.some(field => field.key === targetKey));
  if (targetRowIndex < 0) return null;
  // Rich text always occupies an entire row, including when imported settings omit its break.
  const effective = (richKeys.has(sourceKey) || richKeys.has(targetKey)) && (placement === 'before' || placement === 'after')
    ? placement === 'before' ? 'above' : 'below' : placement;
  if (effective === 'above' || effective === 'below') rows.splice(targetRowIndex + (effective === 'below' ? 1 : 0), 0, [source]);
  else {
    const row = rows[targetRowIndex], index = row.findIndex(field => field.key === targetKey);
    row.splice(index + (effective === 'after' ? 1 : 0), 0, source);
  }
  const keys = (groups: ContentFieldLayout[][]) => groups.map(row => row.map(field => field.key));
  const packed = effective === 'before' || effective === 'after';
  const packingChanged = packed ? source.inline !== true || target.inline !== true : source.inline === true;
  if (!packingChanged && JSON.stringify(keys(original)) === JSON.stringify(keys(rows))) return null;
  return { ...settings, fields: rows.flatMap(row => row.map((field, index) => ({
    ...field, newLine: index === 0,
    ...(field.key === sourceKey ? { inline: packed } : {}),
    ...(packed && field.key === targetKey ? { inline: true } : {}),
  }))) };
}
