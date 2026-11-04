import type { ResumeSnapshot, Section } from '../../domain/types';
import { richText } from '../../domain/resume';
import { sectionTitle } from '../../domain/registry';
import { contentFieldSpecs, resolveContentLayout } from '../../domain/contentLayout';

export interface Difference { label: string; before: string; after: string; kind: 'change' | 'add' | 'remove' | 'move' }
const stringify = (value: unknown): string => value === null || value === undefined ? '' : typeof value === 'string' ? value : typeof value === 'boolean' ? value ? '开启' : '关闭' : Array.isArray(value) ? value.map(stringify).join('、') : typeof value === 'object' && 'type' in value ? richText(value as Parameters<typeof richText>[0]) : JSON.stringify(value);
function contentLayoutDescription(section: Section): string {
  if (!section.contentLayout) return '模板默认排版';
  const layout = resolveContentLayout(section), labels = new Map(contentFieldSpecs(section).map(field => [field.key, field.label]));
  const align = { left: '左对齐', center: '居中', right: '右对齐' }, emphasis = { normal: '正常', bold: '加粗', muted: '次要文字' };
  return layout.fields.map((field, index) => `${labels.get(field.key) ?? field.key}（${field.visible ? `${index === 0 || field.newLine ? '新行' : '同行'}、${align[field.align]}、${emphasis[field.emphasis]}${field.fontSizePx !== undefined ? `、字号 ${field.fontSizePx}px` : ''}${field.italic ? '、斜体' : ''}${field.underline ? '、下划线' : ''}` : '隐藏'}）`).join('；') + `；行间距 ${layout.rowGapPx}px，条目间距 ${layout.itemGapPx}px`;
}
export function diffSnapshots(before: ResumeSnapshot, after: ResumeSnapshot): Difference[] {
  const differences: Difference[] = [];
  const add = (label: string, a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) differences.push({ label, before: stringify(a), after: stringify(b), kind: 'change' }); };
  const names: Record<string, string> = { name: '全名', headline: '职位', email: '邮箱', phone: '电话', website: '个人主页', location: '位置', avatarAssetId: '照片', customFields: '自定义联系信息' };
  Object.keys(names).forEach(key => add(names[key], before.basics[key as keyof typeof before.basics], after.basics[key as keyof typeof after.basics]));
  add('简历标题', before.title, after.title); add('简历语言', before.locale, after.locale); add('页面外观', before.appearance, after.appearance);
  const old = new Map(before.sections.map(section => [section.id, section])), current = new Map(after.sections.map(section => [section.id, section]));
  const placement = (snapshot: ResumeSnapshot, id: string) => { for (let i = 0; i < snapshot.layout.groups.length; i++) { const group = snapshot.layout.groups[i]; for (const role of ['main', 'sidebar'] as const) { const index = group[role].indexOf(id); if (index >= 0) return `第 ${i + 1} 页 · ${role === 'main' ? '主栏' : '侧栏'} · 第 ${index + 1} 项`; } } return ''; };
  for (const [id, section] of old) if (!current.has(id)) differences.push({ label: sectionTitle(section), before: '存在', after: '已删除', kind: 'remove' });
  for (const [id, section] of current) {
    const previous = old.get(id), title = sectionTitle(section);
    if (!previous) { differences.push({ label: title, before: '', after: '新增模块', kind: 'add' }); continue; }
    add(`${title} · 标题`, previous.titleOverride, section.titleOverride); add(`${title} · 显示`, previous.visible, section.visible);
    if (JSON.stringify(previous.contentLayout) !== JSON.stringify(section.contentLayout)) differences.push({ label: `${title} · 模块内排版`, before: contentLayoutDescription(previous), after: contentLayoutDescription(section), kind: 'change' });
    const from = placement(before, id), to = placement(after, id); if (from !== to) differences.push({ label: `${title} · 位置`, before: from, after: to, kind: 'move' });
    if (section.kind === 'summary' && previous.kind === 'summary') add(`${title} · 内容`, previous.content, section.content);
    else if (section.kind !== 'summary' && previous.kind !== 'summary') {
      const a = new Map(previous.items.map(item => [item.id, item])), b = new Map(section.items.map(item => [item.id, item]));
      for (const [itemId, item] of a) if (!b.has(itemId)) differences.push({ label: `${title} · 条目`, before: stringify('fields' in item ? item.fields : item.values), after: '已删除', kind: 'remove' });
      for (const [itemId, item] of b) { const original = a.get(itemId); if (!original) differences.push({ label: `${title} · 条目`, before: '', after: stringify('fields' in item ? item.fields : item.values), kind: 'add' }); else add(`${title} · 条目内容`, original, item); }
      if (JSON.stringify(previous.items.map(item => item.id)) !== JSON.stringify(section.items.map(item => item.id)) && a.size === b.size && [...a.keys()].every(id => b.has(id))) differences.push({ label: `${title} · 条目顺序`, before: '原顺序', after: '已重新排列', kind: 'move' });
    }
  }
  return differences;
}
export function sectionNameForDiff(section: Section) { return sectionTitle(section); }
