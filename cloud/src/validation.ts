import { Buffer } from 'node:buffer';
import { parseResume } from '../../src/domain/resume';
import type { BackupAsset, Resume } from '../../src/domain/types';
import { ApiError, MAX_ASSET_BYTES, MAX_BODY_BYTES, MAX_CONTENT_BYTES, MAX_QUOTA, sha256 } from './security';

export interface PreparedCloudAsset extends Omit<BackupAsset, 'dataBase64'> { data: Uint8Array; }
export interface PreparedWrite {
  resume: Resume;
  json: string;
  assets: PreparedCloudAsset[];
  byteSize: number;
  expectedRevision?: number;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'INVALID_BODY', '请求数据必须是对象');
  return value as Record<string, unknown>;
}

export function allowedKeys(value: Record<string, unknown>, keys: string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new ApiError(400, 'INVALID_BODY', '请求包含不支持的字段');
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
    throw new ApiError(415, 'JSON_REQUIRED', '请使用 JSON 请求');
  }
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    throw new ApiError(413, 'BODY_TOO_LARGE', '上传内容超过 8 MiB');
  }
  if (!request.body) throw new ApiError(400, 'INVALID_BODY', '请求数据为空');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let count = 0, text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError(413, 'BODY_TOO_LARGE', '上传内容超过 8 MiB');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const value = JSON.parse(text) as unknown;
    validateTreeSize(value);
    return object(value);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'INVALID_JSON', '请求 JSON 无效');
  } finally { reader.releaseLock(); }
}

// Bound depth before a recursive schema validator sees untrusted JSON.
function validateTreeSize(value: unknown): void {
  const queue: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;
  while (queue.length) {
    const current = queue.pop()!;
    if (++nodes > 100000 || current.depth > 64) throw new ApiError(400, 'INVALID_BODY', '数据结构过于复杂');
    if (current.value && typeof current.value === 'object') {
      for (const child of Object.values(current.value)) queue.push({ value: child, depth: current.depth + 1 });
    }
  }
}

export function quota(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_QUOTA) {
    throw new ApiError(400, 'INVALID_QUOTA', `配额需为 0–${MAX_QUOTA} 的整数`);
  }
  return value;
}

export function expectedRevision(value: unknown, required = true): number | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ApiError(400, 'REVISION_REQUIRED', '请提供有效的云端版本号');
  }
  return value;
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 160 || /[\u0000-\u001f]/.test(value)) {
    throw new ApiError(400, 'INVALID_ASSET', '照片标识无效');
  }
  return value;
}

function dimensions(data: Buffer, mime: string): { width: number; height: number } {
  if (mime === 'image/png') {
    if (data.length < 24 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        data.readUInt32BE(8) !== 13 || data.subarray(12, 16).toString() !== 'IHDR') {
      throw new ApiError(400, 'INVALID_ASSET', 'PNG 照片格式无效');
    }
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) throw new ApiError(400, 'INVALID_ASSET', 'JPEG 照片格式无效');
  let offset = 2;
  const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset + 3 < data.length) {
    if (data[offset] !== 0xff) break;
    while (offset < data.length && data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > data.length) break;
    const size = data.readUInt16BE(offset);
    if (size < 2 || offset + size > data.length) break;
    if (sof.has(marker) && size >= 8) return { height: data.readUInt16BE(offset + 3), width: data.readUInt16BE(offset + 5) };
    offset += size;
  }
  throw new ApiError(400, 'INVALID_ASSET', 'JPEG 照片缺少有效尺寸');
}

async function prepareAsset(raw: unknown): Promise<PreparedCloudAsset> {
  const input = object(raw);
  allowedKeys(input, ['id', 'mime', 'width', 'height', 'sha256', 'dataBase64']);
  const id = identifier(input.id);
  if (!['image/png', 'image/jpeg'].includes(input.mime as string)) throw new ApiError(400, 'INVALID_ASSET', '只支持 PNG 或 JPEG 照片');
  if (typeof input.dataBase64 !== 'string' || !input.dataBase64.length || input.dataBase64.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4 ||
      !validBase64(input.dataBase64)) {
    throw new ApiError(413, 'ASSET_TOO_LARGE', '照片需为有效 Base64，且原始大小不得超过 5 MiB');
  }
  const data = Buffer.from(input.dataBase64, 'base64');
  if (!data.length || data.length > MAX_ASSET_BYTES) throw new ApiError(413, 'ASSET_TOO_LARGE', '照片原始大小不得超过 5 MiB');
  const size = dimensions(data, input.mime as string);
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width !== size.width || input.height !== size.height ||
      size.width < 1 || size.height < 1 || size.width > 12000 || size.height > 12000) {
    throw new ApiError(400, 'INVALID_ASSET', '照片尺寸无效');
  }
  const hash = await sha256(data);
  if (typeof input.sha256 !== 'string' || input.sha256.toLowerCase() !== hash) throw new ApiError(400, 'INVALID_ASSET', '照片校验失败');
  return { id, mime: input.mime as BackupAsset['mime'], width: size.width, height: size.height, sha256: hash, data };
}

// A repeated quartet regex exhausts the JS regexp stack on valid multi-MiB images.
// Keep alphabet and terminal-padding checks linear, without recursive repetition.
function validBase64(value: string): boolean {
  if (value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(value)) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return value.indexOf('=') === (padding ? value.length - padding : -1);
}

export async function prepareWrite(body: Record<string, unknown>, update: boolean, pathId?: string): Promise<PreparedWrite> {
  allowedKeys(body, ['resume', 'assets', 'expectedRevision']);
  let resume: Resume;
  try { resume = parseResume(body.resume); } catch { throw new ApiError(400, 'INVALID_RESUME', '简历数据格式或结构无效'); }
  if (pathId && resume.id !== pathId) throw new ApiError(400, 'RESUME_ID_MISMATCH', '简历标识与保存地址不一致');
  if (update) expectedRevision(body.expectedRevision);
  else if (body.expectedRevision !== undefined && body.expectedRevision !== 0) {
    throw new ApiError(400, 'INVALID_REVISION', '新简历不能携带已有云端版本');
  }
  resume.updatedAt = new Date().toISOString();
  const json = JSON.stringify(resume);
  const contentSize = new TextEncoder().encode(json).byteLength;
  if (contentSize > MAX_CONTENT_BYTES) throw new ApiError(413, 'RESUME_TOO_LARGE', '简历正文超过 512 KiB');
  if (!Array.isArray(body.assets) || body.assets.length > 1) throw new ApiError(400, 'INVALID_ASSETS', '请仅上传简历引用的照片');
  const avatarId = resume.basics.avatarAssetId;
  if ((avatarId === null && body.assets.length !== 0) || (avatarId !== null && body.assets.length !== 1)) {
    throw new ApiError(400, 'MISSING_ASSET', '照片引用和上传内容不一致');
  }
  const assets = await Promise.all(body.assets.map(prepareAsset));
  if (assets.some(asset => asset.id !== avatarId)) throw new ApiError(400, 'INVALID_ASSETS', '照片未被当前简历引用');
  return { resume, json, assets, byteSize: contentSize + assets.reduce((sum, asset) => sum + asset.data.byteLength, 0),
    expectedRevision: update ? body.expectedRevision as number : undefined };
}
