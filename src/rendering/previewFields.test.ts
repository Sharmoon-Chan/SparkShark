import { describe, expect, it } from 'vitest';
import { extractPreviewFields, parsePreviewFieldId, previewFieldId, type PreviewFieldLayoutNode } from './previewFields';

const id = (key = 'institution', item = 'education-1') => previewFieldId('education', item, key);
const page = (children: PreviewFieldLayoutNode[]): PreviewFieldLayoutNode => ({ type: 'PAGE', box: { left: 800, top: 1000, width: 500, height: 700 }, children });
const text = (key: string, left: number, top: number, allocated = 300, ink = 50): PreviewFieldLayoutNode => ({ type: 'TEXT', props: { id: id(key) }, box: { left, top, width: allocated, height: 20 }, lines: [{ box: { x: 0, y: 0, width: allocated, height: 20 }, xAdvance: ink }] });

describe('PDF field preview geometry', () => {
  it('round-trips IDs with reserved characters and ignores unrelated or malformed IDs', () => {
    const encoded = previewFieldId('模块:教育/一', 'item%2#1', '专业:方向');
    expect(parsePreviewFieldId(encoded)).toEqual({ sectionId: '模块:教育/一', itemId: 'item%2#1', fieldKey: '专业:方向' });
    expect(parsePreviewFieldId('preview-section-education')).toBeNull();
    expect(parsePreviewFieldId('preview-field:a:b:%GG')).toBeNull();
    expect(parsePreviewFieldId('preview-field:a:b:')).toBeNull();
  });
  it('uses text advance width instead of the flexible allocation width', () => {
    const result = extractPreviewFields(page([text('institution', 10, 30)]), { labels: { education: { institution: '院校' } } });
    expect(result).toEqual([{ page: 1, sectionId: 'education', itemId: 'education-1', fieldKey: 'institution', label: '院校', x: 10, y: 30, width: 50, height: 20, columnX: 0, columnWidth: 500, rich: false }]);
  });
  it('matches padded and aligned text origins, including split-page line Y offsets', () => {
    const aligned = text('dateText', 30, 40);
    aligned.box = { ...aligned.box, paddingLeft: 5, paddingTop: 3 };
    aligned.alignOffset = 20;
    aligned.lines = [{ box: { x: 250, y: 400, width: 300, height: 18 }, xAdvance: 50 }, { box: { x: 270, y: 420, width: 300, height: 18 }, xAdvance: 30 }];
    const [result] = extractPreviewFields(page([aligned]));
    expect(result).toMatchObject({ x: 265, y: 43, width: 50, height: 38 });
  });
  it('accumulates nested boxes and uses child text ink for field wrappers', () => {
    const wrapper: PreviewFieldLayoutNode = { type: 'VIEW', props: { id: id() }, box: { left: 10, top: 20, width: 400, height: 30 }, children: [{ ...text('unmarked', 5, 2, 300, 60), props: {} }] };
    const [result] = extractPreviewFields(page([{ type: 'VIEW', box: { left: 20, top: 50 }, children: [wrapper] }]), { offsetX: 40, offsetY: 35 });
    expect(result).toMatchObject({ x: 75, y: 107, width: 60, height: 20, columnX: 40, columnWidth: 500 });
  });
  it('keeps rich containers whole and separates page copies while merging same-page fragments', () => {
    const body: PreviewFieldLayoutNode = { type: 'VIEW', props: { id: id('summary') }, box: { left: 10, top: 20, width: 400, height: 120 }, children: [text('child', 0, 0, 300, 60)] };
    const continuation = { ...body, box: { left: 10, top: 0, width: 400, height: 200 }, children: [] };
    const layout: PreviewFieldLayoutNode = { type: 'DOCUMENT', children: [page([body, { ...body, box: { left: 10, top: 150, width: 400, height: 40 }, children: [] }]), page([continuation])] };
    const result = extractPreviewFields(layout, { pageOffset: 2, richFields: { education: ['summary'] } }).filter(field => field.fieldKey === 'summary');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ page: 3, x: 10, y: 20, width: 400, height: 170, rich: true });
    expect(result[1]).toMatchObject({ page: 4, x: 10, y: 0, width: 400, height: 200, rich: true });
  });
  it('clips columns, rejects invalid geometry and retains graphic fields without lines', () => {
    const graphic: PreviewFieldLayoutNode = { props: { id: id('level') }, box: { left: -5, top: 690, width: 80, height: 30 } };
    const invalid: PreviewFieldLayoutNode = { props: { id: id('bad') }, box: { left: NaN, top: 0, width: 50, height: 20 } };
    const result = extractPreviewFields(page([graphic, invalid]), { clipWidth: 60, offsetX: 100, offsetY: 35 });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ x: 100, y: 725, width: 60, height: 10, columnWidth: 60 });
  });
  it('can derive advance width from runs and excludes empty text', () => {
    const fallback = text('major', 10, 10);
    fallback.lines = [{ box: { x: 0, y: 0, width: 300, height: 20 }, runs: [{ positions: [{ xAdvance: 10 }, { xAdvance: 15 }] }] }];
    const empty = text('empty', 0, 0, 300, 0);
    expect(extractPreviewFields(page([fallback, empty]))).toHaveLength(1);
    expect(extractPreviewFields(page([fallback]))[0].width).toBe(25);
  });
});
