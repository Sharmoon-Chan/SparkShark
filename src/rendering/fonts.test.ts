import { describe, expect, it } from 'vitest';
import manifest from '../../public/fonts/manifest.json';
import { FONT_IDS, FONT_OPTIONS, fontOptionFor } from '../domain/fonts';
import { createExample, parseResume, plainRich } from '../domain/resume';
import { checkGlyphs, fontFamily } from './fonts';

describe('self-hosted resume font catalog', () => {
  it('offers only complete registered families with their licenses and four real faces', () => {
    expect(new Set(FONT_IDS).size).toBe(FONT_IDS.length);
    expect(Object.keys(manifest.families)).toEqual(FONT_IDS);
    for (const option of FONT_OPTIONS) {
      const family = manifest.families[option.id];
      expect(fontFamily(option.id)).toBe(family.family);
      expect(option.cssFamily).toContain(`"${family.family}"`);
      expect(family.files.map(file => `${file.weight}:${file.style}`).sort()).toEqual(['400:italic', '400:normal', '700:italic', '700:normal']);
      expect(family.license).toMatch(/-OFL\.txt$/);
    }
  });

  it('round-trips every offered font and covers the Chinese resume plus formatted text', () => {
    for (const id of FONT_IDS) {
      const resume = createExample(); resume.appearance.fontFamilyId = id;
      const summary = resume.sections.find(section => section.kind === 'summary')!;
      if (summary.kind === 'summary') summary.content = plainRich('让经历清晰呈现，专业技能与工作经历。Resume & Portfolio 2026；中文 · English • 简繁體。');
      expect(parseResume(resume).appearance.fontFamilyId).toBe(id);
      expect(() => checkGlyphs(resume), id).not.toThrow();
    }
  });

  it('uses the existing sans family for unknown presentation lookups', () => {
    expect(fontFamily('missing-family')).toBe(manifest.families['noto-sans-sc'].family);
    expect(fontOptionFor('missing-family')).toBe(FONT_OPTIONS[0]);
  });
});
