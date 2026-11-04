import { Buffer } from 'node:buffer';
import type { BackupAsset, Resume } from '../../src/domain/types';
import type { CloudResumeDocument, CloudResumeList, CloudResumeSummary } from '../../src/cloud/types';
import type { ApiResult } from './auth';
import type { Env } from './security';
import { ApiError, ASSET_CHUNK_BYTES, MAX_ASSET_BYTES, requireUser, userById } from './security';
import { allowedKeys, expectedRevision, prepareWrite, readBody } from './validation';
import type { PreparedWrite } from './validation';

interface ResumeRow {
  id: string;
  title: string;
  data_json: string;
  revision: number;
  byte_size: number;
  updated_at: string;
}

export async function listResumes(request: Request, env: Env): Promise<ApiResult> {
  const who = await requireUser(request, env);
  const result = await env.DB.prepare('SELECT id, title, updated_at, revision, byte_size FROM resumes WHERE user_id = ? ORDER BY updated_at DESC, id')
    .bind(who.user.id).all<ResumeRow>();
  const resumes: CloudResumeSummary[] = result.results.map(row => ({ id: row.id, title: row.title,
    updatedAt: row.updated_at, revision: Number(row.revision), byteSize: Number(row.byte_size) }));
  return { body: { resumes, quota: who.user.resume_quota, used: resumes.length,
    storageBytes: resumes.reduce((sum, row) => sum + row.byteSize, 0) } satisfies CloudResumeList };
}

function blobBuffer(value: number[] | ArrayBuffer | Uint8Array): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return Buffer.from(value);
}

async function document(env: Env, userId: string, id: string): Promise<CloudResumeDocument> {
  const snapshot = await env.DB.batch([
    env.DB.prepare('SELECT * FROM resumes WHERE user_id = ? AND id = ?').bind(userId, id),
    env.DB.prepare('SELECT * FROM resume_assets WHERE user_id = ? AND resume_id = ? ORDER BY asset_id').bind(userId, id),
    env.DB.prepare(`SELECT asset_id, chunk_no, data FROM resume_asset_chunks
      WHERE user_id = ? AND resume_id = ? ORDER BY asset_id, chunk_no`).bind(userId, id),
  ]);
  const row = snapshot[0].results[0] as unknown as ResumeRow | undefined;
  if (!row) throw new ApiError(404, 'RESUME_NOT_FOUND', '云端简历不存在');
  const metadata = snapshot[1].results as unknown as { asset_id: string; mime: BackupAsset['mime']; width: number; height: number; sha256: string; byte_size: number }[];
  const allChunks = snapshot[2].results as unknown as { asset_id: string; chunk_no: number; data: number[] | ArrayBuffer | Uint8Array }[];
  const assets: BackupAsset[] = [];
  for (const asset of metadata) {
    const chunks = allChunks.filter(chunk => chunk.asset_id === asset.asset_id);
    if (chunks.some((chunk, index) => chunk.chunk_no !== index) || !chunks.length) {
      throw new ApiError(500, 'ASSET_CORRUPT', '云端照片不完整，请联系管理员');
    }
    const data = Buffer.concat(chunks.map(chunk => blobBuffer(chunk.data)));
    if (data.byteLength !== asset.byte_size || data.byteLength > MAX_ASSET_BYTES) throw new ApiError(500, 'ASSET_CORRUPT', '云端照片不完整，请联系管理员');
    assets.push({ id: asset.asset_id, mime: asset.mime, width: asset.width, height: asset.height,
      sha256: asset.sha256, dataBase64: data.toString('base64') });
  }
  return { resume: JSON.parse(row.data_json) as Resume, assets, revision: Number(row.revision), byteSize: Number(row.byte_size) };
}

function writtenDocument(write: PreparedWrite, revision: number): CloudResumeDocument {
  return { resume: write.resume, assets: write.assets.map(asset => ({ id: asset.id, mime: asset.mime,
    width: asset.width, height: asset.height, sha256: asset.sha256, dataBase64: Buffer.from(asset.data).toString('base64') })),
    revision, byteSize: write.byteSize };
}

export async function getResume(request: Request, env: Env, id: string): Promise<ApiResult> {
  const who = await requireUser(request, env);
  return { body: await document(env, who.user.id, id) };
}

