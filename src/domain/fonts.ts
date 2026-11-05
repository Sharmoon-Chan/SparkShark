export const FONT_OPTIONS = [
  { id: 'noto-sans-sc', label: 'SparkShark Sans · 黑体', description: '中性清晰，适合商务与技术简历。', cssFamily: '"MyResumeSansSC","Noto Sans SC","Microsoft YaHei",sans-serif' },
  { id: 'noto-serif-sc', label: 'SparkShark Serif · 宋体', description: '笔画端正，适合学术与正式文稿。', cssFamily: '"MyResumeSerifSC","Noto Serif SC","SimSun",serif' },
  { id: 'lxgw-wenkai', label: '霞鹜文楷 · 楷体', description: '自然的手写笔意，支持简繁体，适合人文与教育方向。', cssFamily: '"MyResumeWenKaiTC","LXGW WenKai TC","LXGW WenKai","KaiTi","Kaiti SC",serif' },
  { id: 'ibm-plex-sans-sc', label: 'IBM Plex Sans · 人文黑体', description: '现代的人文黑体，中英文组合清楚利落。', cssFamily: '"MyResumePlexSansSC","IBM Plex Sans SC","Noto Sans SC","Microsoft YaHei",sans-serif' },
  { id: 'chiron-round-tc', label: 'Chiron GoRound · 圆体', description: '笔画圆润，支持简繁体，适合设计与创意方向。', cssFamily: '"MyResumeRoundTC","Chiron GoRound TC","Noto Sans SC","Microsoft YaHei",sans-serif' },
  { id: 'source-han-sans-sc', label: '思源黑体', description: '与 TalenCat 同源的思源黑体，正文使用 Medium 字重，笔画更黑、更实。', cssFamily: '"MyResumeSourceHanSansSC","Noto Sans SC","Microsoft YaHei",sans-serif' },
] as const;

export type FontId = typeof FONT_OPTIONS[number]['id'];
export const FONT_IDS = FONT_OPTIONS.map(option => option.id) as [FontId, ...FontId[]];
export function fontOptionFor(id: string): typeof FONT_OPTIONS[number] { return FONT_OPTIONS.find(option => option.id === id) ?? FONT_OPTIONS[0]; }
