import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyTemplate, createExample, newItem, plainRich, uid } from '../src/domain/resume';
import { defaultContentLayout } from '../src/domain/contentLayout';
import type { Resume, SectionContentLayout } from '../src/domain/types';
import { renderResume } from '../src/rendering/pdf';
import { renderResumeHtml } from '../src/rendering/html';

const root = process.cwd(), output = path.join(root, 'output/content-layout');
await mkdir(output, { recursive: true });
const base = applyTemplate(createExample('模块内部排版 · 虚构验证'), 'essential');
base.layout.groups = [{ ...base.layout.groups[0], main: base.layout.groups.flatMap(group => group.main), sidebar: base.layout.groups.flatMap(group => group.sidebar) }];
const work = base.sections.find(section => section.kind === 'work')!;
if (work.kind !== 'work') throw new Error('work fixture');
work.items[0].fields.company = '排列验证示例公司'; work.items[0].fields.position = '系统研发工程师'; work.items[0].fields.location = '示例二区';
work.items[0].fields.summary = plainRich('配置后的工作正文完整保留。');
work.contentLayout = defaultContentLayout(work);
const reorder = (settings: SectionContentLayout, keys: string[]) => keys.map(key => settings.fields.find(field => field.key === key)!);
work.contentLayout.fields = reorder(work.contentLayout, ['position', 'dateText', 'company', 'location', 'summary', 'url']);
work.contentLayout.fields.forEach((field, index) => { field.newLine = [0, 2, 4, 5].includes(index); field.align = ['dateText', 'location'].includes(field.key) ? 'right' : 'left'; });
work.contentLayout.fields.find(field => field.key === 'position')!.emphasis = 'bold';
work.contentLayout.rowGapPx = 3; work.contentLayout.itemGapPx = 6;
const education = base.sections.find(section => section.kind === 'education')!;
education.contentLayout = defaultContentLayout(education);
education.contentLayout.fields = reorder(education.contentLayout, ['major', 'studyType', 'institution', 'dateText', 'score', 'officialUrl', 'summary']);
education.contentLayout.fields.forEach((field, index) => { field.newLine = ![1, 3].includes(index); field.align = ['studyType', 'dateText'].includes(field.key) ? 'right' : 'left'; if (field.key === 'score') field.visible = false; });
education.contentLayout.fields[0].emphasis = 'bold'; education.contentLayout.rowGapPx = 1; education.contentLayout.itemGapPx = 4;
const skills = base.sections.find(section => section.kind === 'skills')!;
skills.contentLayout = defaultContentLayout(skills); skills.contentLayout.rowGapPx = 1; skills.contentLayout.itemGapPx = 3;
const summary = base.sections.find(section => section.kind === 'summary')!;
if (summary.kind !== 'summary') throw new Error('summary fixture');
summary.contentLayout = defaultContentLayout(summary);
summary.content = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '富文本居中与加粗保留', marks: [{ type: 'bold' }] }] }] };
const nameKey = uid('field'), bodyKey = uid('field'), linkKey = uid('field');
const custom = { id: uid('section'), kind: 'custom' as const, titleOverride: '自定义模块排版', visible: true,
  fieldDefinitions: [{ id: nameKey, type: 'name' as const, label: '名称', visible: true }, { id: bodyKey, type: 'summary' as const, label: '说明', visible: true }, { id: linkKey, type: 'url' as const, label: '网址', visible: true }],
  items: [{ id: uid('item'), visible: true, values: { [nameKey]: '自定义字段引用保留', [bodyKey]: plainRich('自定义正文内容正常显示。'), [linkKey]: 'https://example.com/custom-layout' } }], contentLayout: undefined as SectionContentLayout | undefined };
custom.contentLayout = defaultContentLayout(custom);
custom.contentLayout.fields = reorder(custom.contentLayout, [linkKey, nameKey, bodyKey]);
base.sections.push(custom); base.layout.groups[0].main.push(custom.id);

const long = structuredClone(base), longWork = long.sections.find(section => section.kind === 'work')!;
if (longWork.kind !== 'work') throw new Error('long work fixture');
const phrase = '模块内部排版跨页正文应完整保留，字段排序不会修改实际内容。';
longWork.items = Array.from({ length: 6 }, (_, index) => ({ ...newItem('work'), fields: { company: `排版长文公司 ${index + 1}`, position: '研发工程师', location: '示例城市', dateText: '2024.01—至今', url: `https://example.com/work/${index + 1}`, summary: plainRich(phrase.repeat(24)) } }));

const hidden = createExample('全部字段隐藏 · 虚构验证');
const hiddenProjects = hidden.sections.find(section => section.kind === 'projects')!;
hiddenProjects.contentLayout = defaultContentLayout(hiddenProjects); hiddenProjects.contentLayout.fields.forEach(field => { field.visible = false; });
const hiddenWork = hidden.sections.find(section => section.kind === 'work')!;
if (hiddenWork.kind !== 'work') throw new Error('hidden work fixture');
hiddenWork.contentLayout = defaultContentLayout(hiddenWork); hiddenWork.contentLayout.fields.find(field => field.key === 'location')!.visible = false;
hiddenWork.items[0].fields.location = '隐藏的未知字符 \uFFFD 🦄';

const richFirst = structuredClone(long), richFirstWork = richFirst.sections.find(section => section.kind === 'work')!;
if (richFirstWork.contentLayout) richFirstWork.contentLayout.fields = reorder(richFirstWork.contentLayout, ['summary', 'position', 'company', 'dateText', 'location', 'url']);
const cases: [string, Resume][] = [['configured', base], ['configured-double', applyTemplate(base, 'modernSplit')], ['configured-long', long], ['configured-long-double', applyTemplate(long, 'modernSplit')], ['configured-long-rich-first', richFirst], ['hidden-fields', hidden]];
const report = [];
for (const [id, resume] of cases) {
  const result = await renderResume(resume, {}, path.join(root, 'public/fonts').replaceAll('\\', '/'));
  await writeFile(path.join(output, id + '.pdf'), result.bytes);
  await writeFile(path.join(output, id + '.regions.json'), JSON.stringify(result.regions, null, 2) + '\n');
  await writeFile(path.join(output, id + '.resume.json'), JSON.stringify(resume, null, 2) + '\n');
  await writeFile(path.join(output, id + '.html'), renderResumeHtml(resume));
  report.push({ id, pages: result.pages, bytes: result.bytes.length });
}
await writeFile(path.join(output, 'render-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
