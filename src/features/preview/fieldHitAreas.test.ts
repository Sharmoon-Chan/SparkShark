import { describe, expect, it } from 'vitest';
import type { PreviewFieldRegion } from '../../domain/types';
import { previewFieldHitAreas, type PreviewFieldHitArea } from './fieldHitAreas';

const field = (key: string, x: number, y: number, width = 42, height = 12): PreviewFieldRegion => ({ page: 1, sectionId: 'education', itemId: 'item-a', fieldKey: key, label: key, x, y, width, height, columnX: 30, columnWidth: 480, rich: false });
const contains = (area: PreviewFieldHitArea, x: number, y: number) => x > area.left && x < area.left + area.width && y > area.top && y < area.top + area.height;
const overlaps = (a: PreviewFieldHitArea, b: PreviewFieldHitArea) => Math.min(a.left + a.width, b.left + b.width) > Math.max(a.left, b.left) && Math.min(a.top + a.height, b.top + b.height) > Math.max(a.top, b.top);

describe('preview field click and drag targets', () => {
  it('keeps every dense line selectable at 30% zoom without shrinking the text area', () => {
    const fields = [field('institution', 30, 100), field('studyType', 30, 116.5, 18), field('officialUrl', 30, 133, 140), field('summary', 30, 151, 480, 40)];
    const scale = .4, areas = previewFieldHitAreas(fields, scale);
    for (let index = 0; index < fields.length; index++) {
      const source = fields[index], x = (source.x + source.width / 2) * scale, y = (source.y + source.height / 2) * scale;
      expect(contains(areas[index], x, y)).toBe(true);
      expect(areas[index].left).toBeLessThanOrEqual(source.x * scale);
      expect(areas[index].top).toBeLessThanOrEqual(source.y * scale);
      expect(areas[index].left + areas[index].width).toBeGreaterThanOrEqual((source.x + source.width) * scale);
      expect(areas[index].top + areas[index].height).toBeGreaterThanOrEqual((source.y + source.height) * scale);
      expect(areas.filter(area => contains(area, x, y))).toHaveLength(1);
    }
  });

  it('separates short fields on the same line and in the next item', () => {
    const fields = [field('studyType', 30, 100, 8), field('major', 40, 100, 10), { ...field('company', 30, 116, 12), sectionId: 'work', itemId: 'item-b' }];
    const areas = previewFieldHitAreas(fields, .4);
    expect(overlaps(areas[0], areas[1])).toBe(false);
    expect(overlaps(areas[0], areas[2])).toBe(false);
    expect(overlaps(areas[1], areas[2])).toBe(false);
  });

  it('retains comfortable padding where there is space and uses full text size at larger zooms', () => {
    const fields = [field('score', 30, 100, 8), field('dateText', 400, 100, 60)];
    expect(previewFieldHitAreas(fields, .4)[0]).toMatchObject({ width: 16, height: 14 });
    expect(previewFieldHitAreas(fields, 2)[0]).toEqual({ left: 60, top: 200, width: 16, height: 24 });
  });

  it('handles separate pages and input order without mixing their targets or changing fields', () => {
    const fields = [field('institution', 30, 100), field('major', 30, 116.5)];
    const original = structuredClone(fields);
    expect(previewFieldHitAreas([...fields].reverse(), .4).reverse()).toEqual(previewFieldHitAreas(fields, .4));
    const onOtherPage = [fields[0], { ...fields[1], page: 2 }];
    expect(previewFieldHitAreas(onOtherPage, .4)[0].height).toBe(14);
    expect(fields).toEqual(original);
    expect(previewFieldHitAreas([], .4)).toEqual([]);
  });
});
