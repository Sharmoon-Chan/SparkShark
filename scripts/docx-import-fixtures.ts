import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { docxFixture, headerFooterFixture, packDocx } from '../tests/fixtures/docx';

await mkdir('output/docx', { recursive: true });
const photo = new Uint8Array(await readFile('docs/fixtures/demo-avatar.png'));
await writeFile('output/docx/resume-example.docx', docxFixture(photo));
await writeFile('output/docx/resume-no-photo.docx', docxFixture());
await writeFile('output/docx/resume-header-footer.docx', headerFooterFixture());
await writeFile('output/docx/resume-empty.docx', packDocx('<w:p/>'));
await writeFile('output/docx/resume-broken.docx', 'broken Word file');
await writeFile('output/docx/resume-legacy.doc', 'legacy Word test');
await writeFile('output/docx/unsupported.bin', new Uint8Array([0, 1, 2, 3]));
console.log('DOCX import fixtures written to output/docx/');
