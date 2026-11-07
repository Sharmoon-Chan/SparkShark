import { applyTemplate, createExample, plainRich } from '../../src/domain/resume';
import { alignPreviewField } from '../../src/domain/fieldAlignment';
import { defaultContentLayout } from '../../src/domain/contentLayout';
import type { Resume, SectionKind, TextAlignment } from '../../src/domain/types';

export interface AlignmentExpectation {
  section: SectionKind; keys: string[]; alignment: TextAlignment; slot?: [index: number, count: number];
}
export interface AlignmentFixture { id: string; resume: Resume; expected: AlignmentExpectation[]; paragraphs?: { text: string; alignment: TextAlignment; inset?: number }[]; repetitions?: number }

export function alignmentFixtures(): AlignmentFixture[] {
  const base = applyTemplate(createExample('分层对齐验收 · 虚构示例'), 'clean');
  base.appearance.fontFamilyId = 'noto-sans-sc';
  base.appearance.hideIcons = true;
  base.basics.avatarAssetId = null;
  for (const section of base.sections) section.visible = ['education', 'summary', 'skills'].includes(section.kind);
  const education = base.sections.find(section => section.kind === 'education')!;
  const summary = base.sections.find(section => section.kind === 'summary')!;
  const skills = base.sections.find(section => section.kind === 'skills')!;
  if (education.kind !== 'education' || summary.kind !== 'summary' || skills.kind !== 'skills') throw new Error('Missing fixture sections');
  education.items = [{ ...education.items[0], fields: { institution: '对齐示例大学', dateText: '2021 - 2025', major: '计算机专业', studyType: '本科', score: '3.8 / 4.0', officialUrl: '', summary: plainRich('教育正文内容完整保留。') } }];
  summary.content = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: '默认段落对齐' }] },
    { type: 'paragraph', attrs: { textAlign: 'left' }, content: [{ type: 'text', text: '原有左对齐段落' }] },
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '原有居中段落', marks: [{ type: 'bold' }] }] },
    { type: 'codeBlock', content: [{ type: 'text', text: 'CodeAlignment' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列表内容完整保留' }] }] }] },
  ] };
  skills.items = [{ ...skills.items[0], fields: { name: 'TypeScript', level: 4, keywords: ['React', 'Node'], description: '技能描述保持原有样式。' } }];
  for (const section of [education, summary, skills]) section.contentLayout = defaultContentLayout(section);
  base.sections = [education, summary, skills];
  base.layout.groups = [{ id: base.layout.groups[0].id, main: [education.id, summary.id, skills.id], sidebar: [] }];
  const result: AlignmentFixture[] = [];
  const make = (id: string) => { const fixture: AlignmentFixture = { id, resume: structuredClone(base), expected: [] }; result.push(fixture); return fixture; };
  const align = (fixture: AlignmentFixture, kind: SectionKind, key: string, scope: 'field' | 'row' | 'module', value: TextAlignment) => {
    const section = fixture.resume.sections.find(section => section.kind === kind)!;
    section.contentLayout = alignPreviewField(section, key, scope, value) ?? section.contentLayout;
  };
  make('original-configured');
  for (const value of ['left', 'center', 'right'] as const) {
    const fixture = make('row-' + value);
    align(fixture, 'education', 'institution', 'row', value);
    fixture.expected.push({ section: 'education', keys: ['institution', 'dateText'], alignment: value });
  }
  for (const value of ['center', 'right'] as const) {
    const fixture = make('field-' + value);
    align(fixture, 'education', 'institution', 'field', value);
    fixture.expected.push({ section: 'education', keys: ['institution'], alignment: value, slot: [0, 2] });
  }
  const mixed = make('module-right-row-center');
  align(mixed, 'education', 'institution', 'module', 'right');
  align(mixed, 'education', 'major', 'row', 'center');
  mixed.expected.push({ section: 'education', keys: ['institution', 'dateText'], alignment: 'right' }, { section: 'education', keys: ['major', 'studyType', 'score'], alignment: 'center' });
  const hidden = make('hidden-leader');
  const hiddenSection = hidden.resume.sections.find(section => section.kind === 'education')!;
  hiddenSection.contentLayout!.fields.find(field => field.key === 'major')!.visible = false;
  hiddenSection.contentLayout!.fields.find(field => field.key === 'major')!.rowAlign = 'right';
  hidden.expected.push({ section: 'education', keys: ['studyType', 'score'], alignment: 'right' });
  const empty = make('empty-leader');
  const emptySection = empty.resume.sections.find(section => section.kind === 'education')!;
  if (emptySection.kind === 'education') emptySection.items[0].fields.major = '';
  emptySection.contentLayout!.fields.find(field => field.key === 'major')!.rowAlign = 'center';
  empty.expected.push({ section: 'education', keys: ['studyType', 'score'], alignment: 'center' });
  for (const override of [false, true]) {
    const fixture = make(override ? 'paragraph-override' : 'paragraph-inherit');
    align(fixture, 'summary', 'summary', 'module', 'right');
    if (override) align(fixture, 'summary', 'summary', 'field', 'center');
    fixture.paragraphs = [
      { text: '默认段落对齐', alignment: override ? 'center' : 'right' },
      { text: '原有左对齐段落', alignment: override ? 'center' : 'left' },
      { text: '原有居中段落', alignment: 'center' },
      { text: 'CodeAlignment', alignment: override ? 'center' : 'right', inset: 5 },
    ];
  }
  for (const side of ['left', 'right'] as const) {
    const fixture = make('sidebar-' + side);
    fixture.resume = applyTemplate(fixture.resume, side === 'left' ? 'leafish' : 'gradient');
    fixture.resume.appearance.fontFamilyId = 'noto-sans-sc';
    fixture.resume.layout.groups[0] = { ...fixture.resume.layout.groups[0], main: [summary.id], sidebar: [education.id, skills.id] };
    // Applying a template preserves content layout metadata; both narrow columns are tested.
    align(fixture, 'education', 'institution', 'module', 'right');
    align(fixture, 'skills', 'name', 'module', 'center');
    fixture.expected.push({ section: 'education', keys: ['major', 'studyType', 'score'], alignment: 'right' }, { section: 'skills', keys: ['name', 'level'], alignment: 'center' }, { section: 'skills', keys: ['description', 'keywords'], alignment: 'center' });
  }
  const long = make('long-wrapped-right');
  const longSection = long.resume.sections.find(section => section.kind === 'education')!;
  if (longSection.kind === 'education') {
    longSection.items[0].fields.institution = '很长的学校名称和项目名称需要完整换行并保留所有内容。'.repeat(5);
    longSection.items[0].fields.summary = plainRich('长段落应连续分页，所有文字应保持完整。'.repeat(170));
  }
  long.repetitions = 170;
  align(long, 'education', 'institution', 'module', 'right');
  return result;
}
