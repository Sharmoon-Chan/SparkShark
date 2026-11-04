import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.join(root, 'public', 'pdf-assets');
await mkdir(destination, { recursive: true });
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(path.join(root, 'node_modules', 'pdfjs-dist', folder), path.join(destination, folder), { recursive: true, force: true });
}
