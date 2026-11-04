import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyTemplate, createExample, plainRich } from '../src/domain/resume';
import { movePreviewField } from '../src/domain/fieldDrop';
import { renderResume } from '../src/rendering/pdf';
import { renderResumeHtml } from '../src/rendering/html';

const root = process.cwd(), output = path.join(root, 'output/preview-drag');
await mkdir(output, { recursive: true });
const before = applyTemplate(createExample('预览字段拖动 · 虚构验证'), 'essential');
before.sections.forEach(section => { section.visible = section.kind === 'education'; });
const education = before.sections.find(section => section.kind === 'education')!;
if (education.kind !== 'education') throw new Error('education fixture');
education.items[0].fields = { ...education.items[0].fields, institution: '广州大学', major: '计算机专业', studyType: '本科', score: '', dateText: '', officialUrl: '', summary: plainRich('') };
const after = structuredClone(before), changed = after.sections.find(section => section.id === education.id)!;
changed.contentLayout = movePreviewField(changed, 'major', 'institution', 'after')!;
const below = structuredClone(after), movedDown = below.sections.find(section => section.id === education.id)!;
movedDown.contentLayout = movePreviewField(movedDown, 'major', 'institution', 'below')!;
const report = [];
for (const [id, resume] of [['before', before], ['after', after], ['below', below]] as const) {
  const result = await renderResume(resume, {}, path.join(root, 'public/fonts').replaceAll('\\', '/'));
  await writeFile(path.join(output, id + '.pdf'), result.bytes);
  await writeFile(path.join(output, id + '.fields.json'), JSON.stringify(result.fields, null, 2) + '\n');
  await writeFile(path.join(output, id + '.resume.json'), JSON.stringify(resume, null, 2) + '\n');
  await writeFile(path.join(output, id + '.html'), renderResumeHtml(resume));
  report.push({ id, pages: result.pages, fields: result.fields });
}
await writeFile(path.join(output, 'render-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
