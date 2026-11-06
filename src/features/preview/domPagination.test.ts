import { describe, expect, it } from 'vitest';
import { mergeLineIntervals, planColumnSlices } from './domPagination';

describe('measured DOM page cut planning', () => {
  it('merges mixed inline glyphs on one line but preserves the gap between lines', () => {
    expect(mergeLineIntervals([{ start: 10, end: 25 }, { start: 11, end: 26 }, { start: 31, end: 46 }])).toEqual([{ start: 10, end: 26 }, { start: 31, end: 46 }]);
  });
  it('retains first-line font overhang rather than treating cropped glyphs as complete', () => {
    expect(mergeLineIntervals([{ start: -4.8, end: 38.4 }])).toEqual([{ start: -4.8, end: 38.4 }]);
    const slices = planColumnSlices({ height: 150, intervals: [{ start: -4.8, end: 38.4 }, { start: 80, end: 98 }, { start: 120, end: 142 }], firstCapacity: 100, capacity: 100 });
    expect(slices[0]).toEqual({ start: -4.8, end: 100, capacity: 104.8 });
    expect(slices.at(-1)?.end).toBe(150);
  });
  it('cuts between physical lines with no loss or overlap, including a shorter first page', () => {
    const intervals = Array.from({ length: 100 }, (_, index) => ({ start: index * 21, end: index * 21 + 17 }));
    const slices = planColumnSlices({ height: 2100, intervals, firstCapacity: 480, capacity: 1000 });
    expect(slices[0].start).toBe(0); expect(slices.at(-1)?.end).toBe(2100);
    for (let i = 1; i < slices.length; i++) expect(slices[i].start).toBe(slices[i - 1].end);
    for (const line of intervals) expect(slices.filter(slice => line.start >= slice.start && line.end <= slice.end)).toHaveLength(1);
  });
  it('moves a header and two following lines together', () => {
    const slices = planColumnSlices({ height: 180, intervals: [{ start: 0, end: 40 }, { start: 70, end: 90 }, { start: 95, end: 110 }, { start: 115, end: 130 }], keepTogether: [{ start: 70, end: 130 }], firstCapacity: 100, capacity: 100 });
    expect(slices[0].end).toBe(70);
  });
  it('moves an initial tall block after a first-page header without looping', () => {
    const slices = planColumnSlices({ height: 95, intervals: [{ start: 0, end: 30 }, { start: 40, end: 70 }, { start: 75, end: 95 }], keepTogether: [{ start: 0, end: 70 }], firstCapacity: 50, capacity: 100 });
    expect(slices).toEqual([{ start: 0, end: 0, capacity: 50 }, { start: 0, end: 95, capacity: 100 }]);
  });
  it('relaxes oversized block constraints while preserving line boundaries', () => {
    const intervals = Array.from({ length: 12 }, (_, index) => ({ start: index * 20, end: index * 20 + 15 }));
    const slices = planColumnSlices({ height: 240, intervals, keepTogether: [{ start: 0, end: 240 }], firstCapacity: 100, capacity: 100 });
    expect(slices).toHaveLength(3);
  });
  it('rejects an indivisible image taller than a page rather than silently clipping', () => {
    expect(() => planColumnSlices({ height: 120, intervals: [{ start: 0, end: 120 }], firstCapacity: 100, capacity: 100 })).toThrow('高于整页');
  });
  it('handles blank flow and enforces a page budget', () => {
    expect(planColumnSlices({ height: 0, intervals: [], firstCapacity: 100, capacity: 100 })).toEqual([]);
    expect(() => planColumnSlices({ height: 1000, intervals: [], firstCapacity: 100, capacity: 100, maxPages: 2 })).toThrow('页数过多');
  });
});
