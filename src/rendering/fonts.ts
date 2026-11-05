import { Font } from '@react-pdf/renderer';
import manifest from '../../public/fonts/manifest.json';
import type { Resume, RichNode } from '../domain/types';
import { richText } from '../domain/resume';
import { sectionTitle } from '../domain/registry';
import { pdfWordBreaks } from './lineBreaks';
import { moduleContentRows, sectionVisibleWithContent } from './contentLayoutView';
import { readCompressedFont } from './fontDelivery';

const registered = new Set<string>();
const preparedFaces = new Map<string, Promise<void>>();
const remoteBase = (base: string) => /^https?:/.test(base) || (typeof location !== 'undefined' && base.startsWith('/'));
export function registerFonts(base: string) {
  if (registered.has(base)) return;
  const remote = remoteBase(base);
  for (const item of Object.values(manifest.families)) Font.register({ family: item.family, fonts: item.files.map(file => ({ src: `${base}/${file.file}${remote ? `?v=${file.sha256.slice(0, 16)}` : ''}`, fontWeight: file.weight, fontStyle: file.style as 'normal' | 'italic' })) });
  Font.registerHyphenationCallback(pdfWordBreaks);
  registered.add(base);
}

function italicNode(node: RichNode): boolean {
  return Boolean(node.marks?.some(mark => mark.type === 'italic') || node.content?.some(italicNode));
}

export function needsItalicFonts(resume: Resume): boolean {
  return resume.sections.filter(sectionVisibleWithContent).some(section => {
    if (section.contentLayout) {
      const rows = section.kind === 'summary' ? moduleContentRows(section) : section.items.filter(item => item.visible).flatMap(item => moduleContentRows(section, item));
      return rows.some(row => row.some(cell => cell.layout.italic || (cell.rich && italicNode(cell.rich))));
    }
    if (section.kind === 'summary') return italicNode(section.content);
    return section.items.filter(item => item.visible).some(item => Object.values('fields' in item ? item.fields : item.values).some(value => value && typeof value === 'object' && !Array.isArray(value) && italicNode(value)));
  });
}

// Compressed delivery is decoded once into the original static TTF. Passing WOFF
// directly to fontkit repeatedly decompresses CJK glyph tables during layout.
export async function prepareFonts(resume: Resume, base: string, signal?: AbortSignal): Promise<void> {
  if (!remoteBase(base) || registered.has(base)) { registerFonts(base); return; }
  const family = manifest.families[resume.appearance.fontFamilyId as keyof typeof manifest.families] ?? manifest.families['noto-sans-sc'];
  const italic = needsItalicFonts(resume);
  Font.registerHyphenationCallback(pdfWordBreaks);
  const results = await Promise.allSettled(family.files.filter(file => file.style === 'normal' || italic).map(file => {
    const key = `${base}:${file.sha256}`;
    const existing = preparedFaces.get(key);
    if (existing) return existing;
    const pending = (async () => {
      const blob = await readCompressedFont(base, file, signal);
      if (signal?.aborted) throw new DOMException('字体加载已取消', 'AbortError');
      const src = URL.createObjectURL(blob);
      const descriptor = { fontFamily: family.family, fontWeight: file.weight, fontStyle: file.style as 'normal' | 'italic' };
      try {
        Font.register({ family: family.family, src, fontWeight: file.weight, fontStyle: descriptor.fontStyle });
        // Load before revoking the Blob URL. All subsequent renders reuse the
        // parsed TTF held by FontStore and retain no extra Blob payload.
        await Font.load(descriptor);
      } finally { URL.revokeObjectURL(src); }
    })();
    preparedFaces.set(key, pending);
    void pending.catch(() => { if (preparedFaces.get(key) === pending) preparedFaces.delete(key); });
    return pending;
  }));
  if (signal?.aborted) throw new DOMException('字体加载已取消', 'AbortError');
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
export function fontFamily(id: string): string { return (manifest.families[id as keyof typeof manifest.families] ?? manifest.families['noto-sans-sc']).family; }
export function checkGlyphs(resume: Resume): void {
  const family = manifest.families[resume.appearance.fontFamilyId as keyof typeof manifest.families] ?? manifest.families['noto-sans-sc'];
  const fields: [string, string][] = Object.entries(resume.basics).filter(([, value]) => typeof value === 'string').map(([key, value]) => [`基本信息.${key}`, value as string]);
  fields.push(...resume.basics.customFields.filter(field => field.visible).map(field => [field.label, `${field.label} ${field.value}`] as [string, string]));
  for (const section of resume.sections.filter(sectionVisibleWithContent)) {
    const title = sectionTitle(section, resume.locale); fields.push([title, title]);
    if (section.contentLayout) {
      const entries = section.kind === 'summary' ? [moduleContentRows(section)] : section.items.filter(item => item.visible).map(item => moduleContentRows(section, item));
      for (const rows of entries) for (const row of rows) for (const cell of row) fields.push([`${title}.${cell.spec.label}`, cell.text]);
      continue;
    }
    if (section.kind === 'summary') fields.push([title, richText(section.content)]);
    else for (const item of section.items.filter(item => item.visible)) for (const [key, value] of Object.entries('fields' in item ? item.fields : item.values)) {
      if (value && typeof value !== 'number') fields.push([`${title}.${key}`, typeof value === 'string' ? value : Array.isArray(value) ? value.join(' ') : richText(value)]);
    }
  }
  for (const [field, text] of fields) for (const char of text) {
    const point = char.codePointAt(0)!;
    if ([9, 10, 13].includes(point)) continue;
    if (!family.coverage.some(([start, end]) => point >= start && point <= end)) throw new Error(`${field} 中的「${char}」缺少可用字形，请调整文字或字体。`);
  }
}
