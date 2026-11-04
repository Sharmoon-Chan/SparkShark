import type { Appearance, CustomFieldType, ItemKind, Locale, Section, SectionKind } from './types';

export type FieldType = 'text' | 'url' | 'rich' | 'tags' | 'level' | 'textarea';
export interface FieldSpec { key: string; label: string; type: FieldType; placeholder?: string }
const text = (key: string, label: string, placeholder?: string): FieldSpec => ({ key, label, type: 'text', placeholder });
const url = (key = 'url', label = '网址'): FieldSpec => ({ key, label, type: 'url', placeholder: 'https://example.com' });
const rich: FieldSpec = { key: 'summary', label: '详情', type: 'rich' };
const date = text('dateText', '日期', '例如：2024.09—至今');
const place = text('location', '地点');
export const FIELD_SPECS: Record<ItemKind, FieldSpec[]> = {
  profiles: [text('network', '平台', '例如：GitHub'), text('username', '用户名'), text('iconId', '图标', 'github'), url()],
  education: [text('institution', '学校'), text('major', '专业'), text('studyType', '学历'), date, text('score', '成绩'), url('officialUrl', '学校官网'), rich],
  work: [text('company', '公司'), text('position', '职位'), date, place, url(), rich],
  projects: [text('name', '项目名称'), { key: 'description', label: '项目简介', type: 'textarea' }, date, url(), { key: 'keywords', label: '关键词', type: 'tags' }, rich],
  internships: [text('company', '公司'), text('position', '职位'), date, place, rich],
  skills: [text('name', '技能名称'), text('description', '说明'), { key: 'level', label: '熟练程度', type: 'level' }, { key: 'keywords', label: '关键词', type: 'tags' }],
  languages: [text('name', '语言'), text('description', '说明'), { key: 'level', label: '熟练程度', type: 'level' }],
  awards: [text('title', '奖项名称'), text('awarder', '颁发机构'), date, url(), rich],
  certifications: [text('name', '证书名称'), text('issuer', '颁发机构'), date, url(), rich],
  interests: [text('name', '兴趣'), { key: 'keywords', label: '关键词', type: 'tags' }],
  publications: [text('name', '出版物名称'), text('publisher', '出版机构'), date, url(), rich],
  volunteer: [text('organization', '组织'), text('position', '角色'), date, place, url(), rich],
  references: [text('name', '姓名'), text('description', '说明'), url(), rich],
};
export const ITEM_KINDS = Object.keys(FIELD_SPECS) as ItemKind[];
export const SECTION_ORDER: Exclude<SectionKind, 'custom'>[] = ['summary', 'profiles', 'education', 'work', 'projects', 'internships', 'skills', 'languages', 'awards', 'certifications', 'interests', 'publications', 'volunteer', 'references'];
const titleKeys = ['summary', 'profiles', 'education', 'work', 'projects', 'internships', 'skills', 'languages', 'awards', 'certifications', 'interests', 'publications', 'volunteer', 'references'] as const;
const titleRows: Record<Locale, string[]> = {
  'zh-CN': ['个人总结', '个人档案', '教育背景', '工作经历', '项目经历', '实习经历', '技能', '语言', '奖项', '证书', '兴趣', '刊物出版', '志愿经历', '推荐人'],
  'zh-TW': ['個人總結', '個人檔案', '教育背景', '工作經歷', '專案經歷', '實習經歷', '技能', '語言', '獎項', '證書', '興趣', '刊物出版', '志工經歷', '推薦人'],
  en: ['Summary', 'Profiles', 'Education', 'Experience', 'Projects', 'Internships', 'Skills', 'Languages', 'Awards', 'Certifications', 'Interests', 'Publications', 'Volunteering', 'References'],
  fr: ['Profil', 'Liens', 'Formation', 'Expérience professionnelle', 'Projets', 'Stages', 'Compétences', 'Langues', 'Distinctions', 'Certifications', 'Centres d’intérêt', 'Publications', 'Bénévolat', 'Références'],
  ja: ['自己紹介', 'プロフィール', '学歴', '職歴', 'プロジェクト', 'インターン', 'スキル', '言語', '受賞歴', '資格', '趣味', '出版物', 'ボランティア', '推薦者'],
  de: ['Profil', 'Profile', 'Ausbildung', 'Berufserfahrung', 'Projekte', 'Praktika', 'Kenntnisse', 'Sprachen', 'Auszeichnungen', 'Zertifikate', 'Interessen', 'Publikationen', 'Ehrenamt', 'Referenzen'],
  es: ['Perfil', 'Enlaces', 'Educación', 'Experiencia', 'Proyectos', 'Prácticas', 'Habilidades', 'Idiomas', 'Premios', 'Certificaciones', 'Intereses', 'Publicaciones', 'Voluntariado', 'Referencias'],
  pt: ['Resumo', 'Perfis', 'Educação', 'Experiência', 'Projetos', 'Estágios', 'Competências', 'Idiomas', 'Prêmios', 'Certificações', 'Interesses', 'Publicações', 'Voluntariado', 'Referências'],
  it: ['Profilo', 'Profili', 'Formazione', 'Esperienza', 'Progetti', 'Tirocini', 'Competenze', 'Lingue', 'Premi', 'Certificazioni', 'Interessi', 'Pubblicazioni', 'Volontariato', 'Referenze'],
  id: ['Ringkasan', 'Profil', 'Pendidikan', 'Pengalaman', 'Proyek', 'Magang', 'Keahlian', 'Bahasa', 'Penghargaan', 'Sertifikasi', 'Minat', 'Publikasi', 'Relawan', 'Referensi'],
  ms: ['Ringkasan', 'Profil', 'Pendidikan', 'Pengalaman', 'Projek', 'Latihan industri', 'Kemahiran', 'Bahasa', 'Anugerah', 'Pensijilan', 'Minat', 'Penerbitan', 'Sukarelawan', 'Rujukan'],
  vi: ['Giới thiệu', 'Hồ sơ', 'Học vấn', 'Kinh nghiệm', 'Dự án', 'Thực tập', 'Kỹ năng', 'Ngôn ngữ', 'Giải thưởng', 'Chứng chỉ', 'Sở thích', 'Ấn phẩm', 'Tình nguyện', 'Người tham chiếu'],
};
export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'zh-CN', label: '简体中文' }, { value: 'zh-TW', label: '繁體中文' }, { value: 'en', label: 'English' }, { value: 'fr', label: 'Français' }, { value: 'ja', label: '日本語' }, { value: 'de', label: 'Deutsch' }, { value: 'es', label: 'Español' }, { value: 'pt', label: 'Português' }, { value: 'it', label: 'Italiano' }, { value: 'id', label: 'Bahasa Indonesia' }, { value: 'ms', label: 'Bahasa Melayu' }, { value: 'vi', label: 'Tiếng Việt' },
];
export function sectionTitle(section: Section, locale: Locale = 'zh-CN'): string {
  if (section.titleOverride !== null) return section.titleOverride;
  if (section.kind === 'custom') return '自定义模块';
  return titleRows[locale][titleKeys.indexOf(section.kind)];
}
export const CUSTOM_FIELD_TYPES: { value: CustomFieldType; label: string; editor: FieldType }[] = [
  { value: 'name', label: '名称', editor: 'text' }, { value: 'description', label: '描述', editor: 'textarea' }, { value: 'date', label: '日期', editor: 'text' }, { value: 'location', label: '地点', editor: 'text' }, { value: 'url', label: '网址', editor: 'url' }, { value: 'keywords', label: '关键词', editor: 'tags' }, { value: 'summary', label: '详情', editor: 'rich' },
];
export { TEMPLATES, templateFor } from './templates';
export const DEFAULT_APPEARANCE: Appearance = {
  templateId: 'split', themeColor: '#0F766E', fontFamilyId: 'noto-sans-sc', fontSizePx: 14,
  lineHeight: 1.5, spacingScale: 1, marginPx: 18, columnGapPx: 20, density: 'standard', hideIcons: false,
  underlineLinks: true, pageNumbers: true,
  avatar: { visible: true, widthPx: 80, aspectRatio: .75, radiusPx: 0, borderWidthPx: 0, borderColor: '#0F766E', crop: null },
};
export const DENSITIES = {
  compact: { fontSizePx: 12.75, lineHeight: 1.35, marginPx: 14 },
  standard: { fontSizePx: 14, lineHeight: 1.5, marginPx: 18 },
  loose: { fontSizePx: 15, lineHeight: 1.65, marginPx: 24 },
} as const;
export const LEVEL_LABELS = ['基础', '胜任', '熟练', '高级', '专家'];
