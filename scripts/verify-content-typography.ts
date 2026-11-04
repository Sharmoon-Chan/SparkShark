import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyTemplate, createExample, newItem, plainRich } from '../src/domain/resume';
import { defaultContentLayout } from '../src/domain/contentLayout';
import { renderResume } from '../src/rendering/pdf';
import { renderResumeHtml } from '../src/rendering/html';
import type { Resume } from '../src/domain/types';

const root = process.cwd(), output = path.join(root, 'output/content-typography');
await mkdir(output, { recursive: true });
const base = applyTemplate(createExample('字号与格式 · 虚构核验'), 'essential');
base.layout.groups = [{ id: base.layout.groups[0].id, main: base.layout.groups.flatMap(group => [...group.main, ...group.sidebar]), sidebar: [] }];
base.sections.forEach(section => { section.visible = ['summary', 'work', 'skills'].includes(section.kind); });
const work = base.sections.find(section => section.kind === 'work')!;
if (work.kind !== 'work') throw new Error('work fixture');
work.items = [{ ...newItem('work'), fields: { ...newItem('work').fields, company: '字号样式验证公司', position: '字段字号准确验证', location: '斜体地点', dateText: '2024.01-2026.11', url: 'https://example.com/typography', summary: plainRich('字段正文应使用自己的字号，斜体与下划线同时生效。') } }];
work.contentLayout = defaultContentLayout(work);
for (const [key, style] of [
  ['company', { fontSizePx: 20, italic: true, underline: true, emphasis: 'bold' }],
  ['position', { fontSizePx: 16, underline: true, emphasis: 'muted' }],
  ['location', { fontSizePx: 10, italic: true }],
  ['dateText', { fontSizePx: 12 }],
  ['url', { fontSizePx: 14, italic: true, underline: true }],
  ['summary', { fontSizePx: 15, italic: true, underline: true }],
] as const) Object.assign(work.contentLayout.fields.find(field => field.key === key)!, style);

const summary = base.sections.find(section => section.kind === 'summary')!;
if (summary.kind !== 'summary') throw new Error('summary fixture');
summary.contentLayout = defaultContentLayout(summary);
Object.assign(summary.contentLayout.fields[0], { fontSizePx: 16, italic: true, underline: true });
summary.content = { type: 'doc', content: [
  { type: 'paragraph', content: [
    { type: 'text', text: '整段格式验证。' },
    { type: 'text', text: '原有加粗保留', marks: [{ type: 'bold' }] },
    { type: 'text', text: '删除线保留', marks: [{ type: 'strike' }] },
    { type: 'text', text: '链接保留', marks: [{ type: 'link', attrs: { href: 'https://example.com/rich-format' } }] },
  ] },
  { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '列表字号与格式正确。' }] }] }] },
  { type: 'codeBlock', content: [{ type: 'text', text: 'const value = 1;\n中文代码' }] },
] };

const long = structuredClone(base), longWork = long.sections.find(section => section.kind === 'work')!;
if (longWork.kind !== 'work') throw new Error('long fixture');
const phrase = '自定义字号与格式不应删减任何正文，跨页内容必须完整保留。';
longWork.items = Array.from({ length: 6 }, (_, index) => ({ ...newItem('work'), fields: { ...work.items[0].fields, company: `字号长文公司${index + 1}`, summary: plainRich(phrase.repeat(24)) } }));
const large = structuredClone(base), largeWork = large.sections.find(section => section.kind === 'work')!;
Object.assign(largeWork.contentLayout!.fields.find(field => field.key === 'company')!, { fontSizePx: 36 });
Object.assign(largeWork.contentLayout!.fields.find(field => field.key === 'summary')!, { fontSizePx: 30 });
if (largeWork.kind === 'work') largeWork.items[0].fields.summary = plainRich('大字号正文仍应正确换行与分页，完整文字需要保留。'.repeat(12));
const cases: [string, Resume][] = [['serif', base], ['sans-double', applyTemplate(base, 'modernSplit')], ['large', large], ['long-single', long], ['long-double', applyTemplate(long, 'modernSplit')]];
const report = [];
for (const [name, document] of cases) {
  const original = structuredClone(document);
  const rendered = await renderResume(document, {}, path.join(root, 'public/fonts').replaceAll('\\', '/'));
  assert.deepEqual(document, original, 'Rendering changed the stored data');
  await writeFile(path.join(output, `${name}.pdf`), rendered.bytes);
  await writeFile(path.join(output, `${name}.html`), renderResumeHtml(document));
  await writeFile(path.join(output, `${name}.resume.json`), JSON.stringify(document, null, 2));
  await writeFile(path.join(output, `${name}.fields.json`), JSON.stringify(rendered.fields, null, 2));
  report.push({ name, pages: rendered.pages, fields: rendered.fields.length });
}
await writeFile(path.join(output, 'render-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
