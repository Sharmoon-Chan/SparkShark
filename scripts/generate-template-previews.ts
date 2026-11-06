import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyTemplate, createExample, newItem, plainRich } from '../src/domain/resume';
import { TEMPLATES } from '../src/domain/templates';
import type { ItemKind, PreparedAsset, Resume } from '../src/domain/types';
import { renderResume } from '../src/rendering/pdf';

// These illustrations are generated offline from this fixed synthetic fixture.
// The production template browser must never render a visitor's resume for cards.
const root = process.cwd();
const intermediate = path.join(root, 'output/static-template-previews');
const destination = path.join(root, 'src/features/appearance/template-previews');
await mkdir(intermediate, { recursive: true });
await mkdir(destination, { recursive: true });

function sampleResume(): Resume {
  const resume = createExample('模板示意 · 虚构内容');
  Object.assign(resume.basics, {
    name: '林示例', headline: '前端开发工程师', email: 'hello@example.com',
    phone: '000-0000-0000', website: '', location: '示例城市',
    avatarAssetId: 'template-demo-avatar', customFields: [],
  });
  const visible = new Set(['summary', 'work', 'projects', 'education', 'skills', 'languages']);
  for (const section of resume.sections) {
    section.visible = visible.has(section.kind);
    delete section.contentLayout;
    if (section.kind === 'summary') section.content = plainRich('围绕用户体验构建清晰可靠的产品，注重团队协作、工程质量与持续改进。');
    else section.items = [];
  }
  const add = (kind: ItemKind, fields: ReturnType<typeof newItem>['fields']) => {
    const section = resume.sections.find(section => section.kind === kind)!;
    if (section.kind === 'summary' || section.kind === 'custom') throw new Error('Invalid fixture section');
    const item = newItem(kind);
    section.items.push({ ...item, fields: { ...item.fields, ...fields } });
  };
  add('work', { company: '示例科技有限公司', position: '前端开发工程师', location: '示例城市', dateText: '2023.07—至今', summary: plainRich(`负责核心产品的交互与页面开发，搭建可复用组件。
与设计和产品团队协作，持续提升体验及交付质量。`) });
  add('projects', { name: '团队协作管理平台', description: '统一任务、文档与项目进度', dateText: '2024.03—2024.10', keywords: ['React', 'TypeScript'], summary: plainRich(`设计清晰的信息结构与共享组件，支持多人协作。
优化页面响应和关键流程，形成可维护的工程实践。`) });
  add('education', { institution: '示例大学', major: '软件工程', studyType: '本科', dateText: '2019.09—2023.06', summary: plainRich('系统学习计算机基础、软件设计与团队工程实践。') });
  add('skills', { name: '前端开发', description: 'TypeScript · React', level: 4 });
  add('skills', { name: '工程实践', description: '组件化 · 自动化测试', level: 4 });
  add('skills', { name: '产品协作', description: '设计系统 · 体验优化', level: 3 });
  add('languages', { name: '中文', description: '母语', level: 5 });
  add('languages', { name: '英语', description: '工作交流', level: 4 });
  const id = (kind: string) => resume.sections.find(section => section.kind === kind)!.id;
  resume.layout.groups = [{ id: 'template-sample-page', main: ['summary', 'work', 'projects', 'education'].map(id), sidebar: ['skills', 'languages'].map(id) }];
  resume.appearance.avatar = { ...resume.appearance.avatar, visible: true, crop: null };
  Object.assign(resume.appearance, { fontSizePx: 12.5, lineHeight: 1.35, spacingScale: .85 });
  return resume;
}

const sample = sampleResume();
const photo = await readFile(path.join(root, 'docs/fixtures/demo-avatar.png'));
const assets: Record<string, PreparedAsset> = { 'template-demo-avatar': { data: photo, mime: 'image/png', width: photo.readUInt32BE(16), height: photo.readUInt32BE(20) } };
for (const template of TEMPLATES) {
  const candidate = applyTemplate(sample, template.id);
  const result = await renderResume(candidate, assets, path.join(root, 'public/fonts').replaceAll('\\', '/'));
  if (result.pages !== 1) throw new Error(`${template.id}: synthetic preview must fit one page (${result.pages})`);
  const pdfPath = path.join(intermediate, `${template.id}.pdf`);
  await writeFile(pdfPath, result.bytes);
  execFileSync(process.env.PDFTOPPM ?? 'pdftoppm', ['-f', '1', '-singlefile', '-scale-to-x', '480', '-scale-to-y', '-1', '-png', pdfPath, path.join(intermediate, template.id)], { stdio: ['ignore', 'ignore', 'pipe'] });
}
await writeFile(path.join(intermediate, 'catalog.json'), JSON.stringify(TEMPLATES.map(template => ({ id: template.id, name: template.name })), null, 2));
execFileSync(process.env.TEMPLATE_PREVIEW_PYTHON ?? 'python', [path.join(root, 'scripts/encode-template-previews.py'), intermediate, destination], { stdio: 'inherit' });
