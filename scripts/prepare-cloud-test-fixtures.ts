import { mkdir, writeFile } from 'node:fs/promises';
import { createResume } from '../src/domain/resume';

await mkdir('output/playwright', { recursive: true });
await writeFile('output/playwright/cloud-batch.json', JSON.stringify({
  format: 'myresume', schemaVersion: 1, exportedAt: new Date().toISOString(),
  resumes: [createResume('批量云端验收甲', 'zh-CN'), createResume('批量云端验收乙', 'zh-CN')], assets: [],
}));
console.log('Synthetic batch fixture written to output/playwright/cloud-batch.json');
