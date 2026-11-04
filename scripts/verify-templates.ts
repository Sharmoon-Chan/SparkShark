import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyTemplate, createExample, newItem, plainRich } from '../src/domain/resume';
import { TEMPLATES } from '../src/domain/templates';
import { renderResume } from '../src/rendering/pdf';
import { renderResumeHtml } from '../src/rendering/html';
import type { PreparedAsset } from '../src/domain/types';

const root = process.cwd(), destination = path.join(root, 'output/template-review');
await mkdir(destination, { recursive: true });
const example = createExample('模板核验 · 虚构示例');
const photo = await readFile(path.join(root, 'docs/fixtures/demo-avatar.png'));
example.basics.avatarAssetId = 'template-demo-avatar';
const assets: Record<string, PreparedAsset> = { 'template-demo-avatar': { data: photo, mime: 'image/png', width: photo.readUInt32BE(16), height: photo.readUInt32BE(20) } };
example.layout.groups = [{ ...example.layout.groups[0], main: example.layout.groups.flatMap(group => group.main), sidebar: example.layout.groups.flatMap(group => group.sidebar) }];
const report = [];
for (const template of TEMPLATES) {
  const candidate = applyTemplate(example, template.id);
  const result = await renderResume(candidate, assets, path.join(root, 'public/fonts').replaceAll('\\', '/'));
  await writeFile(path.join(destination, template.id + '.pdf'), result.bytes);
  await writeFile(path.join(destination, template.id + '.regions.json'), JSON.stringify(result.regions, null, 2) + '\n');
  await writeFile(path.join(destination, template.id + '.html'), renderResumeHtml(candidate, assets));
  report.push({ id: template.id, pages: result.pages, bytes: result.bytes.length, font: candidate.appearance.fontFamilyId, mode: candidate.layout.mode });
}
const long = structuredClone(example), work = long.sections.find(section => section.kind === 'work');
if (work?.kind === 'work') work.items = Array.from({ length: 8 }, (_, index) => ({ ...newItem('work'), fields: { company: `长文核验公司 ${index + 1}`, position: '工程师', location: '示例城市', dateText: '2024.01—至今', url: '', summary: plainRich(`记录 ${index + 1}：` + '跨页核验正文应完整保留，中文标点与条目标题正确换行。'.repeat(18)) } }));
for (const id of ['essential', 'modernSplit', 'gradient', 'leafish', 'executive', 'scholar', 'atelier', 'ledger', 'ribbon', 'aurora']) {
  const candidate = applyTemplate(long, id), result = await renderResume(candidate, assets, path.join(root, 'public/fonts').replaceAll('\\', '/'));
  await writeFile(path.join(destination, id + '-long.pdf'), result.bytes);
  await writeFile(path.join(destination, id + '-long.regions.json'), JSON.stringify(result.regions, null, 2) + '\n');
  report.push({ id: id + '-long', pages: result.pages, bytes: result.bytes.length, font: candidate.appearance.fontFamilyId, mode: candidate.layout.mode });
}
const whiteTheme = applyTemplate(example, 'modernSplit'); whiteTheme.appearance.themeColor = '#FFFFFF';
const whiteResult = await renderResume(whiteTheme, assets, path.join(root, 'public/fonts').replaceAll('\\', '/'));
await writeFile(path.join(destination, 'modernSplit-white.pdf'), whiteResult.bytes);
await writeFile(path.join(destination, 'modernSplit-white.regions.json'), JSON.stringify(whiteResult.regions, null, 2) + '\n');
await writeFile(path.join(destination, 'modernSplit-white.html'), renderResumeHtml(whiteTheme, assets));
report.push({ id: 'modernSplit-white', pages: whiteResult.pages, bytes: whiteResult.bytes.length, font: whiteTheme.appearance.fontFamilyId, mode: whiteTheme.layout.mode });
await writeFile(path.join(destination, 'render-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
