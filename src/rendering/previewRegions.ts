import type { PreviewRegion } from '../domain/types';

/** The page-relative boxes returned by react-pdf's onRender layout. */
export interface PreviewLayoutNode {
  type?: string;
  box?: { left?: number; top?: number; width?: number; height?: number };
  props?: { id?: string };
  children?: PreviewLayoutNode[];
}

export interface PreviewRegionOptions {
  /** Number of pages already present in the final PDF. */
  pageOffset?: number;
  /** Position of the source page in the final page, in top-left PDF points. */
  offsetX?: number;
  offsetY?: number;
  /** Source page bounds; defaults to each source page's layout dimensions. */
  clipWidth?: number;
  clipHeight?: number;
  /** Labels keyed by the original content section ID. */
  labels?: Readonly<Record<string, string>>;
}

function targetOf(id: string | undefined): string | null {
  const prefix = 'preview-section-';
  return id?.startsWith(prefix) && id.length > prefix.length ? id.slice(prefix.length) : null;
}

/** Extracts UI metadata only; coordinates remain in points until preview zoom. */
export function extractPreviewRegions(layout: PreviewLayoutNode | undefined, options: PreviewRegionOptions = {}): PreviewRegion[] {
  if (!layout) return [];
  const { pageOffset = 0, offsetX = 0, offsetY = 0, labels = {} } = options;
  if (!Number.isInteger(pageOffset) || pageOffset < 0 || !Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return [];
  const pages = layout.type?.toUpperCase() === 'PAGE' ? [layout] : layout.children ?? [];
  const regions = new Map<string, PreviewRegion>();

  pages.forEach((page, index) => {
    const width = options.clipWidth ?? page.box?.width ?? Infinity;
    const height = options.clipHeight ?? page.box?.height ?? Infinity;
    if (!(width > 0) || !(height > 0) || Number.isNaN(width) || Number.isNaN(height)) return;
    const pageNumber = pageOffset + index + 1;

    const visit = (node: PreviewLayoutNode, parentX: number, parentY: number) => {
      const left = node.box?.left ?? 0, top = node.box?.top ?? 0;
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;
      const x = parentX + left, y = parentY + top;
      const target = targetOf(node.props?.id);
      const nodeWidth = node.box?.width ?? 0, nodeHeight = node.box?.height ?? 0;
      if (target && Number.isFinite(nodeWidth) && Number.isFinite(nodeHeight) && nodeWidth > 0 && nodeHeight > 0) {
        const startX = Math.max(0, x), startY = Math.max(0, y);
        const endX = Math.min(width, x + nodeWidth), endY = Math.min(height, y + nodeHeight);
        if (endX > startX && endY > startY) {
          const region: PreviewRegion = {
            page: pageNumber, target, label: labels[target] ?? target,
            x: startX + offsetX, y: startY + offsetY, width: endX - startX, height: endY - startY,
          };
          const key = `${pageNumber}:${target}`, existing = regions.get(key);
          if (existing) {
            const right = Math.max(existing.x + existing.width, region.x + region.width);
            const bottom = Math.max(existing.y + existing.height, region.y + region.height);
            existing.x = Math.min(existing.x, region.x); existing.y = Math.min(existing.y, region.y);
            existing.width = right - existing.x; existing.height = bottom - existing.y;
          } else regions.set(key, region);
        }
      }
      node.children?.forEach(child => visit(child, x, y));
    };

    // A document may position its page nodes; each embedded page has its own origin.
    page.children?.forEach(child => visit(child, 0, 0));
  });
  return [...regions.values()];
}
