import { describe, expect, it } from 'vitest';
import { extractPreviewRegions, type PreviewLayoutNode } from './previewRegions';

const marker = (id: string, left: number, top: number, width: number, height: number): PreviewLayoutNode => ({
  props: { id }, box: { left, top, width, height },
});
const page = (children: PreviewLayoutNode[], width = 200, height = 300): PreviewLayoutNode => ({
  type: 'PAGE', box: { width, height }, children,
});

describe('PDF preview regions', () => {
  it('accumulates nested boxes and embedded-column offsets without changing the layout', () => {
    const layout = { children: [page([{ box: { left: 8, top: 12 }, children: [marker('preview-section-work-1', 4, 16, 100, 60)] }])] };
    const original = structuredClone(layout);
    expect(extractPreviewRegions(layout, { pageOffset: 2, offsetX: 320, offsetY: 36, labels: { 'work-1': '工作经历' } })).toEqual([
      { page: 3, target: 'work-1', label: '工作经历', x: 332, y: 64, width: 100, height: 60 },
    ]);
    expect(layout).toEqual(original);
  });

  it('keeps continuation regions on their respective final pages and handles a standalone content page', () => {
    const layout = { children: [
      page([marker('preview-section-projects', 0, 170, 200, 130)]),
      page([marker('preview-section-projects', 0, 0, 200, 80), marker('preview-section-awards', 0, 92, 200, 40)]),
    ] };
    const regions = extractPreviewRegions(layout, { pageOffset: 1, offsetY: 36 });
    expect(regions.map(({ page: number, target, y, height }) => ({ page: number, target, y, height }))).toEqual([
      { page: 2, target: 'projects', y: 206, height: 130 },
      { page: 3, target: 'projects', y: 36, height: 80 },
      { page: 3, target: 'awards', y: 128, height: 40 },
    ]);
    expect(extractPreviewRegions(page([marker('preview-section-summary', 36, 36, 128, 100)]), { labels: { summary: '个人总结' } })).toEqual([
      { page: 1, target: 'summary', label: '个人总结', x: 36, y: 36, width: 128, height: 100 },
    ]);
  });

  it('clips fragments to the source page before translating them to the final page', () => {
    const layout = { children: [page([
      marker('preview-section-first', -10, -5, 80, 40),
      marker('preview-section-last', 170, 260, 100, 70),
      marker('preview-section-outside', 250, 0, 30, 20),
    ])] };
    expect(extractPreviewRegions(layout, { offsetX: 40, offsetY: 36 })).toEqual([
      { page: 1, target: 'first', label: 'first', x: 40, y: 36, width: 70, height: 35 },
      { page: 1, target: 'last', label: 'last', x: 210, y: 296, width: 30, height: 40 },
    ]);
    expect(extractPreviewRegions(layout, { clipWidth: 180, clipHeight: 280 })[1]).toMatchObject({ width: 10, height: 20 });
  });

  it('merges repeated fragments of the same section on one page while keeping other targets separate', () => {
    const outer = marker('preview-section-work', 10, 20, 120, 60);
    outer.children = [marker('preview-section-work', 5, 8, 30, 20)];
    const layout = { children: [page([outer, marker('preview-section-work', 20, 90, 100, 40), marker('preview-section-summary', 0, 0, 180, 15)])] };
    expect(extractPreviewRegions(layout)).toEqual([
      { page: 1, target: 'work', label: 'work', x: 10, y: 20, width: 120, height: 110 },
      { page: 1, target: 'summary', label: 'summary', x: 0, y: 0, width: 180, height: 15 },
    ]);
  });

  it('ignores unrelated, empty and invalid boxes, and never uses the document position of a page', () => {
    const sourcePage = page([
      marker('unrelated', 0, 0, 20, 20), marker('preview-section-', 0, 0, 20, 20),
      marker('preview-section-zero', 0, 0, 20, 0), marker('preview-section-invalid', NaN, 0, 20, 20),
      marker('preview-section-infinite', 0, 0, Infinity, 20), marker('preview-section-summary', 10, 12, 50, 60),
    ]);
    sourcePage.box = { ...sourcePage.box, left: 600, top: 900 };
    expect(extractPreviewRegions({ children: [sourcePage] })).toEqual([
      { page: 1, target: 'summary', label: 'summary', x: 10, y: 12, width: 50, height: 60 },
    ]);
    expect(extractPreviewRegions(undefined)).toEqual([]);
    expect(extractPreviewRegions({ children: [sourcePage] }, { offsetX: NaN })).toEqual([]);
    expect(extractPreviewRegions({ children: [sourcePage] }, { clipHeight: 0 })).toEqual([]);
  });

  it('leaves basic information non-interactive while keeping summary and work regions', () => {
    const header = marker('preview-basics', 0, 0, 200, 70);
    const layout = { children: [page([header,
      marker('preview-section-summary', 0, 80, 200, 40),
      marker('preview-section-work', 0, 130, 200, 100),
    ])] };
    expect(extractPreviewRegions(layout, { labels: { basics: '基本信息', summary: '个人总结', work: '工作经历' } })).toEqual([
      { page: 1, target: 'summary', label: '个人总结', x: 0, y: 80, width: 200, height: 40 },
      { page: 1, target: 'work', label: '工作经历', x: 0, y: 130, width: 200, height: 100 },
    ]);
    expect(extractPreviewRegions(page([header]))).toEqual([]);
  });
});
