import { Buffer } from 'buffer';
import { strFromU8, unzipSync } from 'fflate';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import type { ItemKind, RichDocument, RichMark, RichNode } from '../../domain/types';
import { newItem, plainRich, richText, safeLink, uid, validateRich } from '../../domain/resume';
import { FIELD_SPECS } from '../../domain/registry';
import { primaryKeyFor } from '../../rendering/viewModel';
import { guessSection, parseText, type ImportedItem, type TextCandidate, type TextGroup } from './parsers';

type HtmlNode = DefaultTreeAdapterTypes.ChildNode;
type HtmlElement = DefaultTreeAdapterTypes.Element;
export interface DocxImage { id: string; mime: string; data: Uint8Array }
export interface DocxImportResult { candidate: TextCandidate; sourceText: string; warnings: string[]; images: DocxImage[] }
const maxFileSize = 10 * 1024 * 1024;
const datePattern = /(?:19|20)\d{2}(?:[.\/年\-]\s*\d{1,2}(?:[.\/月\-]\d{1,2}日?)?)?\s*(?:[—–\-~至]|到)\s*(?:(?:19|20)\d{2}(?:[.\/年\-]\s*\d{1,2}(?:[.\/月\-]\d{1,2}日?)?)?|至今|现在|present|current)/i;
const isElement = (node: HtmlNode): node is HtmlElement => 'tagName' in node;
const attribute = (node: HtmlElement, name: string) => node.attrs.find(attr => attr.name === name)?.value ?? '';
const ignored = new Set(['script', 'style', 'iframe', 'object', 'template', 'noscript']);
const inlineTags = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'del', 'strike', 'code', 'mark', 'a', 'span', 'br', 'img']);

function inline(nodes: HtmlNode[], inherited: RichMark[] = [], depth = 0): RichNode[] {
  if (depth > 35) throw new Error('Word 内容层级过深，请简化格式后重试');
  return nodes.flatMap(node => {
    if ('value' in node) return node.value ? [{ type: 'text' as const, text: node.value, ...(inherited.length ? { marks: inherited } : {}) }] : [];
    if (!isElement(node) || ignored.has(node.tagName)) return [];
    if (node.tagName === 'br') return [{ type: 'hardBreak' as const }];
    if (node.tagName === 'img') return [{ type: 'text' as const, text: `[图片：${attribute(node, 'alt') || '文档图片'}]` }];
    const marks: Record<string, RichMark['type']> = { strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline', s: 'strike', del: 'strike', strike: 'strike', code: 'code', mark: 'highlight' };
    const type = marks[node.tagName];
    let next = inherited;
    if (type && type !== 'link' && !inherited.some(mark => mark.type === type)) next = [...inherited, { type }];
    if (node.tagName === 'a') {
      const href = safeLink(attribute(node, 'href'));
      if (href) next = [...inherited.filter(mark => mark.type !== 'link'), { type: 'link', attrs: { href } }];
    }
    return inline(node.childNodes, next, depth + 1);
  });
}

function textInline(nodes: RichNode[]): RichNode[] {
  const result: RichNode[] = [];
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'hardBreak') result.push(node);
    else {
      if (result.length && result.at(-1)?.type !== 'hardBreak') result.push({ type: 'hardBreak' });
      result.push(...textInline(node.content ?? []));
    }
  }
  return result;
}

