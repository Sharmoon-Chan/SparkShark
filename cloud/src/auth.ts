import type { CloudSession } from '../../src/cloud/types';
import { ApiError, authRateLimit, constantEqual, displayName, hashPassword, newSession, normalizeUsername,
  principal, publicUser, requireUser, sessionCookie, settings, validatePassword, verifyPassword } from './security';
import type { Env, UserRow } from './security';
import { allowedKeys, readBody } from './validation';

export interface ApiResult { body: unknown; status?: number; cookie?: string; }

export async function authMe(request: Request, env: Env): Promise<ApiResult> {
  const who = await principal(request, env);
  const body: CloudSession = { user: who ? publicUser(who.user) : null,
    csrfToken: who?.csrfToken ?? null, settings: await settings(env) };
  return { body, ...(!who ? { cookie: sessionCookie(env, '', true) } : {}) };
}

export async function register(request: Request, env: Env): Promise<ApiResult> {
  const body = await readBody(request);
  allowedKeys(body, ['username', 'password', 'displayName']);
  const username = normalizeUsername(body.username);
  await authRateLimit(request, env, 'register', username);
  const password = validatePassword(body.password);
  const name = displayName(body.displayName, username);
  if (!(await settings(env)).registrationOpen) throw new ApiError(403, 'REGISTRATION_CLOSED', '管理员已关闭新用户注册');
  const encoded = hashPassword(password);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  let inserted: D1Result;
  try {
    inserted = await env.DB.prepare(`INSERT INTO users
      (id, username, display_name, password_hash, role, status, resume_quota, created_at, updated_at)
      SELECT ?, ?, ?, ?, 'user', 'active', default_resume_quota, ?, ? FROM app_settings
      WHERE singleton = 1 AND registration_open = 1`).bind(id, username, name, encoded, now, now).run();
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed: users.username')) throw new ApiError(409, 'USERNAME_EXISTS', '用户名已被使用');
    throw error;
  }
  if (!inserted.meta.changes) throw new ApiError(403, 'REGISTRATION_CLOSED', '管理员已关闭新用户注册');
  return { ...await newSession(env, id, encoded), status: 201 };
}

export async function login(request: Request, env: Env): Promise<ApiResult> {
  const body = await readBody(request);
  allowedKeys(body, ['username', 'password', 'displayName']);
  const username = normalizeUsername(body.username);
  await authRateLimit(request, env, 'login', username);
  if (typeof body.password !== 'string' || !body.password.length || [...body.password].length > 128 ||
      new TextEncoder().encode(body.password).byteLength > 512) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', '用户名、密码不正确，或账户已停用');
  }
  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<UserRow>();
  const matches = verifyPassword(body.password, user?.password_hash ?? null);
  if (!matches || !user || user.status !== 'active') throw new ApiError(401, 'INVALID_CREDENTIALS', '用户名、密码不正确，或账户已停用');
  return newSession(env, user.id, user.password_hash);
}

export async function logout(request: Request, env: Env): Promise<ApiResult> {
  const who = await principal(request, env);
  if (who) {
    await requireUser(request, env);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(who.tokenHash).run();
  }
  return { body: { user: null, csrfToken: null, settings: await settings(env) } satisfies CloudSession,
    cookie: sessionCookie(env, '', true) };
}

export async function changePassword(request: Request, env: Env): Promise<ApiResult> {
  const who = await requireUser(request, env);
  const body = await readBody(request);
  allowedKeys(body, ['currentPassword', 'password', 'newPassword']);
  await authRateLimit(request, env, 'login', who.user.username);
  const newPassword = validatePassword(body.password ?? body.newPassword);
  if (body.password !== undefined && body.newPassword !== undefined && body.password !== body.newPassword) {
    throw new ApiError(400, 'INVALID_PASSWORD', '新密码字段不一致');
  }
  if (typeof body.currentPassword !== 'string' || [...body.currentPassword].length > 128 ||
      !verifyPassword(body.currentPassword, who.user.password_hash ?? null)) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', '当前密码不正确');
  }
  const encoded = hashPassword(newPassword);
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?
      AND password_hash = ? AND status = 'active'`).bind(encoded, new Date().toISOString(), who.user.id, who.user.password_hash!),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND EXISTS
      (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)`)
      .bind(who.user.id, who.user.id, encoded),
  ]);
  if (!result[0].meta.changes) throw new ApiError(409, 'ACCOUNT_CHANGED', '账户状态已变化，请重新登录');
  return newSession(env, who.user.id, encoded);
}

export async function bootstrap(request: Request, env: Env): Promise<ApiResult> {
  if (!env.BOOTSTRAP_TOKEN || env.BOOTSTRAP_TOKEN.length < 32) throw new ApiError(503, 'BOOTSTRAP_UNAVAILABLE', '管理员初始化尚未配置或已关闭');
  const token = request.headers.get('X-Bootstrap-Token') ?? '';
  if (!token || !constantEqual(token, env.BOOTSTRAP_TOKEN)) throw new ApiError(403, 'INVALID_BOOTSTRAP_TOKEN', '管理员初始化凭据无效');
  const body = await readBody(request);
  allowedKeys(body, ['username', 'password', 'displayName']);
  const username = normalizeUsername(body.username);
  await authRateLimit(request, env, 'bootstrap', username);
  const password = validatePassword(body.password);
  const name = displayName(body.displayName, username);
  const state = await env.DB.prepare('SELECT bootstrap_completed FROM app_settings WHERE singleton = 1').first<{ bootstrap_completed: number }>();
  if (!state) throw new ApiError(503, 'DATABASE_NOT_READY', '云端数据库尚未初始化');
  if (state.bootstrap_completed) throw new ApiError(409, 'ALREADY_INITIALIZED', '管理员已初始化');
  const id = crypto.randomUUID(), now = new Date().toISOString(), encoded = hashPassword(password);
  let result: D1Result[];
  try {
    result = await env.DB.batch([
      env.DB.prepare(`INSERT INTO users
        (id, username, display_name, password_hash, role, status, resume_quota, created_at, updated_at)
        SELECT ?, ?, ?, ?, 'admin', 'active', default_resume_quota, ?, ? FROM app_settings
        WHERE singleton = 1 AND bootstrap_completed = 0`).bind(id, username, name, encoded, now, now),
      env.DB.prepare(`UPDATE app_settings SET bootstrap_completed = 1 WHERE singleton = 1 AND bootstrap_completed = 0
        AND EXISTS (SELECT 1 FROM users WHERE id = ? AND role = 'admin')`).bind(id),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed: users.username')) throw new ApiError(409, 'USERNAME_EXISTS', '用户名已被使用，请为管理员使用其他用户名');
    throw error;
  }
  if (!result[0].meta.changes || !result[1].meta.changes) throw new ApiError(409, 'ALREADY_INITIALIZED', '管理员已初始化');
  return { ...await newSession(env, id, encoded), status: 201 };
}
