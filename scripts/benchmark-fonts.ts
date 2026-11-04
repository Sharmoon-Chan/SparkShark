import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const local = createRequire(import.meta.url);
const renderer = createRequire(local.resolve('@react-pdf/renderer'));
const toolkit = createRequire(renderer.resolve('@react-pdf/font'))('fontkit');
for (const file of ['.tools/font-sources/old-woff/sans-400.woff', 'public/fonts/sans-400.ttf']) {
  const start = performance.now();
  const bytes = await readFile(file).catch(() => null);
  if (!bytes) { console.log(file, 'not cached, skipped'); continue; }
  const font = toolkit.create(bytes);
  console.log(file, 'font-create-ms', Math.round(performance.now() - start));
  const textStart = performance.now();
  for (let i = 0; i < 30; i++) font.layout('林示例 000-0000-0000 React TypeScript 中文排版和电话号码。');
  console.log('30-layouts-ms', Math.round(performance.now() - textStart));
}
