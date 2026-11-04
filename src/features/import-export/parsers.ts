import { unified } from 'unified';
import remarkParse from 'remark-parse';
import type { BackupEnvelope, CustomSection, FieldValue, ItemKind, Locale, Resume, RichDocument, RichMark, RichNode, SectionKind } from '../../domain/types';
import { createResume, emptyRich, newItem, newSection, parseResume, richText, safeLink, sectionHasContent, uid } from '../../domain/resume';
import { FIELD_SPECS, SECTION_ORDER, sectionTitle } from '../../domain/registry';

export function parseBackup(text: string): BackupEnvelope {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (raw.format !== 'myresume') throw new Error('请选择 MyResume 导出的 JSON 备份文件');
  if (raw.schemaVersion !== 1) throw new Error('这个备份版本暂不支持，请使用匹配版本的应用导入');
  if (typeof raw.exportedAt !== 'string' || Number.isNaN(Date.parse(raw.exportedAt))) throw new Error('备份缺少有效的导出时间');
  if (Object.keys(raw).some(key => !['format', 'schemaVersion', 'exportedAt', 'resumes', 'assets', 'histories'].includes(key))) throw new Error('备份包含当前版本无法识别的字段');
  if (!Array.isArray(raw.resumes) || !Array.isArray(raw.assets) || raw.resumes.length > 500) throw new Error('备份结构不完整');
  const resumes = raw.resumes.map(parseResume);
  const assets = raw.assets as BackupEnvelope['assets'];
  const ids = new Set<string>();
  for (const asset of assets) {
    if (!asset || Object.keys(asset).some(key => !['id', 'mime', 'width', 'height', 'sha256', 'dataBase64'].includes(key)) || typeof asset.id !== 'string' || typeof asset.dataBase64 !== 'string' || !/^[\da-f]{64}$/i.test(asset.sha256) || !['image/png', 'image/jpeg'].includes(asset.mime) || !Number.isInteger(asset.width) || !Number.isInteger(asset.height) || asset.width <= 0 || asset.height <= 0 || asset.width * asset.height > 40_000_000 || ids.has(asset.id)) throw new Error('备份中的照片数据无效');
    ids.add(asset.id);
  }
  for (const resume of resumes) if (resume.basics.avatarAssetId && !ids.has(resume.basics.avatarAssetId)) throw new Error('备份缺少简历引用的照片');
  if (new Set(resumes.map(resume => resume.id)).size !== resumes.length) throw new Error('备份中的简历 ID 重复');
  const histories = raw.histories as BackupEnvelope['histories'];
  if (histories !== undefined && !Array.isArray(histories)) throw new Error('历史版本数据无效');
  for (const history of histories ?? []) {
    if (!history || Object.keys(history).some(key => !['id', 'resumeId', 'createdAt', 'reason', 'snapshot', 'snapshotHash', 'restoredFrom'].includes(key))) throw new Error('历史版本包含当前版本无法识别的字段');
    const parent = resumes.find(resume => resume.id === history.resumeId);
    if (!parent || typeof history.id !== 'string' || typeof history.reason !== 'string' || typeof history.createdAt !== 'string' || !/^[\da-f]{64}$/i.test(history.snapshotHash)) throw new Error('历史版本引用不完整');
    const restored = parseResume({ ...parent, ...history.snapshot, id: parent.id });
    if (restored.basics.avatarAssetId && !ids.has(restored.basics.avatarAssetId)) throw new Error('备份缺少历史版本引用的照片');
  }
  return { format: 'myresume', schemaVersion: 1, exportedAt: String(raw.exportedAt), resumes, assets, ...(histories ? { histories } : {}) };
}
interface AstNode { type: string; value?: string; depth?: number; children?: AstNode[]; ordered?: boolean; start?: number; url?: string; alt?: string }
function astText(node: AstNode): string { return node.value ?? (node.children ?? []).map(astText).join(''); }
function marked(nodes: RichNode[], mark: RichMark): RichNode[] { return nodes.map(node => ({ ...node, ...(node.type === 'text' ? { marks: [...(node.marks ?? []), mark] } : {}), ...(node.content ? { content: marked(node.content, mark) } : {}) })); }
function toNodes(node: AstNode, inline = false): RichNode[] {
  const children = (node.children ?? []).flatMap(child => toNodes(child, ['paragraph', 'heading', 'strong', 'emphasis', 'link'].includes(node.type)));
  if (node.type === 'text') return [{ type: 'text', text: node.value ?? '' }];
  if (node.type === 'strong') return marked(children, { type: 'bold' });
  if (node.type === 'emphasis') return marked(children, { type: 'italic' });
  if (node.type === 'inlineCode') return [{ type: 'text', text: node.value ?? '', marks: [{ type: 'code' }] }];
  if (node.type === 'link') return safeLink(node.url ?? '') ? marked(children, { type: 'link', attrs: { href: safeLink(node.url!)! } }) : children;
  if (node.type === 'break') return [{ type: 'hardBreak' }];
  if (node.type === 'paragraph') return [{ type: 'paragraph', content: children }];
  if (node.type === 'heading') return [{ type: 'heading', attrs: { level: Math.min(3, node.depth ?? 1) as 1 | 2 | 3 }, content: children }];
  if (node.type === 'list') return [{ type: node.ordered ? 'orderedList' : 'bulletList', ...(node.ordered ? { attrs: { start: node.start ?? 1 } } : {}), content: children }];
  if (node.type === 'listItem') return [{ type: 'listItem', content: children }];
  if (node.type === 'code') return [{ type: 'codeBlock', content: [{ type: 'text', text: node.value ?? '' }] }];
  if (node.type === 'html') { const text: RichNode = { type: 'text', text: node.value ?? '' }; return inline ? [text] : [{ type: 'paragraph', content: [text] }]; }
  if (node.type === 'image') { const text: RichNode = { type: 'text', text: `[图片：${node.alt ?? ''}] ${node.url ?? ''}` }; return inline ? [text] : [{ type: 'paragraph', content: [text] }]; }
  return children;
}
const aliases: Record<string, SectionKind> = {
  '个人简介': 'summary', '个人情况': 'summary', '基本情况': 'summary', '自我评价': 'summary', '简介': 'summary', 'profile': 'summary', 'summary': 'summary',
  '教育经历': 'education', '学历': 'education', 'education': 'education', '工作经验': 'work', '工作': 'work', 'experience': 'work', 'work experience': 'work',
  '项目': 'projects', '项目经验': 'projects', '项目实践': 'projects', '技术项目': 'projects', '个人项目': 'projects', 'projects': 'projects', '实习': 'internships', 'internships': 'internships', '专业技能': 'skills', '个人技能': 'skills', '技术技能': 'skills', '技能清单': 'skills', 'skills': 'skills',
  '荣誉奖项': 'awards', '获奖情况': 'awards', '荣誉奖励': 'awards', '奖项荣誉': 'awards',
  'languages': 'languages', 'awards': 'awards', 'certificates': 'certifications', 'certifications': 'certifications', 'interests': 'interests', 'publications': 'publications', 'volunteering': 'volunteer', 'references': 'references',
};
for (const kind of SECTION_ORDER) aliases[sectionTitle(newSection(kind)).toLowerCase()] = kind;
export interface ImportedItem { id: string; fields: Record<string, FieldValue> }
export interface TextGroup { id: string; heading: string; kind: SectionKind; content: RichDocument; itemKind?: ItemKind; items?: ImportedItem[]; pages?: number[] }
export interface TextCandidate { title: string; basics: Resume['basics']; groups: TextGroup[] }
export function guessSection(title: string): SectionKind | null { return aliases[title.normalize('NFKC').replace(/\s+/g, ' ').replace(/^[\d.、\-\s]+|[:：\s]+$/g, '').trim().toLowerCase()] ?? aliases[title.normalize('NFKC').replace(/\s+/g, '').replace(/[:：]+$/g, '').toLowerCase()] ?? null; }
export function parseText(text: string, title = '导入的简历'): TextCandidate {
  if (!text.trim()) throw new Error('请先填写或选择简历内容');
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error('文本文件需要小于 1 MB');
  const root = unified().use(remarkParse).parse(text) as unknown as AstNode;
  const candidate: TextCandidate = { title, basics: createResume().basics, groups: [] };
  let group: TextGroup = { id: uid('import'), heading: '个人总结', kind: 'summary', content: emptyRich() }; group.content.content = [];
  const commit = () => { if (group.content.content?.length) candidate.groups.push(group); };
  for (const node of root.children ?? []) {
    if (node.type === 'heading') { commit(); const heading = astText(node).trim(); group = { id: uid('import'), heading, kind: guessSection(heading) ?? 'custom', content: { type: 'doc', content: [] } }; }
    else group.content.content!.push(...toNodes(node));
  }
  commit();
  const labels: [keyof Pick<Resume['basics'], 'name' | 'headline' | 'email' | 'phone' | 'website' | 'location'>, RegExp][] = [
    ['name', /^(?:姓名|全名|name)\s*[:：]\s*(.+)$/im], ['headline', /^(?:职位|求职岗位|headline|position)\s*[:：]\s*(.+)$/im],
    ['email', /^(?:邮箱|email|e-mail)\s*[:：]\s*(.+)$/im], ['phone', /^(?:电话|手机|phone)\s*[:：]\s*(.+)$/im],
    ['website', /^(?:主页|网站|个人主页|website)\s*[:：]\s*(.+)$/im], ['location', /^(?:位置|城市|地址|location)\s*[:：]\s*(.+)$/im],
  ];
  for (const [key, regex] of labels) { const value = text.match(regex)?.[1]; if (value) candidate.basics[key] = value.trim(); }
  return candidate;
}
export function resumeFromText(candidate: TextCandidate, locale: Locale): Resume {
  const resume = createResume(candidate.title || '导入的简历', locale); resume.basics = structuredClone(candidate.basics);
  for (const group of candidate.groups) {
    if (group.kind === 'custom') {
      const fieldId = uid('field'); const section: CustomSection = { id: uid('section'), kind: 'custom', titleOverride: group.heading, visible: true, fieldDefinitions: [{ id: fieldId, type: 'summary', label: '详情', visible: true }], items: [{ id: uid('item'), visible: true, values: { [fieldId]: group.content } }] };
      resume.sections.push(section); resume.layout.groups[0].main.push(section.id); continue;
    }
    const section = resume.sections.find(section => section.kind === group.kind)!;
    if (section.kind === 'summary') { section.content.content = [...(section.content.content ?? []).filter(node => node.content?.length), ...(group.content.content ?? [])]; section.titleOverride = group.heading; }
    else if (section.kind !== 'custom') {
      if (group.items && group.itemKind === section.kind) { section.items.push(...group.items.map(item => ({ ...newItem(section.kind), fields: structuredClone(item.fields) }))); section.titleOverride = group.heading; continue; }
      const item = newItem(section.kind); const spec = FIELD_SPECS[section.kind].find(field => field.type === 'rich');
      if (spec) item.fields[spec.key] = group.content;
      else { const key = FIELD_SPECS[section.kind][0].key; item.fields[key] = richText(group.content); }
      section.items.push(item); section.titleOverride = group.heading;
    }
  }
  const visible = new Set(resume.sections.filter(sectionHasContent).map(section => section.id));
  if (!resume.layout.groups.some(group => group.sidebar.some(id => visible.has(id)))) {
    resume.layout.mode = 'single'; resume.appearance.templateId = 'clean';
  }
  return parseResume(resume);
}
