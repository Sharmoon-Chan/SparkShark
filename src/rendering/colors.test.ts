import { describe, expect, it } from 'vitest';
import { readableThemeColor } from './colors';

function whiteContrast(hex: string) {
  const rgb = hex.match(/[a-f\d]{2}/gi)!.map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return 1.05 / (rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 + .05);
}
describe('theme text contrast', () => {
  it('preserves existing readable colours', () => { expect(readableThemeColor('#166534')).toBe('#166534'); expect(readableThemeColor('#2563EB')).toBe('#2563EB'); });
  it('keeps white and pastel theme text readable on the page', () => { for (const colour of ['#FFFFFF', '#FFF4CC', '#DDFFEE']) expect(whiteContrast(readableThemeColor(colour))).toBeGreaterThanOrEqual(4.5); });
});
