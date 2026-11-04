import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE } from './registry';
import { avatarCropAtZoom, avatarCropStyle, avatarCropZoom, avatarFrame } from './avatar';

describe('rectangular avatar frames', () => {
  it('converts an old circular frame while retaining the source crop and other settings', () => {
    const crop = { x: .2, y: .1, width: .5, height: .6 };
    const original = { ...DEFAULT_APPEARANCE.avatar, aspectRatio: 1, radiusPx: 40, crop, visible: false, borderWidthPx: 2 };
    const before = structuredClone(original), frame = avatarFrame(original);
    expect(frame.aspectRatio).toBe(.75); expect(frame.radiusPx).toBe(0);
    expect(frame.crop).toBe(crop); expect(frame.widthPx).toBe(original.widthPx);
    expect(frame.visible).toBe(false); expect(frame.borderWidthPx).toBe(2);
    expect(original).toEqual(before);
  });
  it('keeps an existing rectangle ratio and new portrait defaults', () => {
    expect(DEFAULT_APPEARANCE.avatar.aspectRatio).toBe(.75);
    expect(DEFAULT_APPEARANCE.avatar.radiusPx).toBe(0);
    expect(avatarFrame({ ...DEFAULT_APPEARANCE.avatar, aspectRatio: 4 / 3, radiusPx: 30 }).aspectRatio).toBe(4 / 3);
    expect(avatarFrame({ ...DEFAULT_APPEARANCE.avatar, aspectRatio: 1 }).aspectRatio).toBe(1);
  });
  it('keeps the natural image ratio when a legacy crop is shown in a portrait frame', () => {
    const dimensions = { width: 1200, height: 800 }, crop = { x: .2, y: .15, width: .4, height: .6 };
    const before = structuredClone(crop), style = avatarCropStyle(dimensions, crop, 240, .75);
    expect(style.width / style.height).toBeCloseTo(dimensions.width / dimensions.height);
    expect(style.width * crop.width).toBeGreaterThanOrEqual(240 - 1e-9);
    expect(style.height * crop.height).toBeGreaterThanOrEqual(320 - 1e-9);
    expect(crop).toEqual(before);
  });
  it('changes ratio and zoom around the saved centre without crossing image bounds', () => {
    const dimensions = { width: 1200, height: 800 }, previous = { x: .3, y: .2, width: .4, height: .6 };
    const crop = avatarCropAtZoom(dimensions, .75, 2, previous);
    expect(crop.x + crop.width / 2).toBeCloseTo(previous.x + previous.width / 2);
    expect(crop.y + crop.height / 2).toBeCloseTo(previous.y + previous.height / 2);
    expect(crop.width * dimensions.width / (crop.height * dimensions.height)).toBeCloseTo(.75);
    expect(crop.x).toBeGreaterThanOrEqual(0); expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1); expect(crop.y + crop.height).toBeLessThanOrEqual(1);
    expect(avatarCropZoom(dimensions, .75, crop)).toBeCloseTo(2);
  });
});
