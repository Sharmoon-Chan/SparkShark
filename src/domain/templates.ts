import type { Appearance, Layout } from './types';

export interface TemplateDescriptor {
  id: string; name: string; subtitle: string; mode: 'single' | 'double'; style: string;
  reference?: string;
  defaults?: Partial<Pick<Appearance, 'themeColor' | 'fontFamilyId' | 'columnGapPx' | 'hideIcons' | 'underlineLinks'>> & Partial<Pick<Layout, 'sidebarSide' | 'mainRatio'>>;
}
export const TEMPLATES: readonly TemplateDescriptor[] = [
  { id: 'clean', name: '清简', subtitle: '单栏 · 留白清晰', mode: 'single', style: 'clean' },
  { id: 'lined', name: '条理', subtitle: '单栏 · 细线分隔', mode: 'single', style: 'lined' },
  { id: 'split', name: '并列', subtitle: '双栏 · 信息分层', mode: 'double', style: 'split' },
  { id: 'band', name: '色带', subtitle: '双栏 · 侧栏底色', mode: 'double', style: 'band' },
  { id: 'essential', name: 'Essential · 青条', subtitle: '单栏 · 通栏青色标题 / 宋体', mode: 'single', style: 'essential', reference: 'TalenCat Essential', defaults: { fontFamilyId: 'noto-serif-sc', themeColor: '#0F766E', hideIcons: true, underlineLinks: false } },
  { id: 'modern', name: 'Modern · 现代', subtitle: '单栏 · 顶部强调 / 右侧照片', mode: 'single', style: 'modern', reference: 'TalenCat Modern', defaults: { fontFamilyId: 'noto-sans-sc', themeColor: '#2563EB' } },
  { id: 'modernSplit', name: 'Modern Split · 分栏', subtitle: '双栏 · 深色页眉 / 右侧窄栏', mode: 'double', style: 'modernSplit', reference: 'TalenCat Modern Split', defaults: { fontFamilyId: 'noto-sans-sc', themeColor: '#334155', sidebarSide: 'right', mainRatio: .7, columnGapPx: 28 } },
  { id: 'gradient', name: 'Gradient · 渐彩', subtitle: '双栏 · 浅彩横幅 / 标题色块', mode: 'double', style: 'gradient', reference: 'TalenCat Gradient', defaults: { fontFamilyId: 'noto-sans-sc', themeColor: '#7C3AED', sidebarSide: 'right', mainRatio: .65, columnGapPx: 24 } },
  { id: 'reed', name: 'Reed · 书卷', subtitle: '单栏 · 竖线标题 / 宋体', mode: 'single', style: 'reed', reference: 'TalenCat Reed', defaults: { fontFamilyId: 'noto-serif-sc', themeColor: '#92400E' } },
  { id: 'leafish', name: 'Leafish · 青叶', subtitle: '双栏 · 左侧底色 / 圆润标题', mode: 'double', style: 'leafish', reference: 'TalenCat Leafish', defaults: { fontFamilyId: 'noto-sans-sc', themeColor: '#166534', sidebarSide: 'left', mainRatio: .7, columnGapPx: 26 } },
  { id: 'executive', name: '领航', subtitle: '单栏 · 深蓝页眉 / 实色标题', mode: 'single', style: 'executive', defaults: { fontFamilyId: 'ibm-plex-sans-sc', themeColor: '#1E3A5F', hideIcons: true, underlineLinks: false } },
  { id: 'scholar', name: '学研', subtitle: '单栏 · 居中宋体 / 双线标题', mode: 'single', style: 'scholar', defaults: { fontFamilyId: 'noto-serif-sc', themeColor: '#475569', hideIcons: true, underlineLinks: false } },
  { id: 'atelier', name: '艺线', subtitle: '单栏 · 文楷页眉 / 短线标题', mode: 'single', style: 'atelier', defaults: { fontFamilyId: 'lxgw-wenkai', themeColor: '#9F4661', underlineLinks: false } },
  { id: 'ledger', name: '格序', subtitle: '双栏 · 描边页眉 / 网格标题', mode: 'double', style: 'ledger', defaults: { fontFamilyId: 'ibm-plex-sans-sc', themeColor: '#36526B', sidebarSide: 'right', mainRatio: .68, columnGapPx: 28, hideIcons: true } },
  { id: 'ribbon', name: '锦带', subtitle: '双栏 · 顶部色线 / 浅底条带', mode: 'double', style: 'ribbon', defaults: { fontFamilyId: 'noto-serif-sc', themeColor: '#9A3412', sidebarSide: 'left', mainRatio: .68, columnGapPx: 24 } },
  { id: 'aurora', name: '晨光', subtitle: '双栏 · 圆角浅彩 / 圆体标题', mode: 'double', style: 'aurora', defaults: { fontFamilyId: 'chiron-round-tc', themeColor: '#0E7490', sidebarSide: 'left', mainRatio: .7, columnGapPx: 26 } },
];
export function templateFor(id: string): TemplateDescriptor { return TEMPLATES.find(template => template.id === id) ?? TEMPLATES[0]; }

/** Rendering choices shared by PDF and the offline reading copy. */
export function templateDesign(id: string) {
  const classic = id === 'essential';
  const darkHeader = ['modernSplit', 'executive'].includes(id);
  const tintedHeader = id === 'gradient';
  const rightPhoto = ['essential', 'modern', 'modernSplit', 'reed', 'executive', 'ledger'].includes(id);
  const editorial = ['reed', 'scholar', 'atelier'].includes(id);
  return { classic, darkHeader, tintedHeader, rightPhoto, editorial,
    centeredHeader: id === 'scholar',
    outlineHeader: id === 'ledger',
    accentHeader: id === 'atelier',
    topRule: id === 'ribbon',
    lightHeader: id === 'aurora',
    titleSolid: id === 'executive',
    titleDoubleRule: id === 'scholar',
    titleOutline: id === 'ledger',
    titleDot: id === 'aurora',
    titleShortRule: id === 'atelier',
    headerRule: ['modern', 'reed'].includes(id),
    titleRule: ['lined', 'modernSplit'].includes(id),
    titleBar: ['modern', 'reed', 'ribbon'].includes(id),
    titleFill: ['essential', 'gradient', 'leafish', 'ribbon'].includes(id),
    sideTint: ['band', 'leafish', 'aurora'].includes(id),
    sideDivider: ['modernSplit', 'gradient', 'ledger'].includes(id),
  };
}