function blocks(nodes: HtmlNode[], warnings: Set<string>, depth = 0): RichNode[] {
  if (depth > 35) throw new Error('Word 内容层级过深，请简化格式后重试');
  const result: RichNode[] = [];
  let pending: HtmlNode[] = [];
  const flush = () => {
    const content = inline(pending); pending = [];
    if (content.some(node => node.type === 'hardBreak' || node.text?.trim())) result.push({ type: 'paragraph', content });
  };
  for (const node of nodes) {
    if ('value' in node || isElement(node) && inlineTags.has(node.tagName)) { pending.push(node); continue; }
    flush();
    if (!isElement(node) || ignored.has(node.tagName)) continue;
    if (node.tagName === 'p' || /^h[1-6]$/.test(node.tagName)) {
      const content = inline(node.childNodes);
      result.push(node.tagName === 'p' ? { type: 'paragraph', content } : { type: 'heading', attrs: { level: Math.min(3, Number(node.tagName[1])) as 1 | 2 | 3 }, content });
    } else if (node.tagName === 'ul' || node.tagName === 'ol') {
      const items = node.childNodes.filter(isElement).filter(child => child.tagName === 'li').map(child => ({ type: 'listItem' as const, content: blocks(child.childNodes, warnings, depth + 1) }));
      const start = Number(attribute(node, 'start'));
      result.push({ type: node.tagName === 'ol' ? 'orderedList' : 'bulletList', ...(node.tagName === 'ol' && Number.isInteger(start) && start > 0 ? { attrs: { start } } : {}), content: items });
    } else if (node.tagName === 'pre') {
      result.push({ type: 'codeBlock', content: [{ type: 'text', text: richText({ type: 'paragraph', content: inline(node.childNodes) }) }] });
    } else if (node.tagName === 'table') {
      warnings.add('表格已按行转为可编辑文字，请核对单元格的阅读顺序。');
      const rows = (children: HtmlNode[]): HtmlElement[] => children.filter(isElement).flatMap(child => child.tagName === 'tr' ? [child] : rows(child.childNodes));
      for (const row of rows(node.childNodes)) {
        const cells = row.childNodes.filter(isElement).filter(child => child.tagName === 'td' || child.tagName === 'th');
        const content = cells.flatMap((cell, index) => [...(index ? [{ type: 'text' as const, text: ' · ' }] : []), ...textInline(blocks(cell.childNodes, warnings, depth + 1))]);
        if (content.length) result.push({ type: 'paragraph', content });
      }
    } else result.push(...blocks(node.childNodes, warnings, depth + 1));
  }
  flush();
  return result;
}

function linksIn(node: RichNode): string[] {
  return [...(node.marks ?? []).flatMap(mark => mark.type === 'link' ? [mark.attrs.href] : []), ...(node.content ?? []).flatMap(linksIn)];
}

