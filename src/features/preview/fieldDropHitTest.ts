import type { FieldDropPlacement, PreviewFieldRegion } from '../../domain/types';

export interface PreviewFieldHit { target: PreviewFieldRegion; placement: FieldDropPlacement }

/** Uses page-relative PDF points; the UI converts client pixels once per page. */
export function hitTestPreviewField(source: PreviewFieldRegion, fields: readonly PreviewFieldRegion[], page: number, x: number, y: number): PreviewFieldHit | null {
  const candidates = fields.filter(field => field.page === page && field.sectionId === source.sectionId && field.itemId === source.itemId
    && x >= field.columnX - 4 && x <= field.columnX + field.columnWidth + 4);
  let nearest: PreviewFieldRegion | undefined, best = Infinity;
  for (const field of candidates) {
    const vertical = Math.max(field.y - y, y - field.y - field.height, 0);
    if (vertical > 16) continue;
    const horizontal = Math.max(field.x - x, x - field.x - field.width, 0);
    const score = vertical * 10000 + horizontal;
    if (score < best) { nearest = field; best = score; }
  }
  if (!nearest || nearest.fieldKey === source.fieldKey) return null;
  const middleY = nearest.y + nearest.height / 2;
  const placement: FieldDropPlacement = source.rich || nearest.rich
    ? y < middleY ? 'above' : 'below'
    : y < nearest.y - .5 ? 'above' : y > nearest.y + nearest.height + .5 ? 'below'
      : x < nearest.x + nearest.width / 2 ? 'before' : 'after';
  return { target: nearest, placement };
}

export const fieldPlacementLabels: Record<FieldDropPlacement, string> = {
  before: '同一行前面', after: '同一行后面', above: '上方另起一行', below: '下方另起一行',
};
