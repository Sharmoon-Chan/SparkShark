import { contentFieldRows, contentFieldSpecs, resolveContentLayout } from './contentLayout';
import type { FieldDropPlacement, Section, SectionContentLayout } from './types';

/** Moves presentation only. The section and its item values are never mutated. */
export function movePreviewField(section: Section, sourceKey: string, targetKey: string, placement: FieldDropPlacement): SectionContentLayout | null {
  if (sourceKey === targetKey || !['before', 'after', 'above', 'below'].includes(placement)) return null;
  const settings = resolveContentLayout(section);
  const source = settings.fields.find(field => field.key === sourceKey);
  const target = settings.fields.find(field => field.key === targetKey);
  if (!source?.visible || !target?.visible) return null;
  const richKeys = new Set(contentFieldSpecs(section).filter(field => field.type === 'rich').map(field => field.key));
  const original = contentFieldRows(settings.fields, richKeys).map(fields => ({ fields, align: fields.find(field => field.rowAlign !== undefined)?.rowAlign }));
  const sourceRow = original.find(row => row.fields.includes(source))!;
  const rows = original.map(row => ({ ...row, fields: row.fields.filter(field => field.key !== sourceKey) })).filter(row => row.fields.length > 0);
  const targetRowIndex = rows.findIndex(row => row.fields.some(field => field.key === targetKey));
  if (targetRowIndex < 0) return null;
  // Rich text always occupies an entire row, including when imported settings omit its break.
  const effective = (richKeys.has(sourceKey) || richKeys.has(targetKey)) && (placement === 'before' || placement === 'after')
    ? placement === 'before' ? 'above' : 'below' : placement;
  if (effective === 'above' || effective === 'below') rows.splice(targetRowIndex + (effective === 'below' ? 1 : 0), 0, { fields: [source], align: sourceRow.align });
  else {
    const row = rows[targetRowIndex].fields, index = row.findIndex(field => field.key === targetKey);
    row.splice(index + (effective === 'after' ? 1 : 0), 0, source);
  }
  const keys = (groups: typeof rows) => groups.map(row => ({ keys: row.fields.map(field => field.key), align: row.align }));
  const packed = effective === 'before' || effective === 'after';
  const packingChanged = packed ? source.inline !== true || target.inline !== true : source.inline === true;
  if (!packingChanged && JSON.stringify(keys(original)) === JSON.stringify(keys(rows))) return null;
  return { ...settings, fields: rows.flatMap(row => row.fields.map((field, index) => {
    const { rowAlign: _oldAlign, ...rest } = field;
    return { ...rest, newLine: index === 0,
      ...(row.align ? { rowAlign: row.align } : {}),
      ...(field.key === sourceKey ? { inline: packed } : {}),
      ...(packed && field.key === targetKey ? { inline: true } : {}) };
  })) };
}
