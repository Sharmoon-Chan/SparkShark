import type { Basics, ItemKind, Resume, ResumeItem, Section } from '../domain/types';
import { FIELD_SPECS } from '../domain/registry';
import { hasContent, safeLink } from '../domain/resume';
import { sectionVisibleWithContent } from './contentLayoutView';

export type ContactIcon = 'location' | 'phone' | 'mail' | 'globe';
export interface ContactView { value: string; href?: string; icon: ContactIcon }
export interface PageGroupView { id: string; main: Section[]; sidebar: Section[] }

const primaryKeys: Partial<Record<ItemKind, string>> = {
  education: 'institution', work: 'company', internships: 'company',
  awards: 'title', volunteer: 'organization', profiles: 'network',
};
export function primaryKeyFor(kind: ItemKind): string { return primaryKeys[kind] ?? 'name'; }

export function basicsView(basics: Basics) {
  const contacts: ContactView[] = [
    { value: basics.location, icon: 'location' },
    { value: basics.phone, href: safeLink(`tel:${basics.phone}`) ?? undefined, icon: 'phone' },
    { value: basics.email, href: safeLink(`mailto:${basics.email}`) ?? undefined, icon: 'mail' },
    { value: basics.website, href: safeLink(basics.website) ?? undefined, icon: 'globe' },
  ];
  return {
    contacts: contacts.filter(contact => contact.value.trim()),
    customFields: basics.customFields.filter(field => field.visible && (field.label.trim() || field.value.trim())),
  };
}

export function inlineBasicsView(basics: Basics) {
  const { contacts, customFields } = basicsView(basics);
  const contact = (value: ContactView) => ({ value: value.value, text: value.value, href: value.href });
  return [...contacts.filter(value => value.icon !== 'globe').map(contact),
    ...customFields.map(field => ({ value: field.value, text: field.label ? `${field.label}：${field.value}` : field.value, href: undefined })),
    ...contacts.filter(value => value.icon === 'globe').map(contact)];
}

export function visiblePageGroups(resume: Resume): PageGroupView[] {
  const visible = new Map(resume.sections.filter(sectionVisibleWithContent).map(section => [section.id, section]));
  const sections = (ids: string[]) => ids.map(id => visible.get(id)).filter((section): section is Section => Boolean(section));
  return resume.layout.groups.map(group => ({ id: group.id, main: sections(group.main), sidebar: sections(group.sidebar) }))
    .filter(group => group.main.length || group.sidebar.length);
}

export function itemView(kind: ItemKind, item: ResumeItem) {
  const fields = item.fields, primaryKey = primaryKeyFor(kind);
  const primary = typeof fields[primaryKey] === 'string' ? fields[primaryKey] as string : '';
  return {
    primary,
    details: FIELD_SPECS[kind]
      .filter(field => ![primaryKey, 'summary', 'keywords', 'level', 'url', 'officialUrl', 'iconId'].includes(field.key) && hasContent(fields[field.key]))
      .map(field => ({ key: field.key, value: String(fields[field.key]) })),
    links: ['url', 'officialUrl'].flatMap(key => typeof fields[key] === 'string' && fields[key]
      ? [{ key, value: fields[key] as string, href: safeLink(fields[key] as string) }] : []),
    keywords: Array.isArray(fields.keywords) ? fields.keywords : [],
    level: typeof fields.level === 'number' ? fields.level : null,
    summary: fields.summary && typeof fields.summary === 'object' && !Array.isArray(fields.summary) ? fields.summary : null,
  };
}

export function compactItemView(kind: ItemKind, item: ResumeItem) {
  const view = itemView(kind, item);
  return { ...view,
    date: view.details.find(field => field.key === 'dateText')?.value ?? '',
    caption: [...view.details.filter(field => field.key !== 'dateText').map(field => field.value),
      ...(view.keywords.length ? [view.keywords.join(' · ')] : [])].join(' · '),
  };
}
