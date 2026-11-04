import { scryptSync, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { CloudSession, CloudUser } from '../../src/cloud/types';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  APP_ORIGIN: string;
  BOOTSTRAP_TOKEN?: string;
  AUTH_RATE_LIMIT?: { limit(input: { key: string }): Promise<{ success: boolean }> };
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const MAX_CONTENT_BYTES = 512 * 1024;
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const ASSET_CHUNK_BYTES = 512 * 1024;
export const MAX_QUOTA = 10000;
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash?: string;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  resume_quota: number;
  created_at: string;
  resume_count?: number;
  storage_bytes?: number;
}

export interface Principal {
  user: UserRow;
  tokenHash: string;
  csrfToken: string;
}

export function publicUser(row: UserRow): CloudUser {
  return {
    id: row.id, username: row.username, displayName: row.display_name,
    role: row.role, status: row.status, resumeQuota: Number(row.resume_quota),
    resumeCount: Number(row.resume_count ?? 0), storageBytes: Number(row.storage_bytes ?? 0),
    createdAt: row.created_at,
  };
}

export async function settings(env: Env): Promise<CloudSession['settings']> {
  const row = await env.DB.prepare('SELECT registration_open, default_resume_quota FROM app_settings WHERE singleton = 1')
    .first<{ registration_open: number; default_resume_quota: number }>();
  if (!row) throw new ApiError(503, 'DATABASE_NOT_READY', '云端数据库尚未初始化');
  return {
    registrationOpen: row.registration_open === 1,
    defaultResumeQuota: Number(row.default_resume_quota),
    maxResumeBytes: MAX_CONTENT_BYTES, maxAssetBytes: MAX_ASSET_BYTES,
  };
}

export function appOrigin(env: Env): string {
  let url: URL;
  try { url = new URL(env.APP_ORIGIN); } catch { throw new ApiError(503, 'ORIGIN_NOT_CONFIGURED', '网站地址尚未配置'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:'))) {
    throw new ApiError(503, 'ORIGIN_NOT_CONFIGURED', '网站地址配置无效');
  }
  return url.origin;
}

export function checkOrigin(request: Request, env: Env): void {
  const origin = request.headers.get('Origin');
  const expected = appOrigin(env);
  if (origin && origin !== expected) throw new ApiError(403, 'INVALID_ORIGIN', '请求来源不受信任');
  if (!['GET', 'HEAD'].includes(request.method) && origin !== expected) {
    throw new ApiError(403, 'INVALID_ORIGIN', '修改请求需要可信的网站来源');
  }
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new ApiError(403, 'INVALID_ORIGIN', '请求来源不受信任');
  }
}

function cookieName(env: Env): string {
  return appOrigin(env).startsWith('https:') ? '__Host-myresume-session' : 'myresume-session-dev';
}

export function sessionCookie(env: Env, token: string, clear = false): string {
  const secure = appOrigin(env).startsWith('https:') ? '; Secure' : '';
  return `${cookieName(env)}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_MS / 1000}${secure}`;
}

function readSessionCookie(request: Request, env: Env): string | null {
  const name = cookieName(env);
  const value = (request.headers.get('Cookie') ?? '').split(';').map(part => part.trim())
    .find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export function randomToken(): string { return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'); }

export async function sha256(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return Buffer.from(await crypto.subtle.digest('SHA-256', buffer)).toString('hex');
}

export function constantEqual(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export async function principal(request: Request, env: Env): Promise<Principal | null> {
  const token = readSessionCookie(request, env);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.*, s.csrf_token,
      (SELECT COUNT(*) FROM resumes WHERE user_id = u.id) AS resume_count,
      (SELECT COALESCE(SUM(byte_size), 0) FROM resumes WHERE user_id = u.id) AS storage_bytes
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'
  `).bind(tokenHash, new Date().toISOString()).first<UserRow & { csrf_token: string }>();
  return row ? { user: row, tokenHash, csrfToken: row.csrf_token } : null;
}

export async function requireUser(request: Request, env: Env, admin = false): Promise<Principal> {
  const who = await principal(request, env);
  if (!who) throw new ApiError(401, 'UNAUTHENTICATED', '请先登录');
  if (admin && who.user.role !== 'admin') throw new ApiError(403, 'ADMIN_REQUIRED', '需要管理员权限');
  if (!['GET', 'HEAD'].includes(request.method)) {
    const token = request.headers.get('X-CSRF-Token') ?? '';
    if (!token || !constantEqual(token, who.csrfToken)) throw new ApiError(403, 'INVALID_CSRF', '登录验证已失效，请重新登录');
  }
  return who;
}

export async function userById(env: Env, id: string): Promise<UserRow | null> {
  return env.DB.prepare(`SELECT u.*,
    (SELECT COUNT(*) FROM resumes WHERE user_id = u.id) AS resume_count,
    (SELECT COALESCE(SUM(byte_size), 0) FROM resumes WHERE user_id = u.id) AS storage_bytes
    FROM users u WHERE id = ?`).bind(id).first<UserRow>();
}

export async function newSession(env: Env, id: string, expectedPasswordHash?: string): Promise<{ body: CloudSession; cookie: string }> {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const csrfToken = randomToken();
  const now = new Date();
  const inserted = await env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, expires_at)
    SELECT ?, id, ?, ?, ? FROM users WHERE id = ? AND status = 'active' ${expectedPasswordHash ? 'AND password_hash = ?' : ''}`)
    .bind(tokenHash, csrfToken, now.toISOString(), new Date(now.getTime() + SESSION_MS).toISOString(), id,
      ...(expectedPasswordHash ? [expectedPasswordHash] : [])).run();
  if (!inserted.meta.changes) throw new ApiError(401, 'UNAUTHENTICATED', '账户状态已变化，请重新登录');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now.toISOString()),
    env.DB.prepare(`DELETE FROM sessions WHERE token_hash IN (
      SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, token_hash DESC LIMIT -1 OFFSET 20
    ) AND token_hash != ?`).bind(id, tokenHash),
  ]);
  const user = await userById(env, id);
  if (!user || user.status !== 'active') throw new ApiError(401, 'UNAUTHENTICATED', '账户已停用');
  return { body: { user: publicUser(user), csrfToken, settings: await settings(env) }, cookie: sessionCookie(env, token) };
}

