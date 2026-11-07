import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { alignmentFixtures } from '../tests/fixtures/alignment';
import { parseResume } from '../src/domain/resume';
import { renderResume } from '../src/rendering/pdf';
import { renderResumeHtml } from '../src/rendering/html';

const output = path.resolve('output/preview-alignment');
await mkdir(output, { recursive: true });
const report = [];
for (const fixture of alignmentFixtures()) {
  parseResume(fixture.resume);
  const start = performance.now();
  const result = await renderResume(fixture.resume, {}, path.resolve('public/fonts').replaceAll('\\', '/'));
  const geometry = fixture.expected.map(expected => {
    const section = fixture.resume.sections.find(section => section.kind === expected.section)!;
    const fields = result.fields!.filter(field => field.sectionId === section.id && expected.keys.includes(field.fieldKey));
    if (fields.length !== expected.keys.length) return { ...expected, passed: false, error: 'Missing field coordinates' };
    const left = Math.min(...fields.map(field => field.x)), right = Math.max(...fields.map(field => field.x + field.width));
    let x = fields[0].columnX, width = fields[0].columnWidth;
    if (expected.slot) { const [index, count] = expected.slot; width = (width - (count - 1) * 6) / count; x += index * (width + 6); }
    const error = expected.alignment === 'left' ? left - x : expected.alignment === 'right' ? right - x - width : (left + right) / 2 - x - width / 2;
    return { ...expected, errorPt: Number(error.toFixed(3)), passed: Math.abs(error) < .6 };
  });
  await writeFile(path.join(output, fixture.id + '.pdf'), result.bytes);
  await writeFile(path.join(output, fixture.id + '.html'), renderResumeHtml(fixture.resume));
  await writeFile(path.join(output, fixture.id + '.fields.json'), JSON.stringify(result.fields, null, 2) + '\n');
  await writeFile(path.join(output, fixture.id + '.resume.json'), JSON.stringify(fixture.resume, null, 2) + '\n');
  const record = { id: fixture.id, pages: result.pages, renderMs: Math.round(performance.now() - start), geometry, paragraphs: fixture.paragraphs, repetitions: fixture.repetitions };
  report.push(record);
  console.log(JSON.stringify(record));
}
await writeFile(path.join(output, 'render-report.json'), JSON.stringify(report, null, 2) + '\n');
const sample = alignmentFixtures()[0].resume;
await writeFile(path.join(output, 'alignment-backup.json'), JSON.stringify({ format: 'myresume', schemaVersion: 1, exportedAt: new Date().toISOString(), resumes: [sample], assets: [] }) + '\n');
if (report.some(row => row.geometry.some(check => !check.passed))) process.exitCode = 1;
