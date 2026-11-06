/**
 * Default hierarchy adapted from TalenCat's standard 14px page: 20px section
 * labels, 16px item names and 14px body/details. Its current Essential template
 * uses fixed-rem utilities; our defaults deliberately scale with page size.
 * References checked 2026-11-05:
 * https://assets.talencat.cn/web/assets/Preview-YgWaN82q.js
 * https://assets.talencat.cn/web/assets/main-Dw55IjuP.css
 */
export const RESUME_TYPE_SCALE = { section: 20 / 14, entry: 16 / 14, body: 1 } as const;
export type ResumeTypeRole = keyof typeof RESUME_TYPE_SCALE;

/** Works in px or pt; emphasis and rich-text marks never change field size. */
export function resumeTypeSize(base: number, role: ResumeTypeRole): number {
  return base * RESUME_TYPE_SCALE[role];
}