export function normalizeUsername(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError(400, 'INVALID_USERNAME', '请输入用户名');
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username)) {
    throw new ApiError(400, 'INVALID_USERNAME', '用户名需为 3–32 位字母、数字、点、下划线或连字符');
  }
  return username;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || [...value].length < 12 || [...value].length > 128 || new TextEncoder().encode(value).byteLength > 512) {
    throw new ApiError(400, 'INVALID_PASSWORD', '密码需要 12–128 个字符');
  }
  return value;
}

export function displayName(value: unknown, fallback: string): string {
  if (value === undefined || (typeof value === 'string' && !value.trim() && fallback)) return fallback;
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 80) {
    throw new ApiError(400, 'INVALID_DISPLAY_NAME', '显示名称需为 1–80 个字符');
  }
  return value.trim();
}

// OWASP scrypt profile: N=2^15, r=8, p=3; parameters are never weakened for tests/free-tier CPU.
const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export function hashPassword(password: string): string {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const result = scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$32768$8$3$${Buffer.from(salt).toString('base64url')}$${result.toString('base64url')}`;
}

export function verifyPassword(password: string, encoded: string | null): boolean {
  const parts = (encoded ?? '').split('$');
  const valid = parts.length === 6 && parts.slice(0, 4).join('$') === 'scrypt$32768$8$3' &&
    /^[A-Za-z0-9_-]{22}$/.test(parts[4]) && /^[A-Za-z0-9_-]{86}$/.test(parts[5]);
  const salt = valid ? Buffer.from(parts[4], 'base64url') : Buffer.alloc(16);
  const expected = valid ? Buffer.from(parts[5], 'base64url') : Buffer.alloc(64);
  const computed = scryptSync(password, salt, 64, SCRYPT);
  return timingSafeEqual(computed, expected) && valid;
}

export async function authRateLimit(request: Request, env: Env, operation: 'login' | 'register' | 'bootstrap', username: string): Promise<void> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (env.AUTH_RATE_LIMIT) {
    for (const key of [`${operation}:ip:${ip}`, `${operation}:username:${username}`]) {
      if (!(await env.AUTH_RATE_LIMIT.limit({ key })).success) throw new ApiError(429, 'RATE_LIMITED', '尝试次数过多，请稍后再试');
    }
  }
  const now = Date.now();
  const policies = [
    { key: `${operation}:ip:${ip}`, ms: operation === 'register' ? 15 * 60000 : 5 * 60000, limit: operation === 'register' ? 5 : 20 },
    { key: `${operation}:username:${username}`, ms: 5 * 60000, limit: 8 },
  ];
  // These D1 statements are atomic across locations, unlike the approximate edge limiter.
  const statements = [env.DB.prepare('DELETE FROM auth_rate_windows WHERE expires_at <= ?').bind(now)];
  for (const policy of policies) {
    const windowId = Math.floor(now / policy.ms);
    statements.push(env.DB.prepare(`INSERT INTO auth_rate_windows (key_hash, window_id, attempts, expires_at)
      VALUES (?, ?, 1, ?) ON CONFLICT(key_hash, window_id) DO UPDATE SET attempts = attempts + 1
      WHERE attempts < ? RETURNING attempts`)
      .bind(await sha256(policy.key), windowId, (windowId + 1) * policy.ms, policy.limit));
  }
  const result = await env.DB.batch(statements);
  if (result.slice(1).some(item => !item.results?.length)) throw new ApiError(429, 'RATE_LIMITED', '尝试次数过多，请稍后再试');
}
