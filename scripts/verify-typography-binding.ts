// Synthetic reproduction of legacy project overrides beside inherited skills.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createExample, defaultAppearanceForTemplate, newItem, plainRich } from '../src/domain/resume';
import { defaultContentLayout } from '../src/domain/contentLayout';
import { resetResumeFontSizes, updatePageAppearance } from '../src/domain/typographyBinding';
import { renderResume } from '../src/rendering/pdf';
import { renderResumeHtml } from '../src/rendering/html';

const output = path.resolve('output/typography-binding');
await mkdir(output, { recursive: true });
const original = createExample('字号联动验证 · 合成样例');
original.appearance = { ...defaultAppearanceForTemplate('essential'), fontFamilyId: 'source-han-sans-sc', fontSizePx: 13 };
original.layout.mode = 'single';
original.basics.name = '字号联动样例'; original.basics.headline = '合成测试资料';
original.sections.forEach(section => { section.visible = ['projects', 'skills'].includes(section.kind); });
original.layout.groups = [{ ...original.layout.groups[0], main: original.sections.map(section => section.id), sidebar: [] }];
const projects = original.sections.find(section => section.kind === 'projects')!, skills = original.sections.find(section => section.kind === 'skills')!;
if (projects.kind !== 'projects' || skills.kind !== 'skills') throw new Error('Missing synthetic sections');
projects.titleOverride = '技术项目'; skills.titleOverride = '个人技能';
projects.items = [{ ...newItem('projects'), fields: { name: 'BindProjectTitle', description: 'BindProjectIntro 项目简介', dateText: '2024–2026', url: '', keywords: ['TypeScript', 'React'], summary: plainRich('BindProjectBody 项目正文与说明。') } }];
skills.items = [{ ...newItem('skills'), fields: { name: 'BindSkillTitle', description: 'BindSkillBody 个人技能与描述。', keywords: [], level: null } }];
for (const section of [projects, skills]) section.contentLayout = defaultContentLayout(section);
for (const [key, size] of [['name', 12.5], ['description', 10], ['summary', 12]] as const) projects.contentLayout!.fields.find(field => field.key === key)!.fontSizePx = size;
await writeFile(path.join(output, 'legacy-fixture.json'), JSON.stringify({ format: 'myresume', schemaVersion: 1, exportedAt: new Date().toISOString(), resumes: [original], assets: [] }, null, 2));
const linked = structuredClone(original); updatePageAppearance(linked, { fontSizePx: 16 });
const unified = structuredClone(original); resetResumeFontSizes(unified);
const enlarged = structuredClone(unified); updatePageAppearance(enlarged, { fontSizePx: 16 });
const report = [];
for (const [name, resume] of [['legacy-13', original], ['linked-16', linked], ['unified-13', unified], ['unified-16', enlarged]] as const) {
  const pdf = await renderResume(resume, {}, path.resolve('public/fonts').replaceAll('\\', '/'));
  await writeFile(path.join(output, `${name}.pdf`), pdf.bytes);
  await writeFile(path.join(output, `${name}.html`), renderResumeHtml(resume));
  await writeFile(path.join(output, `${name}.json`), JSON.stringify(resume, null, 2));
  report.push({ name, pageFontSizePx: resume.appearance.fontSizePx, pages: pdf.pages, bytes: pdf.bytes.length });
}
await writeFile(path.join(output, 'render-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
