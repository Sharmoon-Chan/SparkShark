import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

await mkdir('output/pdf', { recursive: true });
const scan = await PDFDocument.create();
const image = await scan.embedPng(await readFile('docs/fixtures/demo-avatar.png'));
const page = scan.addPage([595.2756, 841.8898]);
page.drawImage(image, { x: 70, y: 130, width: 455, height: 455 });
await writeFile('output/pdf/pdf-import-scan.pdf', await scan.save());
await writeFile('output/pdf/pdf-import-broken.pdf', '%PDF-1.7\nThis is not a complete PDF.');
console.log('PDF import edge-case fixtures ready');
