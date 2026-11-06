import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { paginationFixtures } from '../tests/fixtures/pagination';
import { renderResume } from '../src/rendering/pdf';
import { FONT_OPTIONS } from '../src/domain/fonts';
import { createExample } from '../src/domain/resume';

const output = path.resolve('output/pagination-stage2');
await mkdir(output, { recursive: true });
const photo = new Uint8Array(await readFile('docs/fixtures/demo-avatar.png'));
const report = [];
const fixtures = [...paginationFixtures(), ...FONT_OPTIONS.map(font => { const resume = createExample(`字体验证 ${font.id}`); resume.appearance.fontFamilyId = font.id; return { id: `font-${font.id}`, resume, photo: false }; })];
for (const fixture of fixtures) {
  const started = performance.now();
  const result = await renderResume(fixture.resume, fixture.photo ? { 'pagination-photo': { data: photo, mime: 'image/png', width: 160, height: 200 } } : {}, path.resolve('public/fonts').replaceAll('\\', '/'));
  await writeFile(path.join(output, `${fixture.id}.pdf`), result.bytes);
  await writeFile(path.join(output, `${fixture.id}.json`), JSON.stringify(fixture.resume, null, 2));
  report.push({ id: fixture.id, pdfPages: result.pages, bytes: result.bytes.byteLength, durationMs: performance.now() - started });
  console.log(fixture.id, result.pages, 'PDF pages');
}
await writeFile(path.join(output, 'pdf-report.json'), JSON.stringify(report, null, 2));
