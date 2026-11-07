// Split the validated source catalog without rebuilding or changing font bytes.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fonts = fileURLToPath(new URL('../public/fonts/', import.meta.url));
const source = JSON.parse(await readFile(path.join(fonts, 'browser-manifest.json'), 'utf8'));
if (source.version !== 1 || !source.families) throw new Error('Unsupported browser font catalog');
const directory = path.join(fonts, 'browser-manifests');
await mkdir(directory, { recursive: true });
for (const [id, family] of Object.entries(source.families)) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error('Invalid font family ID');
  await writeFile(path.join(directory, `${id}.json`), JSON.stringify({ version: 1, families: { [id]: family } }) + '\n');
}
console.log(`Prepared ${Object.keys(source.families).length} individual browser font catalogs.`);
