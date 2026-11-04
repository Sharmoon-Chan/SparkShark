import { describe, expect, it } from 'vitest';
import type { PreviewFieldRegion } from '../../domain/types';
import { hitTestPreviewField } from './fieldDropHitTest';

const school: PreviewFieldRegion = { page: 1, sectionId: 'education', itemId: 'item-a', fieldKey: 'institution', label: '学校', x: 30, y: 100, width: 42, height: 12, columnX: 30, columnWidth: 480, rich: false };
const major = { ...school, fieldKey: 'major', label: '专业', y: 120, width: 76 };
describe('preview field drop hit testing', () => {
  it('recognises the right-side blank space as after the school on the same line', () => {
    expect(hitTestPreviewField(major, [school, major], 1, 95, 106)?.placement).toBe('after');
    expect(hitTestPreviewField(major, [school, major], 1, 35, 106)?.placement).toBe('before');
  });
  it('places fields above and below the target line', () => {
    expect(hitTestPreviewField(major, [school, major], 1, 50, 97)?.placement).toBe('above');
    expect(hitTestPreviewField(major, [school, major], 1, 50, 115)?.placement).toBe('below');
  });
  it('rejects self drops, another item, another module and the page margins', () => {
    expect(hitTestPreviewField(major, [school, major], 1, 50, 126)).toBeNull();
    expect(hitTestPreviewField(major, [{ ...school, itemId: 'other' }], 1, 50, 106)).toBeNull();
    expect(hitTestPreviewField(major, [{ ...school, sectionId: 'work' }], 1, 50, 106)).toBeNull();
    expect(hitTestPreviewField(major, [school], 1, 700, 106)).toBeNull();
  });
  it('supports another page of the same item and keeps rich content on a separate line', () => {
    expect(hitTestPreviewField({ ...major, rich: true }, [{ ...school, page: 2 }], 2, 95, 106)?.placement).toBe('below');
  });
});