function assetStatements(env: Env, userId: string, id: string, nonce: string, write: PreparedWrite): D1PreparedStatement[] {
  const guard = 'EXISTS (SELECT 1 FROM resumes WHERE user_id = ? AND id = ? AND mutation_nonce = ?)';
  const statements: D1PreparedStatement[] = [env.DB.prepare(`DELETE FROM resume_assets WHERE user_id = ? AND resume_id = ? AND ${guard}`)
    .bind(userId, id, userId, id, nonce)];
  for (const asset of write.assets) {
    statements.push(env.DB.prepare(`INSERT INTO resume_assets
      (user_id, resume_id, asset_id, mime, width, height, sha256, byte_size)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`)
      .bind(userId, id, asset.id, asset.mime, asset.width, asset.height, asset.sha256, asset.data.byteLength, userId, id, nonce));
    for (let offset = 0, chunkNo = 0; offset < asset.data.byteLength; offset += ASSET_CHUNK_BYTES, chunkNo++) {
      const bytes = asset.data.subarray(offset, Math.min(offset + ASSET_CHUNK_BYTES, asset.data.byteLength));
      const chunk = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      statements.push(env.DB.prepare(`INSERT INTO resume_asset_chunks (user_id, resume_id, asset_id, chunk_no, data)
        SELECT ?, ?, ?, ?, ? WHERE ${guard}`).bind(userId, id, asset.id, chunkNo, chunk, userId, id, nonce));
    }
  }
  return statements;
}

export async function createResume(request: Request, env: Env): Promise<ApiResult> {
  const who = await requireUser(request, env);
  const write = await prepareWrite(await readBody(request), false);
  const id = write.resume.id, nonce = crypto.randomUUID(), now = new Date().toISOString();
  // Quota, active status, and insert are evaluated in one statement. No count/insert race.
  const insert = env.DB.prepare(`INSERT INTO resumes
    (user_id, id, title, data_json, revision, byte_size, mutation_nonce, created_at, updated_at)
    SELECT u.id, ?, ?, ?, 1, ?, ?, ?, ? FROM users u
    WHERE u.id = ? AND u.status = 'active'
      AND (SELECT COUNT(*) FROM resumes WHERE user_id = u.id) < u.resume_quota
    ON CONFLICT(user_id, id) DO NOTHING`)
    .bind(id, write.resume.title, write.json, write.byteSize, nonce, now, now, who.user.id);
  const result = await env.DB.batch([insert, ...assetStatements(env, who.user.id, id, nonce, write)]);
  if (!result[0].meta.changes) {
    const user = await userById(env, who.user.id);
    if (!user || user.status !== 'active') throw new ApiError(401, 'UNAUTHENTICATED', '账户已停用');
    const existing = await env.DB.prepare('SELECT 1 FROM resumes WHERE user_id = ? AND id = ?').bind(who.user.id, id).first();
    if (existing) throw new ApiError(409, 'RESUME_EXISTS', '该简历已在云端，请刷新列表后更新');
    throw new ApiError(403, 'QUOTA_EXCEEDED', '云端简历数量已达到配额，请删除旧简历或联系管理员');
  }
  return { body: writtenDocument(write, 1), status: 201 };
}

export async function updateResume(request: Request, env: Env, id: string): Promise<ApiResult> {
  const who = await requireUser(request, env);
  const write = await prepareWrite(await readBody(request), true, id);
  const nonce = crypto.randomUUID(), now = new Date().toISOString();
  const update = env.DB.prepare(`UPDATE resumes SET title = ?, data_json = ?, revision = revision + 1,
    byte_size = ?, mutation_nonce = ?, updated_at = ?
    WHERE user_id = ? AND id = ? AND revision = ?
      AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active') RETURNING revision`)
    .bind(write.resume.title, write.json, write.byteSize, nonce, now, who.user.id, id, write.expectedRevision!, who.user.id);
  // Every asset operation is guarded by this update's random nonce. A stale CAS changes nothing.
  const result = await env.DB.batch([update, ...assetStatements(env, who.user.id, id, nonce, write)]);
  if (!result[0].meta.changes) await mutationFailure(env, who.user.id, id);
  return { body: writtenDocument(write, Number((result[0].results[0] as { revision: number }).revision)) };
}

async function mutationFailure(env: Env, userId: string, id: string): Promise<never> {
  const user = await userById(env, userId);
  if (!user || user.status !== 'active') throw new ApiError(401, 'UNAUTHENTICATED', '账户已停用');
  const row = await env.DB.prepare('SELECT 1 FROM resumes WHERE user_id = ? AND id = ?').bind(userId, id).first();
  if (!row) throw new ApiError(404, 'RESUME_NOT_FOUND', '云端简历不存在');
  throw new ApiError(409, 'REVISION_CONFLICT', '云端已有更新版本，请先获取云端版本；本地编辑仍已保留');
}

export async function deleteResume(request: Request, env: Env, id: string): Promise<ApiResult> {
  const who = await requireUser(request, env);
  const body = await readBody(request);
  allowedKeys(body, ['expectedRevision']);
  const revision = expectedRevision(body.expectedRevision)!;
  const result = await env.DB.prepare(`DELETE FROM resumes WHERE user_id = ? AND id = ? AND revision = ?
    AND EXISTS (SELECT 1 FROM users WHERE id = ? AND status = 'active')`)
    .bind(who.user.id, id, revision, who.user.id).run();
  if (!result.meta.changes) await mutationFailure(env, who.user.id, id);
  // Foreign-key cascade removes both metadata and binary chunks in the same transaction.
  return { body: { deleted: true } };
}
