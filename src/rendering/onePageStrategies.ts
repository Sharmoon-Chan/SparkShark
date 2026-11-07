import type { Appearance, Resume, Section } from '../domain/types';
import { contentFieldSpecs, defaultContentLayout } from '../domain/contentLayout';
import { sectionTitle } from '../domain/registry';
import { contentFontSize, contentRowPresentation, moduleContentRows, sectionVisibleWithContent } from './contentLayoutView';
import { resumeTypeSize } from '../domain/typography';

export const MIN_SPACING_SCALE = .45;

/** Removes manual breaks while preserving the current reading order in each column. */
export function mergeOnePageGroups(original: Resume): Resume {
  const next = structuredClone(original), groups = next.layout.groups;
  const main = original.layout.mode === 'single' ? groups.flatMap(group => [...group.main, ...group.sidebar]) : groups.flatMap(group => group.main);
  const sidebar = original.layout.mode === 'single' ? [] : groups.flatMap(group => group.sidebar);
  next.layout.groups = [{ id: groups[0].id, main, sidebar }];
  return next;
}

/** Stored field order, visibility and alignment are left intact. */
export function spacingCandidate(structure: Resume, amount: number): Resume {
  const next = structuredClone(structure), t = Math.max(0, Math.min(1, amount));
  const originalScale = structure.appearance.spacingScale ?? 1;
  if (t > 0) {
    const minimum = Math.min(originalScale, MIN_SPACING_SCALE);
    const interpolated = originalScale + (minimum - originalScale) * t;
    next.appearance.spacingScale = Math.max(minimum, Math.min(originalScale, interpolated));
    next.appearance.density = 'custom';
  }
  const gapRatio = 1 - (1 - MIN_SPACING_SCALE) * t;
  const reduce = (value: number) => t === 0 ? value : Math.min(value, Math.max(0, Math.round(value * gapRatio * 4) / 4));
  next.sections.forEach(section => {
    if (!section.contentLayout) return;
    section.contentLayout.rowGapPx = reduce(section.contentLayout.rowGapPx);
    section.contentLayout.itemGapPx = reduce(section.contentLayout.itemGapPx);
  });
  return next;
}

/** Related short fields wrap naturally instead of each taking a full line. */
export function compactUnconfiguredFields(original: Resume): Resume {
  const next = structuredClone(original);
  for (const section of next.sections) {
    if (section.contentLayout || section.kind === 'summary' || !sectionVisibleWithContent(section)) continue;
    const specs = contentFieldSpecs(section), defaults = defaultContentLayout(section);
    const settings = new Map(defaults.fields.map(field => [field.key, field]));
    const short = specs.filter(spec => spec.type !== 'rich' && spec.type !== 'url' && spec.type !== 'tags' && spec.key !== 'description');
    const date = short.find(spec => spec.key === 'dateText');
    const header = [...short.filter(spec => spec !== date), ...(date ? [date] : [])];
    const rest = specs.filter(spec => !short.includes(spec));
    section.contentLayout = { ...defaults, fields: [...header, ...rest].map((spec, index) => ({
      ...settings.get(spec.key)!, newLine: index === 0 || !header.includes(spec),
      inline: spec.type !== 'rich', align: spec === date || spec.type === 'level' ? 'right' : 'left',
    })) };
  }
  return next;
}

function textUnits(text: string): number {
  return Array.from(text).reduce((sum, character) => sum + (/\s/.test(character) ? .45 : /[\u2e80-\u9fff\uff00-\uffef]/.test(character) ? 1.8 : 1), 0);
}
function textLines(text: string, width: number, fontSize: number): number {
  const capacity = Math.max(4, width / (fontSize * .55));
  return text.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(textUnits(line) / capacity)), 0);
}

