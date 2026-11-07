import type { Appearance, ContentFieldLayout, Resume, SectionContentLayout } from './types';

export const FIELD_FONT_RATIO_MIN = 1 / 3;
export const FIELD_FONT_RATIO_MAX = 3.6;
export const customFieldSize = (field: ContentFieldLayout) => field.fontSizePx !== undefined || field.fontSizeRatio !== undefined;

/** Keep existing rendering unchanged until a user changes the page size. */
export function updatePageAppearance(resume: Resume, patch: Partial<Appearance>): void {
  const before = resume.appearance.fontSizePx;
  if (patch.fontSizePx !== undefined && patch.fontSizePx !== before) {
    for (const section of resume.sections) for (const field of section.contentLayout?.fields ?? []) {
      if (field.fontSizePx === undefined) continue;
      field.fontSizeRatio = field.fontSizePx / before;
      delete field.fontSizePx;
    }
  }
  resume.appearance = { ...resume.appearance, ...patch };
}

/** Reset size only; preserve field placement, emphasis and rich-text content. */
export function resetFieldFontSizes(layout: SectionContentLayout): SectionContentLayout {
  return { ...layout, fields: layout.fields.map(field => {
    const { fontSizePx: _pixels, fontSizeRatio: _ratio, ...rest } = field;
    return rest;
  }) };
}

export function resetResumeFontSizes(resume: Resume): void {
  for (const section of resume.sections) if (section.contentLayout) section.contentLayout = resetFieldFontSizes(section.contentLayout);
}
