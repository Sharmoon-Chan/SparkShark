import { Font } from '@react-pdf/renderer';
import manifest from '../../public/fonts/manifest.json';
import type { Resume } from '../domain/types';
import { richText } from '../domain/resume';
import { sectionTitle } from '../domain/registry';
import { pdfWordBreaks } from './lineBreaks';
import { moduleContentRows, sectionVisibleWithContent } from './contentLayoutView';

const registered = new Set<string>();
export function registerFonts(base: string) {
  if (registered.has(base)) return;
  const remote = /^https?:/.test(base) || (typeof location !== 'undefined' && base.startsWith('/'));
  for (const item of Object.values(manifest.families)) Font.register({ family: item.family, fonts: item.files.map(file => ({ src: `${base}/${file.file}${remote ? `?v=${file.sha256.slice(0, 16)}` : ''}`, fontWeight: file.weight, fontStyle: file.style as 'normal' | 'italic' })) });
  Font.registerHyphenationCallback(pdfWordBreaks);
  registered.add(base);
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
