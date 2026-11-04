import type { Resume } from '../domain/types';
import { richText } from '../domain/resume';
import { FIELD_SPECS, sectionTitle } from '../domain/registry';
import { moduleContentRows, sectionVisibleWithContent } from './contentLayoutView';

const marker = '\uFFFD';
export function importMarkerFields(resume: Resume): string[] {
  const fields: string[] = [];
  const contains = (value: unknown): boolean => typeof value === 'string' ? value.includes(marker)
    : Array.isArray(value) ? value.some(contains) : value && typeof value === 'object' ? richText(value as Parameters<typeof richText>[0]).includes(marker) : false;
  const basicLabels: Record<string, string> = { name: '全名', headline: '职位', email: '邮箱', phone: '电话', website: '个人主页', location: '位置' };
  for (const [key, label] of Object.entries(basicLabels)) if (contains(resume.basics[key as keyof typeof resume.basics])) fields.push(`基本信息 · ${label}`);
  for (const field of resume.basics.customFields.filter(field => field.visible)) if (contains(field.label) || contains(field.value)) fields.push(`基本信息 · ${field.label}`);
  for (const section of resume.sections.filter(sectionVisibleWithContent)) {
    const title = sectionTitle(section, resume.locale);
    if (contains(title)) fields.push('模块标题');
    if (section.contentLayout) {
      const entries = section.kind === 'summary' ? [moduleContentRows(section)] : section.items.filter(item => item.visible).map(item => moduleContentRows(section, item));
      entries.forEach((rows, index) => { for (const row of rows) for (const cell of row) if (contains(cell.text)) fields.push(`${title} · 第 ${index + 1} 条 · ${cell.spec.label}`); });
      continue;
    }
    if (section.kind === 'summary') { if (contains(section.content)) fields.push(`${title} · 正文`); continue; }
    section.items.filter(item => item.visible).forEach((item, index) => {
      const specs = section.kind === 'custom' ? section.fieldDefinitions.filter(field => field.visible).map(field => ({ key: field.id, label: field.label })) : FIELD_SPECS[section.kind];
      const values = 'fields' in item ? item.fields : item.values;
      for (const spec of specs) if (contains(values[spec.key])) fields.push(`${title} · 第 ${index + 1} 条 · ${spec.label}`);
    });
  }
  return fields;
}

/** Render explicit unknown-character markers without changing saved content. */
export function preparePdfImportMarkers(input: Resume): { resume: Resume; blockedLinks: ReadonlySet<string> } {
  const blockedLinks = new Set<string>();
  const copy = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (!value.includes(marker)) return value;
      const rendered = value.replaceAll(marker, '?');
      blockedLinks.add(rendered);
      return rendered;
    }
    if (Array.isArray(value)) return value.map(copy);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, value]) => [key, copy(value)]));
    return value;
  };
  return { resume: copy(input) as Resume, blockedLinks };
}
