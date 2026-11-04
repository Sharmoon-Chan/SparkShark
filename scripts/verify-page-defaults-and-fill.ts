import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyTemplate, createExample, newItem, plainRich, snapshotOf } from '../src/domain/resume';
import { defaultContentLayout } from '../src/domain/contentLayout';
import { DEFAULT_APPEARANCE, DENSITIES } from '../src/domain/registry';
import type { PreparedAsset, Resume } from '../src/domain/types';
import { smartOnePage } from '../src/rendering/onePage';
import { onePageUsage, ONE_PAGE_FILL_TARGET } from '../src/rendering/onePageFill';
import { captureOnePageRestore, restoreOnePageFormat } from '../src/rendering/onePageRestore';
import { renderResume } from '../src/rendering/pdf';
import { renderResumeHtml } from '../src/rendering/html';

const root = process.cwd(), destination = path.join(root, 'output/page-defaults');
await mkdir(destination, { recursive: true });
const fontBase = path.join(root, 'public/fonts').replaceAll('\\', '/');
const presets = JSON.parse(await readFile(path.join(root, 'docs/assets/talencat/density-presets.json'), 'utf8'));
for (const [index, id] of ['compact', 'standard', 'loose'].entries()) {
  const values = Object.fromEntries(presets[index].values.map((field: { label: string; value: string }) => [field.label, Number(field.value)]));
  assert.deepEqual(DENSITIES[id as keyof typeof DENSITIES], { fontSizePx: values['字体大小'], lineHeight: values['行高'], marginPx: values['外边距'] });
}
assert.equal(DEFAULT_APPEARANCE.marginPx, 18);
const photo = await readFile(path.join(root, 'docs/fixtures/avatar-portrait-fixture.png'));
const assets: Record<string, PreparedAsset> = { 'fill-demo-avatar': { data: photo, mime: 'image/png', width: 180, height: 240 } };
const sample = applyTemplate(createExample('铺满一页 · 虚构验证'), 'essential');
sample.basics.avatarAssetId = 'fill-demo-avatar';
sample.layout.groups = [{ id: sample.layout.groups[0].id, main: sample.layout.groups.flatMap(group => [...group.main, ...group.sidebar]), sidebar: [] }];
sample.sections.forEach(section => { section.visible = ['summary', 'education', 'work', 'skills'].includes(section.kind); });
const summary = sample.sections.find(section => section.kind === 'summary')!;
if (summary.kind === 'summary') summary.content = plainRich('熟悉前端开发、组件设计与浏览器本地存储。本简历中的内容均为虚构测试资料。');
const work = sample.sections.find(section => section.kind === 'work')!;
if (work.kind !== 'work') throw new Error('work fixture');
work.items = [{ ...newItem('work'), fields: { ...newItem('work').fields, company: '示例研发公司', position: '软件工程师', location: '示例城市', dateText: '2024.01—至今', summary: plainRich('负责组件开发、页面交互与导出流程。\n验证数据保存、内容恢复和中文排版，所有文字应完整保留。') } }];
const custom = structuredClone(sample), customWork = custom.sections.find(section => section.kind === 'work')!;
customWork.contentLayout = defaultContentLayout(customWork);
customWork.contentLayout.fields.find(field => field.key === 'position')!.newLine = false;
customWork.contentLayout.fields.find(field => field.key === 'position')!.inline = true;
customWork.contentLayout.fields.find(field => field.key === 'location')!.align = 'right';
customWork.contentLayout.fields.find(field => field.key === 'url')!.visible = false;
const sparse = structuredClone(sample);
sparse.sections.forEach(section => { section.visible = section.kind === 'summary'; if (section.kind === 'summary') section.content = plainRich('本简历仅含一段简短的虚构说明。'); });
const multi = structuredClone(sample);
multi.layout.groups = [{ ...sample.layout.groups[0], main: sample.layout.groups[0].main.slice(0, 3) }, { id: 'fill-second-page', main: sample.layout.groups[0].main.slice(3), sidebar: [] }];

const report = [];
const cases: [string, Resume][] = [['single', sample], ['custom-fields', custom], ['double', applyTemplate(sample, 'modernSplit')], ['gradient', applyTemplate(sample, 'gradient')], ['sparse', sparse], ['manual-pages', multi]];
for (const [id, resume] of cases) {
  const original = structuredClone(resume), before = await renderResume(resume, assets, fontBase);
  const result = await smartOnePage(resume, candidate => renderResume(candidate, assets, fontBase), { onProgress: (message, attempt) => console.log(`${id}: ${attempt} ${message}`) });
  const after = await renderResume(result.resume, assets, fontBase);
  assert.deepEqual(resume, original, 'Search changed the input');
  assert.deepEqual(result.resume.basics, original.basics, 'Basic information changed');
  assert.deepEqual(result.resume.sections.map(({ contentLayout: _layout, ...section }) => section), original.sections.map(({ contentLayout: _layout, ...section }) => section), 'Content changed');
  assert.equal(after.pages, 1, 'Result must remain one page');
  if (id !== 'sparse') assert.ok(onePageUsage(result.resume, after)! >= ONE_PAGE_FILL_TARGET, 'Expected the page to be filled');
  assert.ok(result.attempts <= 36, 'Measurement budget exceeded');
  const restored = restoreOnePageFormat(result.resume, captureOnePageRestore(original, result.resume));
  assert.deepEqual(snapshotOf(restored), snapshotOf(original), 'Restoration differs');
  const repeated = await smartOnePage(result.resume, candidate => renderResume(candidate, assets, fontBase));
  assert.equal(repeated.status, 'already', 'Repeated filling should leave the result unchanged');
  for (const [state, document, rendered] of [['before', original, before], ['after', result.resume, after]] as const) {
    await writeFile(path.join(destination, `${id}-${state}.pdf`), rendered.bytes);
    await writeFile(path.join(destination, `${id}-${state}.resume.json`), JSON.stringify(document, null, 2));
    await writeFile(path.join(destination, `${id}-${state}.fields.json`), JSON.stringify(rendered.fields, null, 2));
  }
  await writeFile(path.join(destination, `${id}-after.html`), renderResumeHtml(result.resume, assets));
  report.push({ id, status: result.status, beforePages: before.pages, afterPages: after.pages, beforeUsage: onePageUsage(original, before), afterUsage: onePageUsage(result.resume, after), attempts: result.attempts, fill: result.fill, font: result.resume.appearance.fontSizePx, line: result.resume.appearance.lineHeight, spacing: result.resume.appearance.spacingScale, margin: result.resume.appearance.marginPx, restored: true, repeated: repeated.status, changes: result.changes });
}
for (const id of ['compact', 'standard', 'loose'] as const) {
  const document = structuredClone(sample); Object.assign(document.appearance, DENSITIES[id], { density: id });
  const rendered = await renderResume(document, assets, fontBase);
  await writeFile(path.join(destination, `density-${id}.pdf`), rendered.bytes);
  await writeFile(path.join(destination, `density-${id}.resume.json`), JSON.stringify(document, null, 2));
}
const old = structuredClone(sample); old.appearance.marginPx = 46;
await writeFile(path.join(destination, 'density-old-46.pdf'), (await renderResume(old, assets, fontBase)).bytes);
await writeFile(path.join(destination, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
