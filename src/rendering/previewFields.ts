import type { PreviewFieldRegion } from '../domain/types';
import type { PreviewLayoutNode } from './previewRegions';

interface TextLine {
  box?: { x?: number; y?: number; width?: number; height?: number };
  xAdvance?: number;
  runs?: { xAdvance?: number; positions?: { xAdvance?: number }[] }[];
}

export interface PreviewFieldLayoutNode extends PreviewLayoutNode {
  box?: { left?: number; top?: number; width?: number; height?: number; paddingLeft?: number; paddingTop?: number };
  alignOffset?: number;
  lines?: TextLine[];
  children?: PreviewFieldLayoutNode[];
}

export interface PreviewFieldOptions {
  pageOffset?: number;
  offsetX?: number;
  offsetY?: number;
  clipWidth?: number;
  clipHeight?: number;
  labels?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  richFields?: Readonly<Record<string, readonly string[]>>;
}

interface FieldIdentity { sectionId: string; itemId: string; fieldKey: string }
interface Rect { x: number; y: number; width: number; height: number }
const prefix = 'preview-field:';

export function previewFieldId(sectionId: string, itemId: string, fieldKey: string): string {
  return prefix + [sectionId, itemId, fieldKey].map(encodeURIComponent).join(':');
}

export function parsePreviewFieldId(id: string | undefined): FieldIdentity | null {
  if (!id?.startsWith(prefix)) return null;
  const parts = id.slice(prefix.length).split(':');
  if (parts.length !== 3) return null;
  try {
    const [sectionId, itemId, fieldKey] = parts.map(decodeURIComponent);
    return sectionId && itemId && fieldKey ? { sectionId, itemId, fieldKey } : null;
  } catch { return null; }
}

const finite = (value: number | undefined, fallback = 0) => value === undefined ? fallback : value;
function valid(rect: Rect): boolean {
  return Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}

function union(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y));
  return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x, height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
}

function advance(line: TextLine): number {
  if (Number.isFinite(line.xAdvance)) return line.xAdvance!;
  if (line.runs?.length) return line.runs.reduce((total, run) => total + (Number.isFinite(run.xAdvance) ? run.xAdvance! : (run.positions ?? []).reduce((sum, position) => sum + finite(position.xAdvance), 0)), 0);
  return finite(line.box?.width);
}

/** Mirrors renderText's padding/alignment origin; line.box.width is allocated space. */
function textRects(node: PreviewFieldLayoutNode, parentX: number, parentY: number): Rect[] {
  const x = parentX + finite(node.box?.left), y = parentY + finite(node.box?.top);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  if (node.lines?.length) {
    const initialY = finite(node.lines[0].box?.y);
    const originX = x + finite(node.box?.paddingLeft) - finite(node.alignOffset);
    const originY = y + finite(node.box?.paddingTop) - initialY;
    return node.lines.flatMap(line => {
      const rect = { x: originX + finite(line.box?.x), y: originY + finite(line.box?.y), width: advance(line), height: finite(line.box?.height) };
      return valid(rect) ? [rect] : [];
    });
  }
  return node.children?.flatMap(child => textRects(child, x, y)) ?? [];
}

function hasTextLines(node: PreviewFieldLayoutNode): boolean {
  return Boolean(node.lines?.length || node.children?.some(hasTextLines));
}

export function extractPreviewFields(layout: PreviewLayoutNode | undefined, options: PreviewFieldOptions = {}): PreviewFieldRegion[] {
  if (!layout) return [];
  const { pageOffset = 0, offsetX = 0, offsetY = 0, labels = {}, richFields = {} } = options;
  if (!Number.isInteger(pageOffset) || pageOffset < 0 || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return [];
  const document = layout as PreviewFieldLayoutNode;
  const pages = document.type?.toUpperCase() === 'PAGE' ? [document] : document.children ?? [];
  const fields = new Map<string, PreviewFieldRegion>();
  pages.forEach((page, pageIndex) => {
    const width = options.clipWidth ?? page.box?.width, height = options.clipHeight ?? page.box?.height;
    if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height || width < 0 || height < 0) return;
    const visit = (node: PreviewFieldLayoutNode, parentX: number, parentY: number) => {
      const x = parentX + finite(node.box?.left), y = parentY + finite(node.box?.top);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const identity = parsePreviewFieldId(node.props?.id);
      if (identity) {
        const rich = richFields[identity.sectionId]?.includes(identity.fieldKey) ?? false;
        const own = { x, y, width: finite(node.box?.width), height: finite(node.box?.height) };
        const ink = rich ? null : union(textRects(node, parentX, parentY));
        const rect = rich ? own : ink ?? (hasTextLines(node) ? null : own);
        if (rect && valid(rect)) {
          const left = Math.max(0, rect.x), top = Math.max(0, rect.y);
          const right = Math.min(width, rect.x + rect.width), bottom = Math.min(height, rect.y + rect.height);
          if (right > left && bottom > top) {
            const field: PreviewFieldRegion = { ...identity, page: pageOffset + pageIndex + 1,
              label: labels[identity.sectionId]?.[identity.fieldKey] ?? identity.fieldKey,
              x: left + offsetX, y: top + offsetY, width: right - left, height: bottom - top,
              columnX: offsetX, columnWidth: width, rich };
            const key = JSON.stringify([field.page, field.sectionId, field.itemId, field.fieldKey]);
            const existing = fields.get(key);
            if (existing) Object.assign(existing, union([existing, field]));
            else fields.set(key, field);
          }
        }
      }
      node.children?.forEach(child => visit(child, x, y));
    };
    page.children?.forEach(child => visit(child, 0, 0));
  });
  return [...fields.values()];
}
