import { describe, expect, it } from 'vitest';
import { clipFieldRect } from './htmlPreviewFields';

describe('visible HTML field slice boundaries', () => {
  const clip = { left: 40, top: 25, right: 320, bottom: 1100 };
  it('clips a continued field to its physical column and page', () => {
    expect(clipFieldRect({ left: 20, top: -500, right: 350, bottom: 800 }, clip)).toEqual({ left: 40, top: 25, right: 320, bottom: 800 });
    expect(clipFieldRect({ left: 50, top: 900, right: 310, bottom: 1700 }, clip)).toEqual({ left: 50, top: 900, right: 310, bottom: 1100 });
  });
  it('omits off-page clones and invalid or zero-area text', () => {
    expect(clipFieldRect({ left: 50, top: 1100, right: 200, bottom: 1300 }, clip)).toBeNull();
    expect(clipFieldRect({ left: 50, top: 50, right: 50, bottom: 70 }, clip)).toBeNull();
    expect(clipFieldRect({ left: NaN, top: 50, right: 60, bottom: 70 }, clip)).toBeNull();
  });
});
