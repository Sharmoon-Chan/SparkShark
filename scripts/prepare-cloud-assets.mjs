import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLOUD_ASSET_LIMIT = 25 * 1024 * 1024;
export const FONT_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_FONT_BYTES = 256 * 1024 * 1024;
const MAX_FONTS = 64;
const MANIFEST_LIMIT = 128 * 1024;
const MANIFEST_NAME = 'cloud-font-parts.json';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function inside(parent, target) {
  const relative = path.relative(parent, target);
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Asset path must remain inside the build directory: ${target}`);
  }
  return target;
}

function validFontPath(value) {
  return typeof value === 'string' && /^\/fonts\/[A-Za-z0-9][A-Za-z0-9_.-]{0,159}\.ttf$/.test(value) && !value.includes('..');
}

export function fontPartPath(fontPath, sha256, index) {
  return `/fonts/.cloud-parts/${path.posix.basename(fontPath)}.${sha256}.${String(index).padStart(3, '0')}.part.bin`;
}

function validateManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1 ||
      Object.keys(input).some(key => !['version', 'fonts'].includes(key)) ||
      !input.fonts || typeof input.fonts !== 'object' || Array.isArray(input.fonts) || Object.keys(input.fonts).length > MAX_FONTS) {
    throw new Error('Invalid cloud font manifest');
  }
  for (const [fontPath, font] of Object.entries(input.fonts)) {
    if (!validFontPath(fontPath) || !font || typeof font !== 'object' || Array.isArray(font) ||
        Object.keys(font).some(key => !['sha256', 'bytes', 'chunks'].includes(key)) ||
        !/^[a-f0-9]{64}$/.test(font.sha256) || !Number.isSafeInteger(font.bytes) ||
        font.bytes <= CLOUD_ASSET_LIMIT || font.bytes > MAX_FONT_BYTES || !Array.isArray(font.chunks) ||
        font.chunks.length !== Math.ceil(font.bytes / FONT_CHUNK_BYTES)) throw new Error('Invalid cloud font entry');
    let bytes = 0;
    font.chunks.forEach((chunk, index) => {
      const expectedBytes = Math.min(FONT_CHUNK_BYTES, font.bytes - index * FONT_CHUNK_BYTES);
      if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk) ||
          Object.keys(chunk).some(key => !['path', 'bytes'].includes(key)) ||
          chunk.path !== fontPartPath(fontPath, font.sha256, index) || chunk.bytes !== expectedBytes) {
        throw new Error('Invalid cloud font chunk');
      }
      bytes += chunk.bytes;
    });
    if (bytes !== font.bytes) throw new Error('Cloud font size mismatch');
  }
  return input;
}

async function regularFile(distRoot, target) {
  inside(distRoot, path.resolve(target));
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected regular build asset: ${target}`);
  inside(distRoot, await realpath(target));
  return info;
}

async function inspectTree(distRoot, directory = distRoot) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = inside(distRoot, path.resolve(directory, entry.name));
    if (entry.isSymbolicLink()) throw new Error('Build asset symlinks are not supported');
    if (entry.isDirectory()) files.push(...await inspectTree(distRoot, target));
    else {
      const info = await regularFile(distRoot, target);
      const assetPath = '/' + path.relative(distRoot, target).split(path.sep).join('/');
      files.push({ target, assetPath, info });
    }
  }
  return files;
}

