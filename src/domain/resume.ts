import { z } from 'zod';
import sample from '../../docs/fixtures/resume-v1-example.json';
import type { Appearance, Column, CustomSection, FieldValue, ItemKind, ItemSection, Locale, Resume, ResumeSnapshot, RichDocument, RichNode, Section, SectionKind } from './types';
import { DEFAULT_APPEARANCE, FIELD_SPECS, ITEM_KINDS, SECTION_ORDER, sectionTitle, templateFor } from './registry';
import { TEMPLATES } from './templates';
import { FONT_IDS } from './fonts';

export const uid = (prefix = 'id') => `${prefix}-${crypto.randomUUID()}`;
export const emptyRich = (): RichDocument => ({ type: 'doc', content: [{ type: 'paragraph', content: [] }] });
export function removeAvatar(resume: Resume): void { resume.basics.avatarAssetId = null; resume.appearance.avatar.crop = null; }
export const richText = (doc?: RichNode): string => !doc ? '' : doc.type === 'text' ? (doc.text ?? '') : doc.type === 'hardBreak' ? '\n' : (doc.content ?? []).map(richText).join(['doc', 'bulletList', 'orderedList', 'listItem', 'codeBlock'].includes(doc.type) ? '\n' : '');
export function plainRich(text: string): RichDocument { return { type: 'doc', content: text.split(/\r?\n/).map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })) }; }
export function normalizeRich(raw: unknown): RichDocument {
  const normalize = (input: unknown): RichNode => {
    const n = input as Record<string, unknown>;
    const node: RichNode = { type: n.type as RichNode['type'] };
    if (typeof n.text === 'string') node.text = n.text;
    if (Array.isArray(n.content)) node.content = n.content.map(normalize);
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    if (node.type === 'heading') node.attrs = { level: attrs.level as 1 | 2 | 3 };
    if (['paragraph', 'heading'].includes(node.type) && attrs.textAlign && attrs.textAlign !== 'left') node.attrs = { ...node.attrs, textAlign: attrs.textAlign as 'center' | 'right' | 'justify' };
    if (node.type === 'orderedList' && typeof attrs.start === 'number' && attrs.start !== 1) node.attrs = { start: attrs.start };
    if (Array.isArray(n.marks)) node.marks = n.marks.map(mark => {
      const m = mark as { type: string; attrs?: { href?: string } };
      return m.type === 'link' ? { type: 'link' as const, attrs: { href: m.attrs?.href ?? '' } } : { type: m.type as 'bold' };
    });
    return node;
  };
  return normalize(raw) as RichDocument;
}
const str = z.string().max(200_000);
const identifier = z.string().min(1).max(160);
const hex = z.string().regex(/^#[\da-f]{6}$/i, '请使用六位 HEX 颜色');
const time = z.iso.datetime();
const localeSchema = z.enum(['en', 'fr', 'zh-CN', 'zh-TW', 'ja', 'de', 'es', 'pt', 'it', 'id', 'ms', 'vi']);
const richSchema: z.ZodType<RichNode> = z.lazy(() => z.object({
  type: z.enum(['doc', 'paragraph', 'text', 'heading', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'hardBreak']),
  attrs: z.object({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(), textAlign: z.enum(['left', 'center', 'right', 'justify']).optional(), start: z.number().int().positive().optional() }).strict().optional(),
  text: str.optional(), content: z.array(richSchema).max(5000).optional(),
  marks: z.array(z.union([z.object({ type: z.enum(['bold', 'italic', 'underline', 'strike', 'code', 'highlight']) }).strict(), z.object({ type: z.literal('link'), attrs: z.object({ href: str }).strict() }).strict()])).max(7).optional(),
}).strict()) as z.ZodType<RichNode>;
const richDocumentSchema = richSchema.refine(node => node.type === 'doc', '详情必须是文档节点');
const contentLayoutSchema = z.object({
  fields: z.array(z.object({ key: identifier, newLine: z.boolean(), align: z.enum(['left', 'center', 'right']), emphasis: z.enum(['normal', 'bold', 'muted']), visible: z.boolean(), inline: z.boolean().optional(), fontSizePx: z.number().min(8).max(36).optional(), italic: z.boolean().optional(), underline: z.boolean().optional() }).strict()).max(100)
    .refine(fields => new Set(fields.map(field => field.key)).size === fields.length, '字段排版不能包含重复字段'),
  rowGapPx: z.number().min(0).max(32), itemGapPx: z.number().min(0).max(64),
}).strict();
const sectionBase = { id: identifier, titleOverride: str.nullable(), visible: z.boolean(), contentLayout: contentLayoutSchema.optional() };
const itemSchemas = ITEM_KINDS.map(kind => {
  const fields = Object.fromEntries(FIELD_SPECS[kind].map(field => [field.key, field.type === 'rich' ? richDocumentSchema : field.type === 'tags' ? z.array(str).max(1000) : field.type === 'level' ? z.number().int().min(1).max(5).nullable() : str]));
  return z.object({ ...sectionBase, kind: z.literal(kind), items: z.array(z.object({ id: identifier, visible: z.boolean(), fields: z.object(fields).strict() }).strict()).max(1000) }).strict();
});
const customSchema = z.object({ ...sectionBase, kind: z.literal('custom'), fieldDefinitions: z.array(z.object({ id: identifier, type: z.enum(['name', 'description', 'date', 'location', 'url', 'keywords', 'summary']), label: str, visible: z.boolean() }).strict()).max(100), items: z.array(z.object({ id: identifier, visible: z.boolean(), values: z.record(z.string(), z.union([str, z.array(str), richDocumentSchema])) }).strict()).max(1000) }).strict();
const appearanceSchema = z.object({
  templateId: z.enum(TEMPLATES.map(template => template.id) as [string, ...string[]]), themeColor: hex, fontFamilyId: z.enum(FONT_IDS),
  fontSizePx: z.number().min(10).max(24), lineHeight: z.number().min(1.1).max(2), marginPx: z.number().min(8).max(96), columnGapPx: z.number().min(8).max(40),
  density: z.enum(['compact', 'standard', 'loose', 'custom']), hideIcons: z.boolean(), underlineLinks: z.boolean(), pageNumbers: z.boolean(),
  spacingScale: z.number().min(.45).max(3).optional(),
  avatar: z.object({ visible: z.boolean(), widthPx: z.number().min(16).max(240), aspectRatio: z.number().min(.4).max(2.5), radiusPx: z.number().min(0).max(160), borderWidthPx: z.number().min(0).max(12), borderColor: hex, crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().nullable() }).strict(),
}).strict();
export const ResumeSchema = z.object({
  id: identifier, schemaVersion: z.literal(1), title: z.string().max(200), locale: localeSchema, createdAt: time, updatedAt: time, revision: z.number().int().nonnegative(),
  basics: z.object({ name: str, headline: str, email: str, phone: str, website: str, location: str, avatarAssetId: identifier.nullable(), customFields: z.array(z.object({ id: identifier, iconId: z.string().max(80), label: str, value: str, visible: z.boolean() }).strict()).max(100) }).strict(),
  sections: z.array(z.union([z.object({ ...sectionBase, kind: z.literal('summary'), content: richDocumentSchema }).strict(), customSchema, ...itemSchemas])).max(100),
  layout: z.object({ mode: z.enum(['single', 'double']), sidebarSide: z.enum(['left', 'right']), mainRatio: z.number().min(.4).max(.75), groups: z.array(z.object({ id: identifier, main: z.array(identifier), sidebar: z.array(identifier) }).strict()).min(1).max(50) }).strict(),
  appearance: appearanceSchema,
}).strict().superRefine((value, ctx) => {
  const seen = new Set<string>();
  const add = (id: string) => { if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `ID 重复：${id}` }); seen.add(id); };
  value.basics.customFields.forEach(field => add(field.id));
  value.sections.forEach(section => {
    add(section.id);
    if (section.kind === 'summary') return;
    section.items.forEach(item => add(item.id));
    if (section.kind === 'custom') {
      section.fieldDefinitions.forEach(field => add(field.id));
      const definitions = new Map(section.fieldDefinitions.map(field => [field.id, field.type]));
      for (const item of section.items) for (const [id, content] of Object.entries(item.values)) {
        const type = definitions.get(id);
        if (!type) ctx.addIssue({ code: 'custom', message: '自定义字段引用不存在' });
        else if ((type === 'keywords' && !Array.isArray(content)) || (type === 'summary' && (!content || typeof content !== 'object' || Array.isArray(content))) || (!['keywords', 'summary'].includes(type) && typeof content !== 'string')) ctx.addIssue({ code: 'custom', message: '自定义字段类型不一致' });
      }
    }
  });
  value.layout.groups.forEach(group => add(group.id));
  const placed = value.layout.groups.flatMap(group => [...group.main, ...group.sidebar]);
  const ids = new Set(value.sections.map(section => section.id));
  if (placed.length !== ids.size || new Set(placed).size !== ids.size || placed.some(id => !ids.has(id))) ctx.addIssue({ code: 'custom', message: '布局必须包含每个模块且仅包含一次' });
  const crop = value.appearance.avatar.crop;
  if (crop && (crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001)) ctx.addIssue({ code: 'custom', message: '照片裁剪区域超出图片' });
});
export function parseResume(raw: unknown): Resume {
  const resume = ResumeSchema.parse(raw) as Resume;
  for (const section of resume.sections) {
    const documents = section.kind === 'summary' ? [section.content] : section.kind === 'custom' ? section.items.flatMap(item => Object.values(item.values)) : section.items.flatMap(item => Object.values(item.fields));
    for (const value of documents) if (value && typeof value === 'object' && !Array.isArray(value)) validateRich(value as RichNode);
  }
  return resume;
}
export function validateRich(node: RichNode, depth = 0): void {
  if (depth > 40) throw new Error('详情层级过深');
  const children = node.content ?? [];
  const allowed = node.type === 'doc' || node.type === 'listItem' ? ['paragraph', 'heading', 'bulletList', 'orderedList', 'codeBlock'] : node.type === 'bulletList' || node.type === 'orderedList' ? ['listItem'] : node.type === 'codeBlock' ? ['text'] : node.type === 'paragraph' || node.type === 'heading' ? ['text', 'hardBreak'] : [];
  if (children.some(child => !allowed.includes(child.type))) throw new Error('详情节点结构不正确');
  if (node.type === 'text' && typeof node.text !== 'string') throw new Error('文字节点缺少文字');
  if (node.type === 'heading' && !node.attrs?.level) throw new Error('标题缺少级别');
  for (const mark of node.marks ?? []) if (mark.type === 'link' && mark.attrs.href && !safeLink(mark.attrs.href)) throw new Error('链接协议不支持');
  children.forEach(child => validateRich(child, depth + 1));
}
export function safeLink(input: string): string | null {
  if (!input.trim()) return null;
  try { const url = new URL(input.trim()); return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function newItem(kind: ItemKind) { return { id: uid('item'), visible: true, fields: Object.fromEntries(FIELD_SPECS[kind].map(field => [field.key, field.type === 'rich' ? emptyRich() : field.type === 'tags' ? [] : field.type === 'level' ? null : ''])) as Record<string, FieldValue> }; }
export function newSection(kind: Exclude<SectionKind, 'custom'>): Section { return kind === 'summary' ? { id: uid('section'), kind, visible: true, titleOverride: null, content: emptyRich() } : { id: uid('section'), kind, visible: true, titleOverride: null, items: [] }; }
export function createResume(title = '我的简历', locale: Locale = 'zh-CN'): Resume {
  const now = new Date().toISOString();
  const sections = SECTION_ORDER.map(newSection);
  const sidebar = new Set(['profiles', 'skills', 'languages', 'interests']);
  return { id: uid('resume'), schemaVersion: 1, title, locale, createdAt: now, updatedAt: now, revision: 0,
    basics: { name: '', headline: '', email: '', phone: '', website: '', location: '', avatarAssetId: null, customFields: [] }, sections,
    layout: { mode: 'double', sidebarSide: 'left', mainRatio: .6, groups: [{ id: uid('page'), main: sections.filter(s => !sidebar.has(s.kind)).map(s => s.id), sidebar: sections.filter(s => sidebar.has(s.kind)).map(s => s.id) }] }, appearance: structuredClone(DEFAULT_APPEARANCE) };
}
export function remapResume(source: Resume, title = source.title, idMap = new Map<string, string>()): Resume {
  const remap = (id: string) => { if (!idMap.has(id)) idMap.set(id, uid(id.split('-')[0] || 'id')); return idMap.get(id)!; };
  const copy = structuredClone(source);
  copy.id = remap(copy.id); copy.title = title;
  copy.basics.customFields.forEach(field => { field.id = remap(field.id); });
  copy.sections.forEach(section => {
    section.id = remap(section.id);
    if (section.kind === 'summary') return;
    section.items.forEach(item => { item.id = remap(item.id); });
    if (section.kind === 'custom') {
      section.fieldDefinitions.forEach(field => { field.id = remap(field.id); });
      section.items.forEach(item => { item.values = Object.fromEntries(Object.entries(item.values).map(([id, value]) => [remap(id), value])); });
      section.contentLayout?.fields.forEach(field => { field.key = remap(field.key); });
    }
  });
  copy.layout.groups.forEach(group => { group.id = remap(group.id); group.main = group.main.map(remap); group.sidebar = group.sidebar.map(remap); });
  const now = new Date().toISOString(); copy.createdAt = now; copy.updatedAt = now; copy.revision = 0;
  return parseResume(copy);
}
export function createExample(title = '前端工程师 · 示例'): Resume {
  const example = remapResume(parseResume(sample.resumes[0]), title);
  example.appearance = structuredClone(DEFAULT_APPEARANCE);
  const core = new Set<SectionKind>(['summary', 'education', 'work', 'projects', 'skills', 'languages', 'profiles']);
  example.sections.forEach(section => { if (!core.has(section.kind)) section.visible = false; });
  return example;
}
export function defaultAppearanceForTemplate(templateId: string): Appearance {
  const template = templateFor(templateId);
  const { sidebarSide: _side, mainRatio: _ratio, ...appearance } = template.defaults ?? {};
  return { ...structuredClone(DEFAULT_APPEARANCE), ...appearance, templateId: template.id };
}
export function snapshotOf(resume: Resume): ResumeSnapshot { const { id: _id, createdAt: _created, updatedAt: _updated, revision: _revision, ...data } = structuredClone(resume); return data; }
export function changeResume(resume: Resume, edit: (next: Resume) => void): Resume { const next = structuredClone(resume); edit(next); next.updatedAt = new Date().toISOString(); return next; }
/** Older single-column resumes can still contain sidebar assignments. */
export function layoutPageGroups(resume: Resume): Resume['layout']['groups'] {
  return resume.layout.mode === 'double' ? resume.layout.groups : resume.layout.groups.map(group => ({ ...group, main: [...group.main, ...group.sidebar], sidebar: [] }));
}
export function setLayoutMode(resume: Resume, mode: Resume['layout']['mode']): Resume {
  return changeResume(resume, next => {
    next.layout.mode = mode;
    next.layout.groups = layoutPageGroups(next);
  });
}
export function moveSection(resume: Resume, id: string, pageId: string, column: Column, index: number): Resume {
  if (!resume.sections.some(section => section.id === id) || !resume.layout.groups.some(group => group.id === pageId)) throw new Error('移动目标不存在');
  return changeResume(resume, next => {
    next.layout.groups = layoutPageGroups(next);
    next.layout.groups.forEach(group => { group.main = group.main.filter(value => value !== id); group.sidebar = group.sidebar.filter(value => value !== id); });
    const target = next.layout.groups.find(group => group.id === pageId)![next.layout.mode === 'single' ? 'main' : column];
    target.splice(Math.max(0, Math.min(index, target.length)), 0, id);
  });
}
export function removePage(resume: Resume, pageId: string, targetId: string): Resume {
  if (pageId === targetId || resume.layout.groups.length === 1) throw new Error('请保留至少一个布局页');
  const page = resume.layout.groups.find(group => group.id === pageId), target = resume.layout.groups.find(group => group.id === targetId);
  if (!page || !target) throw new Error('接收页不存在');
  return changeResume(resume, next => {
    next.layout.groups = layoutPageGroups(next);
    const source = next.layout.groups.find(group => group.id === pageId)!;
    const receiver = next.layout.groups.find(group => group.id === targetId)!;
    receiver.main.push(...source.main); receiver.sidebar.push(...source.sidebar);
    next.layout.groups = next.layout.groups.filter(group => group.id !== pageId);
  });
}
export function applyTemplate(resume: Resume, templateId: string): Resume {
  const template = templateFor(templateId);
  return changeResume(resume, next => {
    const changed = next.appearance.templateId !== template.id;
    const initializeSidebar = changed && template.defaults && template.mode === 'double' && next.layout.mode === 'single' && next.layout.groups.every(group => group.sidebar.length === 0);
    next.appearance.templateId = template.id; next.layout.mode = template.mode;
    if (changed && template.defaults) {
      const { sidebarSide, mainRatio, ...appearance } = template.defaults;
      Object.assign(next.appearance, appearance);
      if (sidebarSide) next.layout.sidebarSide = sidebarSide;
      if (mainRatio) next.layout.mainRatio = mainRatio;
    }
    if (initializeSidebar) {
      const shortKinds = new Set<SectionKind>(['profiles', 'skills', 'languages', 'interests']);
      const shortIds = new Set(next.sections.filter(section => shortKinds.has(section.kind)).map(section => section.id));
      for (const group of next.layout.groups) {
        group.sidebar = group.main.filter(id => shortIds.has(id));
        group.main = group.main.filter(id => !shortIds.has(id));
      }
    }
  });
}
export function itemName(section: Exclude<Section, { kind: 'summary' }>, id: string): string {
  const item = section.items.find(item => item.id === id); if (!item) return '未命名条目';
  const values = section.kind === 'custom' ? Object.values((item as CustomSection['items'][number]).values) : Object.values((item as ItemSection['items'][number]).fields);
  return values.find(value => typeof value === 'string' && value.trim()) as string || '未命名条目';
}
export function hasContent(value: unknown): boolean { return typeof value === 'string' ? Boolean(value.trim()) : Array.isArray(value) ? value.some(hasContent) : Boolean(value && typeof value === 'object' && richText(value as RichNode).trim()); }
export function sectionHasContent(section: Section): boolean { return section.visible && (section.kind === 'summary' ? hasContent(section.content) : section.items.some(item => item.visible && Object.values('fields' in item ? item.fields : item.values).some(hasContent))); }
export interface CheckIssue { label: string; target: string; severity: 'suggestion' | 'error'; points?: number }
export function completeness(resume: Resume): { score: number; suggestions: CheckIssue[] } {
  const sections = resume.sections.filter(sectionHasContent);
  const has = (kind: SectionKind) => sections.some(section => section.kind === kind);
  const tests: [boolean, number, string, string][] = [
    [Boolean(resume.basics.name.trim()), 10, '填写全名', 'basics-name'], [Boolean(resume.basics.headline.trim()), 10, '填写职位', 'basics-headline'],
    [Boolean([resume.basics.email, resume.basics.phone, resume.basics.website].some(value => value.trim())), 10, '补充联系方式', 'basics-email'],
    [has('summary'), 10, '添加个人总结', 'section-summary'], [has('education'), 15, '补充教育背景', 'section-education'],
    [has('work') || has('projects'), 25, '添加工作或项目经历', 'section-work'], [has('skills'), 10, '补充技能', 'section-skills'],
    [sections.some(section => section.kind !== 'summary' && section.items.some(item => item.visible && Object.entries('fields' in item ? item.fields : item.values).some(([key, value]) => (key === 'summary' || (typeof value === 'object' && !Array.isArray(value))) && hasContent(value)))), 10, '为经历补充详情', 'section-work'],
  ];
  return { score: tests.reduce((sum, [ok, points]) => sum + (ok ? points : 0), 0), suggestions: tests.filter(([ok]) => !ok).map(([, points, label, target]) => ({ label, target, points, severity: 'suggestion' })) };
}
export function fieldChecks(resume: Resume): CheckIssue[] {
  const issues = [...completeness(resume).suggestions];
  if (resume.basics.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resume.basics.email)) issues.push({ label: '邮箱格式需要检查', target: 'basics-email', severity: 'suggestion' });
  if (resume.basics.website && !safeLink(resume.basics.website)) issues.push({ label: '个人主页需要完整的 http 或 https 地址', target: 'basics-website', severity: 'suggestion' });
  return issues;
}
export function withoutEmptySections(resume: Resume): Section[] { return resume.sections.filter(sectionHasContent); }
export function appearancePatch(resume: Resume, patch: Partial<Appearance>): Resume { return changeResume(resume, next => { next.appearance = { ...next.appearance, ...patch }; }); }
export function compactLabel(section: Section) { return sectionTitle(section, 'zh-CN'); }
