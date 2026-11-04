import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyTemplate, createExample, createResume, newItem, plainRich, snapshotOf } from '../src/domain/resume';
import { defaultContentLayout } from '../src/domain/contentLayout';
import { smartOnePage } from '../src/rendering/onePage';
import { captureOnePageRestore, restoreOnePageFormat } from '../src/rendering/onePageRestore';
import { renderResume } from '../src/rendering/pdf';
import { renderResumeHtml } from '../src/rendering/html';
import type { PreparedAsset, Resume } from '../src/domain/types';

const root = process.cwd(), output = path.join(root, 'output/smart-one-page');
await mkdir(output, { recursive: true });
const bytes = await readFile(path.join(root, 'docs/fixtures/avatar-portrait-fixture.png'));
const assets: Record<string, PreparedAsset> = { 'smart-fit-demo-photo': { data: bytes, mime: 'image/png', width: 180, height: 240 } };
const example = applyTemplate(createExample('智能一页 · 虚构验证'), 'essential');
example.basics.avatarAssetId = 'smart-fit-demo-photo';
// Exercise an existing saved oval setting; display must use a rectangular frame.
example.appearance.avatar.aspectRatio = .75; example.appearance.avatar.radiusPx = 40;
const dense = structuredClone(example); dense.title = '字段紧排与一页 · 虚构验证';
const work = dense.sections.find(section => section.kind === 'work')!;
if (work.kind !== 'work') throw new Error('work fixture');
work.items = Array.from({ length: 2 }, (_, index) => ({ ...newItem('work'), fields: { company: `紧凑验证公司 ${index + 1}`, position: '研发工程师', dateText: '2023.01—至今', location: '示例城市', url: 'https://example.com/fit', summary: plainRich('完整保留工作正文，改进界面、数据缓存与团队协作。'.repeat(3)) } }));
const education = dense.sections.find(section => section.kind === 'education')!;
education.contentLayout = defaultContentLayout(education);
education.contentLayout.fields.reverse(); // A user's chosen field order must survive fitting.
const impossible = structuredClone(example); impossible.title = '内容过长 · 虚构验证';
const longWork = impossible.sections.find(section => section.kind === 'work')!;
if (longWork.kind !== 'work') throw new Error('long work fixture');
longWork.items = Array.from({ length: 8 }, (_, index) => ({ ...newItem('work'), fields: { company: `完整正文公司 ${index + 1}`, position: '工程师', dateText: '2024.01—至今', location: '', url: '', summary: plainRich('智能一页不得删减任何工作内容，所有完整文字需要保留。'.repeat(24)) } }));
const wideMargins = applyTemplate(createResume('宽边距一页 · 虚构验证'), 'essential');
wideMargins.layout.mode = 'single'; wideMargins.appearance.marginPx = 96;
wideMargins.basics.name = '边距优化示例';
wideMargins.sections.forEach(section => { section.visible = section.kind === 'summary'; if (section.kind === 'summary') section.content = plainRich('宽边距优化应优先保留正文字号与行高，所有内容仍完整存在。'.repeat(70)); });
const reports = [];
for (const [id, resume] of [['manual-pages', example], ['dense', dense], ['margins-first', wideMargins], ['long-content', impossible]] as [string, Resume][]) {
  const original = JSON.stringify(resume), initial = await renderResume(resume, assets, path.join(root, 'public/fonts').replaceAll('\\', '/'));
  const result = await smartOnePage(resume, candidate => renderResume(candidate, assets, path.join(root, 'public/fonts').replaceAll('\\', '/')), { onProgress: (message, attempt) => console.log(`${id}: ${attempt} ${message}`) });
  if (JSON.stringify(resume) !== original) throw new Error('search mutated source');
  if (JSON.stringify(result.resume.basics) !== JSON.stringify(resume.basics) || result.resume.sections.some(section => { const source = resume.sections.find(item => item.id === section.id)!; return JSON.stringify({ ...source, contentLayout: undefined }) !== JSON.stringify({ ...section, contentLayout: undefined }); })) throw new Error('content changed while fitting');
  if (result.status === 'fit' || result.status === 'filled') {
    const restored = restoreOnePageFormat(result.resume, captureOnePageRestore(resume, result.resume));
    if (JSON.stringify(snapshotOf(restored)) !== JSON.stringify(snapshotOf(resume))) throw new Error('formatting restore differs');
  }
  const fitted = await renderResume(result.resume, assets, path.join(root, 'public/fonts').replaceAll('\\', '/'));
  await writeFile(path.join(output, id + '-before.pdf'), initial.bytes);
  await writeFile(path.join(output, id + '-after.pdf'), fitted.bytes);
  await writeFile(path.join(output, id + '-after.html'), renderResumeHtml(result.resume, assets));
  await writeFile(path.join(output, id + '-after.regions.json'), JSON.stringify(fitted.regions, null, 2));
  await writeFile(path.join(output, id + '-before.resume.json'), JSON.stringify(resume, null, 2));
  await writeFile(path.join(output, id + '-after.resume.json'), JSON.stringify(result.resume, null, 2));
  reports.push({ id, status: result.status, beforePages: initial.pages, afterPages: fitted.pages, attempts: result.attempts, font: result.resume.appearance.fontSizePx, line: result.resume.appearance.lineHeight, margin: result.resume.appearance.marginPx, spacing: result.resume.appearance.spacingScale ?? 1, changes: result.changes });
}
await writeFile(path.join(output, 'report.json'), JSON.stringify(reports, null, 2));
console.log(JSON.stringify(reports, null, 2));