/** An estimate ranks candidates only; success always comes from a real PDF. */
function sectionHeight(section: Section, width: number, appearance: Appearance): number {
  const entries = section.kind === 'summary' ? [moduleContentRows(section)] : section.items.filter(item => item.visible).map(item => moduleContentRows(section, item));
  const scale = appearance.spacingScale ?? 1;
  const rowGap = section.contentLayout?.rowGapPx ?? 4, itemGap = section.contentLayout?.itemGapPx ?? 8;
  return resumeTypeSize(appearance.fontSizePx, 'section') * appearance.lineHeight + 10 * scale + entries.reduce((total, rows) => total + rows.reduce((height, row) => {
    const natural = contentRowPresentation(row).inline;
    const fonts = row.map(cell => contentFontSize(cell.layout, appearance.fontSizePx, cell.spec));
    const largest = Math.max(...fonts, 0);
    const textHeight = natural ? textLines(row.map(cell => cell.text).join('  '), width, largest) * largest * appearance.lineHeight
      : Math.max(...row.map((cell, index) => textLines(cell.text, width / row.length, fonts[index]) * fonts[index] * appearance.lineHeight), 0);
    const paragraphs = row.reduce((height, cell, index) => height + (cell.rich?.content?.length ?? 0) * fonts[index] * .35 * scale, 0);
    return height + textHeight + paragraphs + rowGap;
  }, 0) + itemGap, 0);
}

export function estimateOnePageCost(resume: Resume): number {
  const width = Math.max(100, 794 - resume.appearance.marginPx * 2), visible = new Map(resume.sections.filter(sectionVisibleWithContent).map(section => [section.id, section]));
  const height = (ids: string[], columnWidth: number) => ids.reduce((sum, id) => sum + (visible.has(id) ? sectionHeight(visible.get(id)!, columnWidth, resume.appearance) : 0), 0);
  return resume.layout.groups.reduce((sum, group) => {
    if (resume.layout.mode === 'single') return sum + height([...group.main, ...group.sidebar], width);
    const usable = width - resume.appearance.columnGapPx;
    return sum + Math.max(height(group.main, usable * resume.layout.mainRatio), height(group.sidebar, usable * (1 - resume.layout.mainRatio)));
  }, 0);
}

export function describeOnePageChanges(original: Resume, next: Resume): string[] {
  const changes: string[] = [];
  if (original.layout.groups.length > next.layout.groups.length) changes.push(`合并 ${original.layout.groups.length} 个手动布局页`);
  if ((original.appearance.spacingScale ?? 1) !== (next.appearance.spacingScale ?? 1)) changes.push((next.appearance.spacingScale ?? 1) > (original.appearance.spacingScale ?? 1) ? '展开段落、标题和模块间距' : '收紧段落、标题和模块间距');
  const compacted = next.sections.filter(section => section.contentLayout && !original.sections.find(before => before.id === section.id)?.contentLayout);
  if (compacted.length) changes.push(`紧排${compacted.slice(0, 3).map(section => sectionTitle(section, original.locale)).join('、')}${compacted.length > 3 ? '等模块' : ''}的字段`);
  if (next.sections.some(section => {
    const before = original.sections.find(item => item.id === section.id)?.contentLayout;
    return before && section.contentLayout && (before.rowGapPx !== section.contentLayout.rowGapPx || before.itemGapPx !== section.contentLayout.itemGapPx);
  })) changes.push(next.sections.some(section => { const before = original.sections.find(item => item.id === section.id)?.contentLayout; return before && section.contentLayout && (section.contentLayout.rowGapPx > before.rowGapPx || section.contentLayout.itemGapPx > before.itemGapPx); }) ? '展开已自定义模块的字段和条目间距' : '缩小已自定义模块的字段和条目间距');
  if (original.layout.mode !== next.layout.mode) changes.push(next.layout.mode === 'single' ? '调整为单栏布局' : '调整为双栏布局');
  else if (original.layout.mode === 'double' && JSON.stringify(original.layout.groups.flatMap(group => group.sidebar)) !== JSON.stringify(next.layout.groups.flatMap(group => group.sidebar))) changes.push('平衡主栏与侧栏内容');
  if (original.layout.mainRatio !== next.layout.mainRatio && next.layout.mode === 'double') changes.push(`主栏宽度调整为 ${Math.round(next.layout.mainRatio * 100)}%`);
  if (original.appearance.columnGapPx !== next.appearance.columnGapPx && next.layout.mode === 'double') changes.push('缩小分栏间距');
  if (original.appearance.fontSizePx !== next.appearance.fontSizePx) changes.push(`正文字号 ${original.appearance.fontSizePx} → ${next.appearance.fontSizePx}px`);
  if (original.appearance.lineHeight !== next.appearance.lineHeight) changes.push(`行高 ${original.appearance.lineHeight} → ${next.appearance.lineHeight}`);
  if (original.appearance.marginPx !== next.appearance.marginPx) changes.push(`打印边距 ${original.appearance.marginPx} → ${next.appearance.marginPx}px`);
  return changes;
}
