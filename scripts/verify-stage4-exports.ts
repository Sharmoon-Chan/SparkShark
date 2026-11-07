/** Produce the fixed synthetic export matrix; inspect with verify-stage4-exports.py. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'parse5';
import { applyTemplate, createExample, newItem, plainRich } from '../src/domain/resume';
import { TEMPLATES } from '../src/domain/templates';
import { FONT_OPTIONS } from '../src/domain/fonts';
import { renderResume } from '../src/rendering/pdf';
import { renderResumeHtml } from '../src/rendering/html';
import type { PreparedAsset, Resume, RichDocument } from '../src/domain/types';
import { paginationFixtures } from '../tests/fixtures/pagination';

const output = path.resolve('output/stage4/exports');
await mkdir(output, { recursive: true });
const longFixture = paginationFixtures().find(fixture => fixture.id === 'double-left-long-sidebar')!;
await writeFile(path.resolve('output/stage4/long-resume-backup.json'), JSON.stringify({ format: 'myresume', schemaVersion: 1, exportedAt: new Date().toISOString(), resumes: [longFixture.resume], assets: [] }) + '\n');
const photo = await readFile('docs/fixtures/demo-avatar.png');
const preparedPhoto: PreparedAsset = { data: photo, mime: 'image/png', width: photo.readUInt32BE(16), height: photo.readUInt32BE(20) };
const example = createExample('第四阶段输出验收 · 虚构示例');
example.layout.groups = [{ ...example.layout.groups[0], main: example.layout.groups.flatMap(group => group.main), sidebar: example.layout.groups.flatMap(group => group.sidebar) }];
example.basics.avatarAssetId = 'stage4-photo';
example.basics.customFields.push({ id: 'stage4-hidden-contact', iconId: '', label: 'HiddenContactSentinel', value: 'HiddenContactValue', visible: false });
const summary = example.sections.find(section => section.kind === 'summary')!;
if (summary.kind !== 'summary') throw new Error('Missing summary fixture');
summary.content = { type: 'doc', content: [
  ...(summary.content.content ?? []),
  { type: 'paragraph', content: [
    { type: 'text', text: '常规正文 RegularBody。' },
    { type: 'text', text: '强调正文 BoldBody。', marks: [{ type: 'bold' }] },
    { type: 'text', text: '斜体正文 ItalicBody。', marks: [{ type: 'italic' }] },
    { type: 'text', text: '验收链接', marks: [{ type: 'link', attrs: { href: 'https://example.com/stage4-verification' } }] },
  ] },
] } as RichDocument;
const work = example.sections.find(section => section.kind === 'work')!;
if (work.kind !== 'work') throw new Error('Missing work fixture');
work.items.push({ ...newItem('work'), visible: false, fields: { company: 'HiddenItemSentinel', position: '', dateText: '', location: '', url: '', summary: plainRich('HiddenBodySentinel') } });

const cases: { id: string; resume: Resume; photo?: boolean; marks?: boolean }[] = TEMPLATES.map(template => ({ id: `template-${template.id}`, resume: applyTemplate(example, template.id), photo: true, marks: true }));
for (const fixture of paginationFixtures()) if (['single-long-paragraph', 'list-code-marks', 'double-left-long-sidebar', 'double-right-long-sidebar', 'oversized-header-photo'].includes(fixture.id)) cases.push({ ...fixture, id: `stress-${fixture.id}` });
for (const font of FONT_OPTIONS) { const resume = applyTemplate(example, 'clean'); resume.appearance.fontFamilyId = font.id; cases.push({ id: `font-${font.id}`, resume, photo: true, marks: true }); }

type HtmlNode = { nodeName: string; tagName?: string; value?: string; attrs?: { name: string; value: string }[]; childNodes?: HtmlNode[] };
const getAttr = (node: HtmlNode, name: string) => node.attrs?.find(attribute => attribute.name === name)?.value;
const textOf = (node: HtmlNode): string => node.nodeName === '#text' ? node.value ?? '' : (node.childNodes ?? []).map(textOf).join('');
const nodesMatching = (node: HtmlNode, matches: (node: HtmlNode) => boolean): HtmlNode[] => [...(matches(node) ? [node] : []), ...(node.childNodes ?? []).flatMap(child => nodesMatching(child, matches))];
const report = [];
for (const fixture of cases) {
  const assets = fixture.photo ? { [fixture.resume.basics.avatarAssetId!]: preparedPhoto } : {};
  const html = renderResumeHtml(fixture.resume, assets);
  const document = parse(html) as HtmlNode;
  const body = nodesMatching(document, node => node.tagName === 'body')[0];
  const externalAssets = nodesMatching(document, node => ['img', 'script', 'link', 'iframe'].includes(node.tagName ?? '')).flatMap(node => {
    const url = getAttr(node, node.tagName === 'link' ? 'href' : 'src');
    return url && !url.startsWith('data:') ? [url] : [];
  });
  if (externalAssets.length) throw new Error(`Export depends on external assets: ${externalAssets.join(', ')}`);
  if (nodesMatching(document, node => node.tagName === 'script').length) throw new Error('Reading export includes executable script');
  const sections = nodesMatching(body, node => (getAttr(node, 'class') ?? '').split(' ').includes('resume-section'));
  const started = performance.now();
  const result = await renderResume(fixture.resume, assets, path.resolve('public/fonts').replaceAll('\\', '/'));
  await writeFile(path.join(output, `${fixture.id}.pdf`), result.bytes);
  await writeFile(path.join(output, `${fixture.id}.html`), html);
  await writeFile(path.join(output, `${fixture.id}.resume.json`), JSON.stringify(fixture.resume, null, 2) + '\n');
  await writeFile(path.join(output, `${fixture.id}.regions.json`), JSON.stringify(result.regions, null, 2) + '\n');
  report.push({ id: fixture.id, template: fixture.resume.appearance.templateId, font: fixture.resume.appearance.fontFamilyId, mode: fixture.resume.layout.mode, photo: Boolean(fixture.photo), marks: Boolean(fixture.marks), pages: result.pages, pdfBytes: result.bytes.length, htmlBytes: Buffer.byteLength(html), renderMs: Number((performance.now() - started).toFixed(1)), htmlLogicalGroups: nodesMatching(body, node => (getAttr(node, 'class') ?? '').split(' ').includes('layout-page')).length,
    expectedSections: sections.map(section => ({ id: getAttr(section, 'id'), text: textOf(section) })),
    hiddenSentinels: fixture.marks ? ['HiddenContactSentinel', 'HiddenContactValue', 'HiddenItemSentinel', 'HiddenBodySentinel'] : [],
  });
  console.log(`${fixture.id}: ${result.pages} pages, ${result.bytes.length} bytes`);
}
await writeFile(path.join(output, 'render-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Generated ${report.length} PDF/HTML pairs at ${output}`);
