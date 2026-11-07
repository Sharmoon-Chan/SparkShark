/**
 * TalenCat's public CSS uses a shared body variable and h2/h3 ratios of
 * 20/14 and 18/14. Some template utilities use fixed rem sizes. Here all
 * semantic roles scale from the same page value, including configured fields.
 * References checked 2026-11-07:
 * https://assets.talencat.cn/web/assets/Preview-YgWaN82q.js
 * https://assets.talencat.cn/web/assets/main-Dw55IjuP.css
 */
export const RESUME_TYPE_SCALE = { section: 20 / 14, entry: 18 / 14, body: 1 } as const;
export type ResumeTypeRole = keyof typeof RESUME_TYPE_SCALE;

/** Works in px or pt; emphasis and rich-text marks never change field size. */
export function resumeTypeSize(base: number, role: ResumeTypeRole): number {
  return base * RESUME_TYPE_SCALE[role];
}
