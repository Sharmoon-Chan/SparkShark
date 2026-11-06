import { applyTemplate, createExample, createResume, newItem, newSection, plainRich } from '../../src/domain/resume';
import type { Resume, RichDocument } from '../../src/domain/types';

const paragraph = (text: string) => ({ type: 'paragraph' as const, content: [{ type: 'text' as const, text }] });
const oneGroup = (resume: Resume) => {
  resume.layout.groups = [{ ...resume.layout.groups[0], main: resume.layout.groups.flatMap(group => group.main), sidebar: resume.layout.groups.flatMap(group => group.sidebar) }];
  return resume;
};

export function paginationFixtures(): { id: string; resume: Resume; photo?: boolean }[] {
  const example = createExample('分页验证 · 虚构示例');
  const long = oneGroup(applyTemplate(createExample(), 'essential'));
  const work = long.sections.find(section => section.kind === 'work')!;
  if (work.kind !== 'work') throw new Error('Missing fixture');
  work.items = [{ ...newItem('work'), fields: { company: '连续长段落公司', position: '研发工程师', location: '示例城市', dateText: '2020—2026', url: '', summary: plainRich('长段落开始。' + '分页应保留完整的中文标点与所有字符，并避免把任意一行文字从中间裁断。'.repeat(340) + '长段落结束。') } }];

  const rich = oneGroup(applyTemplate(createExample(), 'modern'));
  const summary = rich.sections.find(section => section.kind === 'summary')!;
  if (summary.kind !== 'summary') throw new Error('Missing fixture');
  summary.content = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '长列表及代码的连续分页' }] },
    { type: 'orderedList', attrs: { start: 3 }, content: Array.from({ length: 65 }, (_, index) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [
      { type: 'text', text: `条目${index + 1}：`, marks: [{ type: 'bold' }] },
      { type: 'text', text: '强调与普通正文需要保持同一行完整。'.repeat(4) },
      { type: 'text', text: '斜体说明', marks: [{ type: 'italic' }] },
    ] }] })) },
    { type: 'codeBlock', content: [{ type: 'text', text: Array.from({ length: 80 }, (_, i) => `// code line ${i + 1}: 中文注释须逐行保留`).join('\n') }] },
    paragraph('富文本结束。'),
  ] } as RichDocument;

  const double = oneGroup(applyTemplate(createExample(), 'aurora'));
  const side = newSection('summary'); side.titleOverride = '侧栏长内容';
  if (side.kind !== 'summary') throw new Error('Missing fixture');
  side.content = { type: 'doc', content: Array.from({ length: 70 }, (_, i) => paragraph(`侧栏记录${i + 1}。` + '侧栏单独分页，主栏不丢失内容。'.repeat(5))) };
  double.sections.push(side); double.layout.groups[0].sidebar.push(side.id);
  const doubleRight = structuredClone(double); doubleRight.layout.sidebarSide = 'right'; doubleRight.appearance.templateId = 'ledger';

  const custom = oneGroup(applyTemplate(createExample(), 'ribbon'));
  const customWork = custom.sections.find(section => section.kind === 'work')!;
  customWork.contentLayout = { rowGapPx: 4, itemGapPx: 9, fields: [
    { key: 'company', visible: true, newLine: true, align: 'left', emphasis: 'bold', fontSizePx: 21 },
    { key: 'dateText', visible: true, newLine: false, align: 'right', emphasis: 'muted', inline: true },
    { key: 'position', visible: true, newLine: true, align: 'left', emphasis: 'normal' },
    { key: 'summary', visible: true, newLine: true, align: 'left', emphasis: 'normal', italic: true },
  ] };

  const header = oneGroup(applyTemplate(createExample(), 'scholar'));
  header.basics.name = '很长姓名与联系信息的分页验证'.repeat(30);
  header.basics.customFields = Array.from({ length: 25 }, (_, i) => ({ id: `header-${i}`, label: `补充说明${i + 1}`, value: '页眉内容也不得被固定高度裁掉。'.repeat(8), visible: true, iconId: '' }));
  header.basics.avatarAssetId = 'pagination-photo'; header.appearance.avatar.visible = true;
  const noNumbers = structuredClone(example); noNumbers.appearance.pageNumbers = false;
  return [
    { id: 'blank', resume: createResume('空白分页') }, { id: 'two-logical-groups', resume: example },
    { id: 'single-long-paragraph', resume: long }, { id: 'list-code-marks', resume: rich },
    { id: 'double-left-long-sidebar', resume: double }, { id: 'double-right-long-sidebar', resume: doubleRight },
    { id: 'configured-fields', resume: custom }, { id: 'oversized-header-photo', resume: header, photo: true },
    { id: 'no-page-numbers', resume: noNumbers },
  ];
}
