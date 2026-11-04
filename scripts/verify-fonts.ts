import { createElement } from 'react';
import { Document, Page, Text, renderToBuffer } from '@react-pdf/renderer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import manifest from '../public/fonts/manifest.json';
import { FONT_OPTIONS } from '../src/domain/fonts';
import { createExample } from '../src/domain/resume';
import { checkGlyphs, fontFamily, registerFonts } from '../src/rendering/fonts';

const folder = resolve('output/font-review');
await mkdir(folder, { recursive: true });
registerFonts(resolve('public/fonts'));
const sample = '林示例 · 专业技能 • 工作经历 2026\n中文、繁體中文；Resume & Portfolio — React / TypeScript';
const report: { id: string; bytes: number; pdfBytes: number; renderMs: number; faces: string[] }[] = [];

for (const option of FONT_OPTIONS) {
  const family = manifest.families[option.id];
  let bytes = 0;
  for (const file of family.files) {
    const data = await readFile(resolve('public/fonts', file.file)); bytes += data.length;
    if (createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error(`Font checksum mismatch: ${file.file}`);
  }
  const resume = createExample(); resume.appearance.fontFamilyId = option.id; checkGlyphs(resume);
  const faces = family.files.map(file => `${file.weight}:${file.style}`);
  const start = performance.now();
  const pdf = await renderToBuffer(createElement(Document, { title: option.label }, createElement(Page, { size: 'A4', style: { padding: 36, fontFamily: fontFamily(option.id), fontSize: 16, lineHeight: 1.5 } },
    createElement(Text, { style: { fontWeight: 700, marginBottom: 24 } }, option.label),
    ...family.files.map(file => createElement(Text, { key: `${file.weight}:${file.style}`, style: { fontWeight: file.weight, fontStyle: file.style as 'normal' | 'italic', marginBottom: 24 } }, `${file.weight} ${file.style}\n${sample}`)),
  )));
  const renderMs = Math.round(performance.now() - start);
  await writeFile(resolve(folder, `${option.id}.pdf`), pdf);
  report.push({ id: option.id, bytes, pdfBytes: pdf.length, renderMs, faces });
  console.log(option.id, `${(bytes / 1024 / 1024).toFixed(1)} MiB`, `${pdf.length} PDF bytes`, `${renderMs} ms`, faces.join(', '));
}
await writeFile(resolve(folder, 'report.json'), JSON.stringify(report, null, 2) + '\n');
