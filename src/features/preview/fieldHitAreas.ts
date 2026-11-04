import type { PreviewFieldRegion } from '../../domain/types';

export interface PreviewFieldHitArea { left: number; top: number; width: number; height: number }
interface Bounds { left: number; top: number; right: number; bottom: number }

/** Enlarge small targets only into free space, preserving every field's text. */
export function previewFieldHitAreas(fields: readonly PreviewFieldRegion[], scale: number): PreviewFieldHitArea[] {
  const text: Bounds[] = fields.map(field => ({ left: field.x * scale, top: field.y * scale, right: (field.x + field.width) * scale, bottom: (field.y + field.height) * scale }));
  const padded = text.map(box => {
    const horizontal = Math.max(0, (16 - (box.right - box.left)) / 2);
    const vertical = Math.max(0, (14 - (box.bottom - box.top)) / 2);
    return { left: box.left - horizontal, top: box.top - vertical, right: box.right + horizontal, bottom: box.bottom + vertical };
  });
  const bounds = padded.map(box => ({ ...box }));
  for (let i = 0; i < fields.length; i++) for (let j = i + 1; j < fields.length; j++) {
    if (fields[i].page !== fields[j].page) continue;
    const a = padded[i], b = padded[j];
    if (a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) continue;
    const first = text[i], second = text[j];
    if (first.right <= second.left) {
      const edge = (first.right + second.left) / 2;
      bounds[i].right = Math.min(bounds[i].right, edge); bounds[j].left = Math.max(bounds[j].left, edge);
    } else if (second.right <= first.left) {
      const edge = (second.right + first.left) / 2;
      bounds[j].right = Math.min(bounds[j].right, edge); bounds[i].left = Math.max(bounds[i].left, edge);
    }
    if (first.bottom <= second.top) {
      const edge = (first.bottom + second.top) / 2;
      bounds[i].bottom = Math.min(bounds[i].bottom, edge); bounds[j].top = Math.max(bounds[j].top, edge);
    } else if (second.bottom <= first.top) {
      const edge = (second.bottom + first.top) / 2;
      bounds[j].bottom = Math.min(bounds[j].bottom, edge); bounds[i].top = Math.max(bounds[i].top, edge);
    }
  }
  return bounds.map(box => ({ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }));
}