function importedItems(kind: ItemKind, content: RichNode[]): ImportedItem[] {
  const chunks: RichNode[][] = [];
  const primary = primaryKeyFor(kind), primaryLabel = FIELD_SPECS[kind].find(spec => spec.key === primary)!.label;
  const headingLevels = content.filter(node => node.type === 'heading').map(node => node.attrs?.level ?? 1);
  const recordLevel = headingLevels.length ? Math.min(...headingLevels) : null;
  const boldPrimary = (node: RichNode) => {
    if (node.type !== 'paragraph') return false;
    const text = richText(node).trim(), words = (node.content ?? []).filter(child => child.type === 'text' && child.text?.trim());
    if (!text || text.length > 100 || /[:：]/.test(text) || datePattern.test(text) || !words.length || !words.every(word => word.marks?.some(mark => mark.type === 'bold'))) return false;
    return kind === 'work' || kind === 'internships' ? /公司$|集团$|工作室$|\b(?:Inc\.?|Ltd\.?|Company|Corporation|Studio)$/i.test(text)
      : kind === 'education' && /大学$|学院$|学校$|\b(?:University|College|Institute|School)$/i.test(text);
  };
  for (const node of content) {
    const current = chunks.at(-1);
    const startsPrimary = (block: RichNode) => richText(block).trim().match(/^([^:：\n]+)\s*[:：]/)?.[1].trim() === primaryLabel;
    const repeatedPrimary = current && startsPrimary(node) && current.some(startsPrimary);
    const headingPrimary = node.type === 'heading' && (node.attrs?.level ?? 1) === recordLevel;
    if (!current || (headingPrimary || repeatedPrimary || boldPrimary(node) && current.length > 1) && current.some(block => richText(block).trim())) chunks.push([node]);
    else current.push(node);
  }
  return chunks.filter(chunk => chunk.some(node => richText(node).trim())).map(chunk => {
    const fields = newItem(kind).fields, primary = primaryKeyFor(kind), specs = FIELD_SPECS[kind];
    const remaining: RichNode[] = [];
    for (const node of chunk) {
      const text = richText(node).trim(); if (!text) continue;
      const labelled = text.match(/^([^:：\n]{1,20})\s*[:：]\s*([\s\S]+)$/);
      const explicit = labelled ? specs.find(spec => spec.label === labelled[1].trim()) : undefined;
      if (explicit && !['rich', 'level'].includes(explicit.type)) {
        const value = labelled![2].trim();
        if (explicit.type === 'tags') fields[explicit.key] = [...(Array.isArray(fields[explicit.key]) ? fields[explicit.key] as string[] : []), ...value.split(/[,，、·]/).map(value => value.trim()).filter(Boolean)];
        else fields[explicit.key] = [fields[explicit.key], value].filter(Boolean).join('\n');
        continue;
      }
      if (node.type === 'paragraph' || node.type === 'heading') {
        const date = text.match(datePattern)?.[0];
        if (date && 'dateText' in fields && !fields.dateText) { fields.dateText = date; if (text === date) continue; }
        const href = linksIn(node).find(href => /^https?:/.test(href)) ?? text.match(/https?:\/\/[^\s<>()，。]+/)?.[0];
        const urlKey = 'officialUrl' in fields ? 'officialUrl' : 'url' in fields ? 'url' : null;
        if (href && urlKey && !fields[urlKey]) { fields[urlKey] = href; if (text === href) continue; }
        if (!fields[primary] && text.length < 120 && !datePattern.test(text) && !/^\[图片：/.test(text)) { fields[primary] = text; continue; }
        if ('position' in fields && !fields.position && text.length < 80 && /工程师|开发|设计师|经理|研究员|负责人|实习生|\b(?:Engineer|Developer|Designer|Manager|Analyst|Intern|Lead)\b/i.test(text)) { fields.position = text; continue; }
        if ('studyType' in fields && !fields.studyType && /^(?:本科|学士|硕士|博士|大专|研究生|Bachelor.*|Master.*|Ph\.?D\.?)$/i.test(text)) { fields.studyType = text; continue; }
      }
      remaining.push(node);
    }
    const richField = specs.find(spec => spec.type === 'rich');
    if (richField) fields[richField.key] = { type: 'doc', content: remaining };
    else if (remaining.length) {
      const extra = richText({ type: 'doc', content: remaining });
      const key = 'description' in fields ? 'description' : primary;
      fields[key] = [fields[key], extra].filter(Boolean).join('\n');
    }
    return { id: uid('import-item'), fields };
  });
}

export function candidateFromDocxHtml(html: string, title = '导入的简历', auxiliary: { before: RichNode[]; after: RichNode[] } = { before: [], after: [] }): Omit<DocxImportResult, 'images'> {
  const warnings = new Set<string>(), content = [...auxiliary.before, ...blocks(parseFragment(html).childNodes, warnings), ...auxiliary.after];
  const document: RichDocument = { type: 'doc', content }; validateRich(document);
  const sourceText = richText(document);
  if (!sourceText.replace(/\[图片：[^\]]*\]/g, '').trim()) throw new Error('Word 中没有读取到可编辑文字，请使用包含文字内容的 DOCX 文件');
  if (new TextEncoder().encode(sourceText).length > 1024 * 1024) throw new Error('Word 提取文字超过 1 MB，请精简文档后重试');
  const bodyIndex = content.findIndex(node => guessSection(richText(node).trim()));
  const header = bodyIndex < 0 ? content.slice(0, 6) : content.slice(0, bodyIndex);
  const headerText = richText({ type: 'doc', content: header });
  const basics = parseText(headerText || sourceText, title).basics;
  const nameNode = header.find(node => node.type === 'heading' && richText(node).trim().length < 70 && !/简历|履历|^CV$|resume|[:：@]/i.test(richText(node)));
  if (!basics.name && nameNode) basics.name = richText(nameNode).trim();
  basics.email ||= headerText.match(/[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
  basics.phone ||= headerText.match(/(?<![\d.])(?:\+\d{1,3}[ -]?)?(?:1[3-9]\d{9}|\d{3,4}-\d{3,4}-?\d{3,4})(?![\d.])/)?.[0] ?? '';
  for (const href of header.flatMap(linksIn)) {
    if (/^mailto:/i.test(href)) basics.email ||= href.slice(7).split('?')[0];
    if (/^tel:/i.test(href)) basics.phone ||= href.slice(4);
    if (/^https?:/i.test(href)) basics.website ||= href;
  }
  basics.website ||= headerText.match(/https?:\/\/[^\s<>()，。]+/)?.[0] ?? '';
  if (!basics.headline) basics.headline = header.map(node => richText(node).trim()).find(text => text !== basics.name && text.length < 80 && !/[:：@]/.test(text) && /工程师|开发|设计师|经理|研究员|\b(?:Engineer|Developer|Designer|Manager|Analyst)\b/i.test(text)) ?? '';
  const movedToBasics = (node: RichNode) => {
    const text = richText(node).trim();
    return Object.entries(basics).some(([key, value]) => ['name', 'headline', 'email', 'phone', 'website', 'location'].includes(key) && typeof value === 'string' && value && (text === value || text.match(/^[^:：\n]{1,20}\s*[:：]\s*([\s\S]+)$/)?.[1].trim() === value));
  };
  const groups: TextGroup[] = [];
  let group: TextGroup = { id: uid('import'), heading: '个人总结', kind: 'summary', content: { type: 'doc', content: [] } };
  let sectionLevel = 1, started = false;
  const flush = () => {
    if (!group.content.content?.some(node => richText(node).trim())) return;
    const previous = groups.at(-1);
    if (group.kind === 'summary' && previous?.kind === 'summary' && previous.heading === group.heading) previous.content.content!.push(...group.content.content);
    else groups.push(group);
  };
  for (let index = 0; index < content.length; index++) {
    const node = content[index], text = richText(node).trim(), known = guessSection(text);
    if ((bodyIndex < 0 || index < bodyIndex) && movedToBasics(node)) continue;
    const unknownHeading = node.type === 'heading' && (!started || (node.attrs?.level ?? 1) <= sectionLevel);
    if (known && (node.type === 'heading' || text.length < 35) || unknownHeading) {
      flush(); group = { id: uid('import'), heading: text, kind: known ?? 'custom', content: { type: 'doc', content: [] } };
      sectionLevel = node.attrs?.level ?? 1; started = true;
    } else group.content.content!.push(node);
  }
  flush();
  for (const item of groups) if (item.kind !== 'summary' && item.kind !== 'custom') {
    item.itemKind = item.kind; item.items = importedItems(item.kind, item.content.content ?? []);
  }
  return { candidate: { title, basics, groups }, sourceText, warnings: [...warnings] };
}

function xmlElements(nodes: HtmlNode[]): HtmlElement[] {
  const output: HtmlElement[] = [], pending = [...nodes].reverse();
  while (pending.length) {
    const node = pending.pop()!;
    if (!isElement(node)) continue;
    output.push(node); pending.push(...[...node.childNodes].reverse());
  }
  return output;
}

function auxiliaryParagraphs(data: Uint8Array): RichNode[] {
  const elements = xmlElements(parseFragment(strFromU8(data)).childNodes);
  return elements.filter(node => node.tagName.endsWith(':p')).flatMap(paragraph => {
    let ancestor = paragraph.parentNode;
    while (ancestor && 'tagName' in ancestor) { if (ancestor.tagName.endsWith(':p')) return []; ancestor = ancestor.parentNode; }
    const text = xmlElements(paragraph.childNodes).map(node => node.tagName.endsWith(':t') ? richText({ type: 'paragraph', content: inline(node.childNodes) }) : node.tagName.endsWith(':br') ? '\n' : node.tagName.endsWith(':tab') ? '\t' : '').join('');
    return text.trim() ? plainRich(text).content ?? [] : [];
  });
}

function checkDocxArchive(bytes: Uint8Array): { before: RichNode[]; after: RichNode[]; warnings: string[] } {
  let count = 0, expanded = 0;
  const files = unzipSync(bytes, { filter: file => {
    if (++count > 2048 || (expanded += file.originalSize) > 32 * 1024 * 1024) throw new Error('Word 文件展开后过大，请精简文档或压缩图片后重试');
    return file.name === '[Content_Types].xml' || file.name === 'word/document.xml' || file.name === 'word/_rels/document.xml.rels' || /^word\/(?:header|footer)[^/]*\.xml$/.test(file.name);
  } });
  if (!files['word/document.xml'] || !files['[Content_Types].xml'] || !strFromU8(files['[Content_Types].xml']).includes('wordprocessingml.document.main+xml')) throw new Error('文件不是有效的 Word DOCX 文档');
  const before: RichNode[] = [], after: RichNode[] = [], warnings: string[] = [], used = new Set<string>();
  const references = xmlElements(parseFragment(strFromU8(files['word/document.xml'])).childNodes).filter(node => /:(?:header|footer)reference$/.test(node.tagName));
  const relationships = files['word/_rels/document.xml.rels'] ? xmlElements(parseFragment(strFromU8(files['word/_rels/document.xml.rels'])).childNodes) : [];
  for (const reference of references) {
    const relation = relationships.find(node => attribute(node, 'id') === attribute(reference, 'r:id'));
    const path = relation && attribute(relation, 'targetmode').toLowerCase() !== 'external' ? new URL(attribute(relation, 'target'), 'https://docx.invalid/word/').pathname.slice(1) : '';
    if (used.has(path)) continue;
    used.add(path);
    if (!files[path]) { warnings.push('部分页眉页脚无法读取，请对照原文核对。'); continue; }
    const content = auxiliaryParagraphs(files[path]);
    if (reference.tagName.endsWith(':headerreference')) before.push(...content);
    else after.push(...content);
  }
  if (before.length || after.length) warnings.push('页眉页脚文字已保留为可编辑内容，请核对其模块与位置。');
  if (after.length) after.unshift({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '页脚信息' }] });
  return { before, after, warnings };
}

