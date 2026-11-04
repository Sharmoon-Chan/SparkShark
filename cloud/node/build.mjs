import { build } from 'esbuild';
import { cp, lstat, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(project, 'output');
const target = path.join(output, 'node-backend');
const source = path.join(project, 'dist');
const within = (parent, value) => {
  const relative = path.relative(parent, value);
  return relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
};

const sourceInfo = await lstat(source);
if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error('Run the ordinary frontend build before the Node bundle build');
await mkdir(output, { recursive: true });
if ((await lstat(output)).isSymbolicLink() || !within(await realpath(project), await realpath(output))) throw new Error('Unsafe output directory');
try {
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink() || path.resolve(target) !== path.join(path.resolve(output), 'node-backend') ||
      !within(await realpath(output), await realpath(target))) throw new Error('Unsafe Node bundle cleanup directory');
  await rm(path.resolve(target), { recursive: true, force: true });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(target, { recursive: true });
for (const [entry, filename] of [['server.ts', 'server.mjs'], ['api-worker.ts', 'api-worker.mjs']]) {
  await build({ entryPoints: [path.join(project, 'cloud', 'node', entry)], outfile: path.join(target, filename),
    bundle: true, platform: 'node', format: 'esm', target: 'node24', sourcemap: true,
    packages: 'bundle', external: ['node:*'], logLevel: 'warning' });
}
await cp(source, path.join(target, 'public'), { recursive: true, dereference: false });
await cp(path.join(project, 'cloud', 'migrations'), path.join(target, 'migrations'), { recursive: true });
await cp(path.join(project, 'cloud', 'node', '.env.example'), path.join(target, '.env.example'));
await cp(path.join(project, 'cloud', 'node', 'README.md'), path.join(target, 'README.md'));
await writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'myresume-node-backend', private: true,
  type: 'module', engines: { node: '>=24' }, scripts: { start: 'node server.mjs' } }, null, 2) + '\n');
console.log(`Node-only backend bundle prepared at ${target}; no runtime npm dependencies or remote resources.`);