async function hashFile(target) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(target, { highWaterMark: 1024 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyParts(distRoot, font) {
  const hash = createHash('sha256');
  for (const chunk of font.chunks) {
    const target = inside(distRoot, path.resolve(distRoot, '.' + chunk.path));
    const info = await regularFile(distRoot, target);
    if (info.size !== chunk.bytes) throw new Error('Cloud font chunk size mismatch');
    for await (const bytes of createReadStream(target, { highWaterMark: 1024 * 1024 })) hash.update(bytes);
  }
  if (hash.digest('hex') !== font.sha256) throw new Error('Cloud font reassembly SHA256 mismatch');
}

async function packStageAssets(distRoot) {
  const files = await inspectTree(distRoot);
  const oversized = files.filter(file => file.info.size > CLOUD_ASSET_LIMIT);
  if (oversized.some(file => !validFontPath(file.assetPath) || file.info.size > MAX_FONT_BYTES) || oversized.length > MAX_FONTS) {
    throw new Error('An oversized build asset is not a supported TTF font');
  }
  const manifestFile = inside(distRoot, path.join(distRoot, MANIFEST_NAME));
  let manifest = { version: 1, fonts: {} };
  try {
    const info = await regularFile(distRoot, manifestFile);
    if (info.size > MANIFEST_LIMIT) throw new Error('Cloud font manifest is too large');
    manifest = validateManifest(JSON.parse(await readFile(manifestFile, 'utf8')));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (oversized.length) {
    const partsDir = inside(distRoot, path.join(distRoot, 'fonts', '.cloud-parts'));
    await mkdir(partsDir, { recursive: true });
    const partsInfo = await lstat(partsDir);
    if (!partsInfo.isDirectory() || partsInfo.isSymbolicLink()) throw new Error('Font parts directory must be a real directory');
    inside(distRoot, await realpath(partsDir));
    for (const source of oversized) {
      const sha256 = await hashFile(source.target);
      const font = { sha256, bytes: source.info.size, chunks: [] };
      const input = await open(source.target, 'r');
      try {
        for (let offset = 0, index = 0; offset < font.bytes; offset += FONT_CHUNK_BYTES, index++) {
          const bytes = Math.min(FONT_CHUNK_BYTES, font.bytes - offset);
          const buffer = Buffer.allocUnsafe(bytes);
          let read = 0;
          while (read < bytes) {
            const result = await input.read(buffer, read, bytes - read, offset + read);
            if (!result.bytesRead) throw new Error('Font changed while packaging');
            read += result.bytesRead;
          }
          const assetPath = fontPartPath(source.assetPath, sha256, index);
          const target = inside(distRoot, path.resolve(distRoot, '.' + assetPath));
          try { await regularFile(distRoot, target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          await writeFile(target, buffer);
          font.chunks.push({ path: assetPath, bytes });
        }
      } finally { await input.close(); }
      await verifyParts(distRoot, font);
      manifest.fonts[source.assetPath] = font;
    }
  }
  validateManifest(manifest);
  for (const font of Object.values(manifest.fonts)) await verifyParts(distRoot, font);
  const json = JSON.stringify(manifest, null, 2) + '\n';
  if (Buffer.byteLength(json) > MANIFEST_LIMIT) throw new Error('Cloud font manifest is too large');
  // Publish all mappings before removing any original build file, making interruption recoverable.
  const temporary = inside(distRoot, path.join(distRoot, `.${MANIFEST_NAME}.${randomUUID()}.tmp`));
  await writeFile(temporary, json, { flag: 'wx' });
  await rename(temporary, manifestFile);
  for (const source of oversized) {
    const current = await regularFile(distRoot, source.target);
    if (current.ino !== source.info.ino || current.dev !== source.info.dev || current.size !== source.info.size || current.mtimeMs !== source.info.mtimeMs) {
      throw new Error('Original build font changed before deletion');
    }
    // Both resolved and real paths were checked within the stage; original dist/public fonts are never touched.
    await unlink(source.target);
  }
  const remaining = await inspectTree(distRoot);
  if (remaining.some(file => file.info.size > CLOUD_ASSET_LIMIT)) throw new Error('Build still contains an asset above 25 MiB');
  const result = { fonts: Object.keys(manifest.fonts).length,
    chunks: Object.values(manifest.fonts).reduce((total, font) => total + font.chunks.length, 0),
    maxAssetBytes: Math.max(0, ...remaining.map(file => file.info.size)) };
  return result;
}

export async function prepareCloudAssets(distDir = path.join(root, 'dist'), stageDirectory) {
  const resolved = path.resolve(distDir);
  if (path.basename(resolved).toLowerCase() !== 'dist') throw new Error('Font packaging accepts only a source directory named dist');
  const sourceInfo = await lstat(resolved);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error('Source build directory must be a real directory, not a symlink');
  const sourceRoot = await realpath(resolved);
  const workspace = path.dirname(sourceRoot);
  const output = inside(workspace, path.resolve(workspace, 'output'));
  const expected = inside(output, path.resolve(output, 'cloud-assets'));
  const stage = path.resolve(stageDirectory ?? expected);
  if (stage !== expected || path.basename(stage) !== 'cloud-assets') throw new Error('Cloud stage must be the workspace/output/cloud-assets directory');
  // Inspect the source before deleting the previous stage. Symlinks are never followed/copied.
  const sourceFiles = await inspectTree(sourceRoot);
  if (sourceFiles.some(file => file.info.size > CLOUD_ASSET_LIMIT && (!validFontPath(file.assetPath) || file.info.size > MAX_FONT_BYTES))) {
    throw new Error('An oversized source build asset is not a supported TTF font');
  }
  await mkdir(output, { recursive: true });
  const outputInfo = await lstat(output);
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()) throw new Error('Output must be a real workspace directory');
  inside(workspace, await realpath(output));
  try {
    const stageInfo = await lstat(stage);
    if (!stageInfo.isDirectory() || stageInfo.isSymbolicLink()) throw new Error('Cloud stage must be a real directory');
    inside(output, await realpath(stage));
    // Exact absolute path, fixed name, real path, and containment checked immediately before recursive deletion.
    if (path.resolve(stage) !== expected || path.dirname(stage) !== output) throw new Error('Unsafe cloud stage cleanup path');
    await rm(stage, { recursive: true, force: true });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await cp(sourceRoot, stage, { recursive: true, force: true, dereference: false });
  const result = await packStageAssets(await realpath(stage));
  return { ...result, directory: stage };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareCloudAssets().then(result => {
    console.log(`Cloud assets prepared: ${result.fonts} lossless fonts, ${result.chunks} chunks; largest static asset ${(result.maxAssetBytes / 1024 / 1024).toFixed(2)} MiB.`);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
