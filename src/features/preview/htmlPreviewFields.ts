import type { PreviewFieldRegion, Resume } from '../../domain/types';
import { contentFieldSpecs } from '../../domain/contentLayout';
import { parsePreviewFieldId } from '../../rendering/previewFields';

interface Rect { left: number; top: number; right: number; bottom: number }
export function clipFieldRect(rect: Rect, clip: Rect): Rect | null {
  const value = { left: Math.max(rect.left, clip.left), top: Math.max(rect.top, clip.top), right: Math.min(rect.right, clip.right), bottom: Math.min(rect.bottom, clip.bottom) };
  return Object.values(value).every(Number.isFinite) && value.right - value.left > .01 && value.bottom - value.top > .01 ? value : null;
}

/** Reads only visible page slices. PDF points keep the existing drag thresholds unchanged. */
export function collectHtmlPreviewFields(destination: HTMLElement, resume: Resume): PreviewFieldRegion[] {
  const document = destination.ownerDocument, sections = new Map(resume.sections.filter(section => section.visible).map(section => [section.id, section]));
  const specs = new Map([...sections].map(([id, section]) => [id, new Map(contentFieldSpecs(section).map(spec => [spec.key, spec]))]));
  const result = new Map<string, PreviewFieldRegion>();
  for (const page of destination.querySelectorAll<HTMLElement>(':scope > [data-preview-page]')) {
    const pageNumber = Number(page.dataset.previewPage), pageBox = page.getBoundingClientRect();
    for (const column of page.querySelectorAll<HTMLElement>('.preview-column-clip')) {
      if (column.dataset.previewColumn === 'header') continue;
      const columnBox = column.getBoundingClientRect(), clip = clipFieldRect(columnBox, pageBox);
      if (!clip) continue;
      for (const element of column.querySelectorAll<HTMLElement>('[data-preview-field-id]')) {
        const identity = parsePreviewFieldId(element.dataset.previewFieldId), section = identity && sections.get(identity.sectionId);
        const spec = identity && specs.get(identity.sectionId)?.get(identity.fieldKey);
        if (!identity || !section || !spec) continue;
        if (section.kind === 'summary' ? identity.itemId !== section.id : !section.items.some(item => item.visible && item.id === identity.itemId)) continue;
        const rich = spec.type === 'rich', range = document.createRange();
        range.selectNodeContents(element);
        // Ranges capture actual inline ink, including display:contents markers.
        // Rich fields include their paragraph bounds but are clipped per page.
        const rectangles = [...range.getClientRects()];
        if (!rectangles.length || rich && element.getBoundingClientRect().height > 0) rectangles.push(element.getBoundingClientRect());
        const visible = rectangles.map(rect => clipFieldRect(rect, clip)).filter((rect): rect is Rect => Boolean(rect));
        if (!visible.length) continue;
        const left = Math.min(...visible.map(rect => rect.left)), top = Math.min(...visible.map(rect => rect.top));
        const right = Math.max(...visible.map(rect => rect.right)), bottom = Math.max(...visible.map(rect => rect.bottom));
        const field: PreviewFieldRegion = { ...identity, page: pageNumber, label: spec.label, rich,
          x: (left - pageBox.left) * .75, y: (top - pageBox.top) * .75, width: (right - left) * .75, height: (bottom - top) * .75,
          columnX: (clip.left - pageBox.left) * .75, columnWidth: (clip.right - clip.left) * .75 };
        const key = JSON.stringify([pageNumber, identity.sectionId, identity.itemId, identity.fieldKey]), previous = result.get(key);
        if (previous) {
          const x = Math.min(previous.x, field.x), y = Math.min(previous.y, field.y);
          previous.width = Math.max(previous.x + previous.width, field.x + field.width) - x;
          previous.height = Math.max(previous.y + previous.height, field.y + field.height) - y;
          previous.x = x; previous.y = y;
        } else result.set(key, field);
      }
    }
  }
  return [...result.values()];
}
