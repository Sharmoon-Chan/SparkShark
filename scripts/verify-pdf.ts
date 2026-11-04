import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderResume } from '../src/rendering/pdf';
import { createExample, createResume, emptyRich, newItem, plainRich } from '../src/domain/resume';
import type { Resume, RichDocument } from '../src/domain/types';
import formats from '../docs/fixtures/richtext-format-example.json';

const root = process.cwd();
await mkdir(path.join(root, 'output/pdf'), { recursive: true });
const example = createExample('示例简历');
const first = example.layout.groups[0];
const projects = example.sections.find(section => section.kind === 'projects')!;
example.layout.groups = [{ ...first, main: [...first.main, projects.id] }];
const long = structuredClone(example);
const work = long.sections.find(section => section.kind === 'work');
if (work && work.kind === 'work') {
  work.items = Array.from({ length: 15 }, (_, index) => ({ ...newItem('work'), fields: { company: `分页测试公司 ${index + 1}`, position: '前端工程师', location: '示例城市', dateText: '2024.01—至今', url: 'https://example.com/work', summary: plainRich(`经历段落 ${index + 1}：林示例，电话号码 000-0000-0000。\n` + '中文内容应按完整行分页。持续改进界面体验、模块结构与可读性。'.repeat(20)) } }));
}
const formatResume = createResume('富文本格式测试');
formatResume.basics = { ...example.basics };
formatResume.layout.mode = 'single';
const summary = formatResume.sections.find(section => section.kind === 'summary');
if (summary?.kind === 'summary') summary.content = formats as RichDocument;
const blank = createResume('空白测试');
for (const section of blank.sections) if (section.kind === 'summary') section.content = emptyRich();
const cases: [string, Resume][] = [['m0-example', example], ['m0-long', long], ['m0-formats', formatResume], ['m0-blank', blank]];
const report = [];
for (const [name, resume] of cases) {
  const start = performance.now();
  const result = await renderResume(resume, {}, path.join(root, 'public/fonts').replaceAll('\\', '/'), (stage, ms) => console.log(JSON.stringify({ case: name, stage, ms: Math.round(ms) })));
  await writeFile(path.join(root, 'output/pdf', name + '.pdf'), result.bytes);
  report.push({ name, pages: result.pages, bytes: result.bytes.length, milliseconds: Math.round(performance.now() - start) });
  console.log(JSON.stringify(report.at(-1)));
}
await writeFile(path.join(root, 'output/pdf/m0-render-report.json'), JSON.stringify(report, null, 2) + '\n');
