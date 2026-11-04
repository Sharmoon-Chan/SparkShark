import type { FieldValue, ItemKind, RichDocument, RichNode, SectionKind } from '../../domain/types';
import { createResume, newItem, richText, uid } from '../../domain/resume';
import { FIELD_SPECS } from '../../domain/registry';
import { guessSection, type ImportedItem, type TextCandidate, type TextGroup } from './parsers';

export interface PdfSpan { text: string; x: number; y: number; width: number; height: number; page: number; bold?: boolean; url?: string }
export interface PdfPageText { number: number; width: number; height: number; spans: PdfSpan[] }
export interface PdfLine { text: string; x: number; y: number; right: number; size: number; page: number; bold: boolean; spans: PdfSpan[] }
export interface PdfWarning { kind: 'characters' | 'layout' | 'image'; message: string }
export interface PdfCandidate extends TextCandidate { sourceText: string; pageCount: number; columns: number; warnings: PdfWarning[] }
const datePattern = /(?:19|20)\d{2}(?:[.\/年\-]\s*\d{1,2}(?:[.\/月\-]\d{1,2}日?)?)?\s*(?:[—–\-~至]|到)\s*(?:(?:19|20)\d{2}(?:[.\/年\-]\s*\d{1,2}(?:[.\/月\-]\d{1,2}日?)?)?|至今|现在|present|current)|(?:19|20)\d{2}[.\/年\-]\s*\d{1,2}(?:[.\/月\-]\d{1,2}日?)?/i;
const yearOnly = /^(?:19|20)\d{2}$/;
const damagedDate = /^[\d�]{4}[.\/年]\s*[\d�]{1,2}(?:\s*[—–\-~]\s*[\d�]{4}[.\/年]\s*[\d�]{1,2})?$/;
const urlPattern = /https?:\/\/[^\s<>()，。]+/i;
const emailPattern = /[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function joinSpans(spans: PdfSpan[]): string {
  let text = '';
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i], previous = spans[i - 1];
    const gap = previous ? span.x - previous.x - previous.width : 0;
    if (text && !/\s$/.test(text) && !/^\s/.test(span.text) && gap > Math.max(1.5, span.height * .16) && !cjk.test(text.slice(-1)) && !cjk.test(span.text[0] ?? '')) text += ' ';
    text += span.text;
  }
  return text.trim();
}
export function pdfLines(page: PdfPageText): PdfLine[] {
  const rows: PdfSpan[][] = [];
  for (const span of [...page.spans].filter(span => span.text.trim()).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(row => Math.abs(row[0].y - span.y) <= Math.max(2, Math.min(row[0].height, span.height) * .24));
    if (row) row.push(span); else rows.push([span]);
  }
  const output: PdfLine[] = [];
  for (const row of rows) {
    const sorted = row.sort((a, b) => a.x - b.x); const segments: PdfSpan[][] = [[]];
    for (const span of sorted) {
      const segment = segments.at(-1)!, previous = segment.at(-1);
      if (previous && span.x - previous.x - previous.width > Math.max(16, Math.max(previous.height, span.height) * 1.8)) segments.push([span]); else segment.push(span);
    }
    for (const spans of segments) if (spans.length) {
      const text = joinSpans(spans);
      if (/^\d{1,3}$/.test(text) && spans[0].y > page.height * .9) continue;
      output.push({ text, x: Math.min(...spans.map(span => span.x)), y: Math.min(...spans.map(span => span.y)), right: Math.max(...spans.map(span => span.x + span.width)), size: Math.max(...spans.map(span => span.height)), page: page.number, bold: spans.some(span => span.bold), spans });
    }
  }
  return output.sort((a, b) => a.y - b.y || a.x - b.x);
}
function columnCut(lines: PdfLine[], width: number): number | null {
  const starts = new Map<number, number>();
  for (const line of lines) { const bucket = Math.round(line.x / 12) * 12; starts.set(bucket, (starts.get(bucket) ?? 0) + 1); }
  const ranked = [...starts].sort((a, b) => b[1] - a[1]);
  const first = ranked[0]; if (!first) return null;
  const second = ranked.find(([x, count]) => Math.abs(x - first[0]) > width * .19 && count >= 3);
  if (!second || first[1] < 3) return null;
  const left = Math.min(first[0], second[0]), right = Math.max(first[0], second[0]);
  if (left > width * .25 || right > width * .83) return null;
  const leftLines = lines.filter(line => Math.abs(line.x - left) < 30);
  if (leftLines.filter(line => line.right > right + 10).length > Math.max(1, leftLines.length * .15)) return null;
  return (left + right) / 2;
}
const mainWeights: Partial<Record<SectionKind, number>> = { work: 6, education: 5, projects: 5, internships: 4, summary: 4, skills: -3, languages: -3, profiles: -2, interests: -2 };
function appendLines(lines: PdfLine[]): RichDocument {
  const content: RichNode[] = [];
  let previous: PdfLine | undefined;
  for (const line of lines) {
    const bullet = /^[•·●▪▸\-]\s*/.test(line.text);
    const text = line.text.replace(/^[•●▪▸]\s*/, '');
    const paragraph: RichNode = { type: 'paragraph', content: [{ type: 'text', text, ...(line.bold ? { marks: [{ type: 'bold' as const }] } : {}) }] };
    if (bullet) {
      const last = content.at(-1);
      const item: RichNode = { type: 'listItem', content: [paragraph] };
      if (last?.type === 'bulletList') last.content!.push(item); else content.push({ type: 'bulletList', content: [item] });
    } else {
      const last = content.at(-1);
      const wrapped = previous && last?.type === 'paragraph' && !line.bold && !previous.bold && !datePattern.test(line.text) && !urlPattern.test(line.text) && !/[。！？.!?:：;；]$/.test(previous.text) && (line.page !== previous.page || line.y - previous.y <= Math.max(previous.size, line.size) * 1.95);
      if (wrapped && previous) { const separator = cjk.test(previous.text.slice(-1)) || cjk.test(line.text[0] ?? '') ? '' : ' '; last.content!.push({ type: 'text', text: separator + text }); }
      else content.push(paragraph);
    }
    previous = line;
  }
  return { type: 'doc', content };
}
const company = /公司|集团|工作室|\b(?:Inc\.?|Ltd\.?|Company|Corporation|Studio)\b/i;
const institution = /大学|学院|学校|\b(?:University|College|Institute|School)\b/i;
function labelledRecord(kind: ItemKind, text: string): RegExpMatchArray | null {
  if (!['skills', 'languages'].includes(kind) || urlPattern.test(text) || /^[-•●▪]/.test(text)) return null;
  const match = text.match(/^([^:：\n]{1,28})\s*[:：]\s*(\S[\s\S]*)$/);
  return match && !FIELD_SPECS[kind].some(field => field.label === match[1].trim()) ? match : null;
}
function isItemTitle(kind: ItemKind, line: PdfLine): boolean {
  if (!line.text.trim() || line.text.length > 90 || /^[-•●▪]/.test(line.text) || urlPattern.test(line.text) || emailPattern.test(line.text)) return false;
  if (yearOnly.test(line.text.trim()) || damagedDate.test(line.text.trim())) return false;
  if (kind === 'work' || kind === 'internships') return (company.test(line.text) && /公司$|集团$|工作室$|\b(?:Inc\.?|Ltd\.?|Company|Corporation|Studio)$/i.test(line.text)) || (line.bold && !datePattern.test(line.text));
  if (kind === 'education') return institution.test(line.text);
  if (labelledRecord(kind, line.text)) return true;
  if (kind === 'projects' && /[|｜]/.test(line.text) && !/[:：]/.test(line.text)) return true;
  if (kind === 'awards' && !/[:：]/.test(line.text) && /奖学金|[一二三]等奖|设计师|证书|竞赛/.test(line.text.normalize('NFKC'))) return true;
  return line.bold && !datePattern.test(line.text) && line.text.length < 70;
}
function parseItem(kind: ItemKind, lines: PdfLine[]): ImportedItem {
  const fields = newItem(kind).fields, remaining: PdfLine[] = [];
  const specs = FIELD_SPECS[kind], richField = specs.find(field => field.type === 'rich');
  const primary = ({ education: 'institution', work: 'company', internships: 'company', awards: 'title', volunteer: 'organization', profiles: 'network' } as Record<string, string>)[kind] ?? 'name';
  let gotPrimary = false;
  for (const line of lines) {
    const text = line.text.trim(); if (!text) continue;
    const labelled = !gotPrimary && labelledRecord(kind, text);
    if (labelled) { fields[primary] = labelled[1].trim(); fields.description = labelled[2].trim(); gotPrimary = true; continue; }
    const explicit = specs.find(spec => new RegExp(`^${spec.label}\\s*[:：]`).test(text));
    if (explicit && explicit.type !== 'rich' && explicit.type !== 'tags' && explicit.type !== 'level') { fields[explicit.key] = text.replace(new RegExp(`^${explicit.label}\\s*[:：]\\s*`), ''); if (explicit.key === primary) gotPrimary = true; continue; }
    if (text.includes('�') && damagedDate.test(text) && 'dateText' in fields && !fields.dateText) { fields.dateText = text; continue; }
    const dateText = text.replace(/[⽇⽉⾄]/g, character => character.normalize('NFKC'));
    const dates = [...dateText.matchAll(new RegExp(datePattern.source, 'gi'))];
    const date = yearOnly.test(dateText) ? dateText : dates[0]?.[0];
    if (date && 'dateText' in fields && !fields.dateText) {
      const onlyDates = yearOnly.test(dateText) || dateText.replace(new RegExp(datePattern.source, 'gi'), '').replace(/[\s、,，·|｜]/g, '') === '';
      fields.dateText = onlyDates ? dateText : date; if (onlyDates) continue;
    }
    const url = line.spans.find(span => span.url?.startsWith('http'))?.url ?? text.match(urlPattern)?.[0];
    const urlKey = 'officialUrl' in fields ? 'officialUrl' : 'url' in fields ? 'url' : null;
    if (url && urlKey && !fields[urlKey]) { fields[urlKey] = url; if (text === url || /^https?:\/\//.test(text)) continue; }
    if (!gotPrimary && text.length < 120 && !/^[-•●▪]/.test(text) && !datePattern.test(text)) {
      const projectParts = kind === 'projects' ? text.split(/\s*[|｜]\s*/) : [];
      fields[primary] = projectParts.length > 1 ? projectParts[0] : text;
      if (projectParts.length > 1) fields.keywords = projectParts.slice(1).join(' · ').split(/[·•]/).map(value => value.trim()).filter(Boolean);
      gotPrimary = true; continue;
    }
    if ('studyType' in fields && !fields.studyType && /^(?:本科|学士|硕士|博士|大专|研究生|Bachelor.*|Master.*|Ph\.?D\.?|B\.?Sc\.?)$/i.test(text)) { fields.studyType = text; continue; }
    if ('major' in fields && !fields.major && text.length < 90 && /专业|科学|工程|技术|管理|\b(?:Science|Engineering|Computer|Business)\b/i.test(text)) { fields.major = text.replace(/^专业\s*[:：]\s*/, ''); continue; }
    if ('score' in fields && !fields.score && /^(?:GPA[:： ]*)?\d(?:\.\d+)?\s*\/\s*\d(?:\.\d+)?$/i.test(text)) { fields.score = text; continue; }
    if ('position' in fields && !fields.position && text.length < 80 && /工程师|开发|设计师|经理|研究员|负责人|实习生|\b(?:Engineer|Developer|Designer|Manager|Analyst|Intern|Lead)\b/i.test(text)) { fields.position = text; continue; }
    if ('location' in fields && !fields.location && text.length < 50 && /市$|省$|远程|\b(?:Remote|Shanghai|Beijing|Shenzhen)\b/i.test(text)) { fields.location = text; continue; }
    if ('keywords' in fields && /\S\s*[·•|]\s*\S/.test(text) && text.length < 180 && !/^[•●▪]/.test(text)) { fields.keywords = text.split(/[·•|]/).map(word => word.trim()).filter(Boolean); continue; }
    if ('description' in fields && !fields.description && text.length < 200 && !/^[-•●▪]/.test(text)) { fields.description = text; continue; }
    if (kind === 'profiles' && !fields.username && text.length < 70 && !url) { fields.username = text; continue; }
    remaining.push(line);
  }
  if (richField) fields[richField.key] = appendLines(remaining);
  else if (remaining.length) { const extra = remaining.map(line => line.text).join('\n'); if ('description' in fields) fields.description = [fields.description, extra].filter(Boolean).join('\n'); else fields[primary] = [fields[primary], extra].filter(Boolean).join('\n'); }
  return { id: uid('import-item'), fields };
}
function structuredItems(kind: ItemKind, lines: PdfLine[]): ImportedItem[] {
  const chunks: PdfLine[][] = [[]];
  for (const line of lines) {
    const current = chunks.at(-1)!;
    if (current.length && (labelledRecord(kind, line.text) || current.length > 1 && isItemTitle(kind, line))) chunks.push([line]); else current.push(line);
  }
  return chunks.filter(chunk => chunk.some(line => line.text.trim())).map(chunk => parseItem(kind, chunk));
}
function headerBasics(lines: PdfLine[]): TextCandidate['basics'] {
  const basics = createResume().basics;
  const all = lines.map(line => line.text).join('\n');
  const explicit: [keyof Pick<typeof basics, 'name' | 'headline' | 'email' | 'phone' | 'website' | 'location'>, RegExp][] = [
    ['name', /(?:姓名|全名|Name)\s*[:：]\s*([^\n]+)/i], ['headline', /(?:职位|求职岗位|Position)\s*[:：]\s*([^\n]+)/i], ['location', /(?:地址|位置|城市|Location)\s*[:：]\s*([^\n]+)/i],
  ];
  for (const [key, regex] of explicit) basics[key] = all.match(regex)?.[1]?.trim() ?? '';
  basics.email = all.match(emailPattern)?.[0] ?? '';
  for (const line of lines) for (const span of line.spans) {
    if (span.url?.startsWith('mailto:')) basics.email ||= decodeURIComponent(span.url.slice(7)).split('?')[0];
    if (span.url?.startsWith('tel:')) basics.phone ||= decodeURIComponent(span.url.slice(4));
    if (span.url?.startsWith('http')) basics.website ||= span.url;
  }
  basics.website ||= all.match(urlPattern)?.[0] ?? '';
  if (!basics.phone) {
    const phone = all.match(/(?:电话|手机|Phone|Tel)\s*[:：]?\s*([+\d][\d ()\-]{6,})/i)?.[1] ?? all.match(/(?<![\d.])(?:\+\d{1,3}[ -]?)?(?:1[3-9]\d{9}|\d{3,4}-\d{3,4}-?\d{3,4})(?![\d.])/g)?.find(value => !datePattern.test(value));
    basics.phone = phone?.trim() ?? '';
  }
  const nameLine = [...lines].filter(line => line.text.length <= 70 && !guessSection(line.text) && !urlPattern.test(line.text) && !emailPattern.test(line.text) && !/简历|履历|^CV$|resume/i.test(line.text)).sort((a, b) => b.size - a.size || a.y - b.y)[0];
  if (!basics.name && nameLine) basics.name = nameLine.text;
  if (!basics.headline && nameLine) {
    const headline = lines.find(line => line.y > nameLine.y + nameLine.size * .5 && line.text.length < 100 && !urlPattern.test(line.text) && !emailPattern.test(line.text) && !/^\d/.test(line.text) && !/[:：]/.test(line.text));
    basics.headline = headline?.text ?? '';
  }
  for (const line of lines) {
    const custom = line.text.match(/^([^:：]{2,20})[:：]\s*(.+)$/);
    if (custom && !/姓名|全名|邮箱|电话|手机|网址|网站|地址|位置|职位|Name|Email|Phone|Tel/i.test(custom[1])) basics.customFields.push({ id: uid('basic'), iconId: 'briefcase', label: custom[1], value: custom[2], visible: true });
  }
  if (!basics.location) basics.location = lines.flatMap(line => line.spans).find(span => span.text.trim().length < 30 && /市$|省$|远程|^(?:Beijing|Shanghai|Shenzhen|Remote)$/i.test(span.text.trim()))?.text.trim() ?? '';
  return basics;
}
export function candidateFromPdf(pages: PdfPageText[], title: string): PdfCandidate {
  const all = pages.flatMap(pdfLines);
  const first = all.filter(line => line.page === pages[0]?.number);
  const headingY = first.filter(line => guessSection(line.text)).map(line => line.y);
  const bodyTop = headingY.length ? Math.min(...headingY) : (first[0]?.y ?? 0) + Math.max(first[0]?.size ?? 14, 14) * 4;
  const header = first.filter(line => line.y < bodyTop - 1);
  const body = all.filter(line => line.page !== pages[0]?.number || line.y >= bodyTop - 1);
  const cut = columnCut(body, pages[0]?.width ?? 595);
  let ordered = body;
  if (cut !== null) {
    const left = body.filter(line => line.x < cut), right = body.filter(line => line.x >= cut);
    const weight = (lines: PdfLine[]) => lines.reduce((score, line) => score + (mainWeights[guessSection(line.text) ?? 'custom'] ?? 0), 0);
    const mainLeft = weight(left) !== weight(right) ? weight(left) > weight(right) : left.reduce((n, line) => n + line.text.length, 0) > right.reduce((n, line) => n + line.text.length, 0);
    const order = (lines: PdfLine[]) => lines.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
    ordered = [...order(mainLeft ? left : right), ...order(mainLeft ? right : left)];
  }
  const rawGroups: { heading: string; kind: SectionKind; lines: PdfLine[] }[] = [];
  let group = { heading: '个人总结', kind: 'summary' as SectionKind, lines: [] as PdfLine[] };
  const flush = () => { if (group.lines.length) rawGroups.push(group); };
  for (const line of ordered) {
    const known = guessSection(line.text);
    if (known) { if (known === group.kind && line.text === group.heading && group.lines.length) continue; flush(); group = { heading: line.text, kind: known, lines: [] }; }
    else if (line.text.length < 28 && /经历|活动|成果|作品|情况|信息$/.test(line.text) && line.size >= 12.5) { flush(); group = { heading: line.text, kind: 'custom', lines: [] }; }
    else group.lines.push(line);
  }
  flush();
  const groups: TextGroup[] = rawGroups.map(group => ({ id: uid('import'), heading: group.heading, kind: group.kind, content: appendLines(group.lines), pages: [...new Set(group.lines.map(line => line.page))], ...(group.kind !== 'summary' && group.kind !== 'custom' ? { itemKind: group.kind, items: structuredItems(group.kind, group.lines) } : {}) }));
  const sourceText = [...header, ...ordered].map(line => line.text).join('\n');
  const warnings: PdfWarning[] = [];
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(sourceText) || [...sourceText].some(char => /[\u2f00-\u2fdf]/.test(char))) warnings.push({ kind: 'characters', message: '原 PDF 含有无法正常映射的字符或部首文字，请核对姓名、电话与正文。无法识别的字符保留为校对标记。' });
  if (cut !== null) warnings.push({ kind: 'layout', message: '已按分栏整理读取顺序，请对照原文件核对模块与条目。' });
  return { title, basics: headerBasics(header), groups, sourceText, pageCount: pages.length, columns: cut === null ? 1 : 2, warnings };
}
export function pdfTextSize(candidate: PdfCandidate): number { return candidate.groups.reduce((size, group) => size + richText(group.content).length, 0); }
export function updateImportedField(candidate: TextCandidate, groupId: string, itemId: string, key: string, value: FieldValue): TextCandidate { return { ...candidate, groups: candidate.groups.map(group => group.id !== groupId ? group : { ...group, items: group.items?.map(item => item.id === itemId ? { ...item, fields: { ...item.fields, [key]: value } } : item) }) }; }