export async function readDocxResume(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>, options: { signal?: AbortSignal } = {}): Promise<DocxImportResult> {
  const check = () => { if (options.signal?.aborted) throw new DOMException('读取已取消', 'AbortError'); };
  if (file.size > maxFileSize) throw new Error('Word 文件需要小于 10 MB');
  check();
  const bytes = new Uint8Array(await file.arrayBuffer()); check();
  let auxiliary;
  try { auxiliary = checkDocxArchive(bytes); } catch (error) {
    if (error instanceof Error && /Word|DOCX/.test(error.message)) throw error;
    throw new Error('Word 文件损坏或需要密码，请另存为未加密的 DOCX 后重试');
  }
  const { default: mammoth } = await import('mammoth'); check();
  const images: DocxImage[] = [], warnings = new Set<string>();
  let converted;
  try {
    converted = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer, buffer: Buffer.from(bytes) }, {
      externalFileAccess: false, includeEmbeddedStyleMap: false,
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='标题'] => h1:fresh", 'u => u', 'strike => s'],
      convertImage: mammoth.images.imgElement(async image => {
        check();
        const id = uid('docx-image');
        if (images.length < 8 && ['image/png', 'image/jpeg', 'image/webp'].includes(image.contentType)) {
          try {
            const data = new Uint8Array(await image.readAsArrayBuffer()); check();
            if (data.length <= 5 * 1024 * 1024) images.push({ id, mime: image.contentType, data });
            else warnings.add('有图片超过 5 MB，其说明文字已保留，可在导入后另行上传头像。');
          } catch (error) { check(); warnings.add('有图片无法读取，其说明文字已保留。'); }
        } else warnings.add('部分图片无法用作头像，其说明文字已保留。');
        return { src: 'myresume-image:' + id };
      }),
    });
  } catch { check(); throw new Error('无法读取 Word 内容，请在 Word 中另存为 DOCX 后重试'); }
  check();
  const parsed = candidateFromDocxHtml(converted.value, file.name.replace(/\.[^.]+$/, '').slice(0, 200), auxiliary);
  if (converted.messages.length) warnings.add('文档有部分格式无法直接还原，请对照提取文字核对内容。');
  return { ...parsed, images, warnings: [...new Set([...parsed.warnings, ...auxiliary.warnings, ...warnings])] };
}
