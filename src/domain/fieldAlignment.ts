import { contentFieldRows, contentFieldSpecs, resolveContentLayout } from './contentLayout';
import type { AlignmentScope, FieldAlignmentState, Section, SectionContentLayout, TextAlignment } from './types';

export const alignmentLabels: Record<TextAlignment, string> = { left: '靠左', center: '居中', right: '靠右' };
export const alignmentScopeLabels: Record<AlignmentScope, string> = { field: '字段内文字', row: '当前行整体', module: '本模块所有行' };
const scopes: AlignmentScope[] = ['field', 'row', 'module'];
const values: TextAlignment[] = ['left', 'center', 'right'];

export function previewAlignmentState(section: Section, fieldKey: string): FieldAlignmentState {
  const settings = resolveContentLayout(section), specs = contentFieldSpecs(section);
  const field = settings.fields.find(field => field.key === fieldKey), rich = specs.find(spec => spec.key === fieldKey)?.type === 'rich';
  const rows = contentFieldRows(settings.fields, new Set(specs.filter(spec => spec.type === 'rich').map(spec => spec.key)));
  const row = rows.find(row => row.some(field => field.key === fieldKey));
  return { field: rich ? field?.paragraphAlign ?? null : field?.align ?? null, row: row?.find(field => field.rowAlign !== undefined)?.rowAlign ?? settings.rowAlign ?? null, module: settings.rowAlign ?? null };
}

/** Mutates only presentation metadata in a cloned layout, never the item content. */
export function alignPreviewField(section: Section, fieldKey: string, scope: AlignmentScope, value: TextAlignment | null): SectionContentLayout | null {
  if (!scopes.includes(scope) || (value !== null && !values.includes(value))) return null;
  const settings = resolveContentLayout(section), specs = contentFieldSpecs(section);
  const selected = settings.fields.find(field => field.key === fieldKey);
  const spec = specs.find(spec => spec.key === fieldKey);
  if (!selected?.visible || !spec) return null;
  const previous = JSON.stringify(settings);
  if (scope === 'module') {
    if (value === null) delete settings.rowAlign; else settings.rowAlign = value;
    // A deliberate module-wide choice replaces per-row alignment overrides.
    for (const field of settings.fields) delete field.rowAlign;
    if (value !== null) for (const field of settings.fields) if (field.inline === false) delete field.inline;
  } else if (scope === 'row') {
    const richKeys = new Set(specs.filter(spec => spec.type === 'rich').map(spec => spec.key));
    const row = contentFieldRows(settings.fields, richKeys).find(row => row.includes(selected))!;
    for (const field of row) {
      if (value === null) delete field.rowAlign;
      else { field.rowAlign = value; if (field.inline === false) delete field.inline; }
    }
  } else if (spec.type === 'rich') {
    if (value === null) delete selected.paragraphAlign; else selected.paragraphAlign = value;
  } else {
    selected.align = value ?? (spec.primary ? 'left' : selected.key === 'dateText' || spec.type === 'level' ? 'right' : 'left');
    // An inline text-sized cell has no internal free space to align into.
    // Allocate its own flexible slot for field-only alignment, preserving peers.
    if (value !== null) selected.inline = false;
  }
  return previous === JSON.stringify(settings) ? null : settings;
}
