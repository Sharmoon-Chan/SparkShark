import type { CloudAdminOverview, CloudAdminUsers } from '../../src/cloud/types';
import type { ApiResult } from './auth';
import type { Env, UserRow } from './security';
import { ApiError, authRateLimit, displayName, hashPassword, publicUser, requireUser, settings, userById, validatePassword } from './security';
import { allowedKeys, quota, readBody } from './validation';

export async function adminOverview(request: Request, env: Env): Promise<ApiResult> {
  await requireUser(request, env, true);
  const row = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM users) AS totalUsers,
    (SELECT COUNT(*) FROM users WHERE status = 'active') AS activeUsers,
    (SELECT COUNT(*) FROM resumes) AS totalResumes,
    (SELECT COALESCE(SUM(byte_size), 0) FROM resumes) AS totalStorageBytes`)
    .first<CloudAdminOverview>();
  return { body: row };
}

export async function adminUsers(request: Request, env: Env): Promise<ApiResult> {
  await requireUser(request, env, true);
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? 1), pageSize = Number(url.searchParams.get('pageSize') ?? 20);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000000 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new ApiError(400, 'INVALID_PAGINATION', '分页参数无效');
  }
  const results = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS total FROM users'),
    env.DB.prepare(`SELECT u.*,
      (SELECT COUNT(*) FROM resumes WHERE user_id = u.id) AS resume_count,
      (SELECT COALESCE(SUM(byte_size), 0) FROM resumes WHERE user_id = u.id) AS storage_bytes
      FROM users u ORDER BY created_at DESC, id LIMIT ? OFFSET ?`).bind(pageSize, (page - 1) * pageSize),
  ]);
  const users = (results[1].results as unknown as UserRow[]).map(publicUser);
  return { body: { users, total: Number((results[0].results[0] as { total: number }).total), page, pageSize } satisfies CloudAdminUsers };
}

export async function patchUser(request: Request, env: Env, id: string): Promise<ApiResult> {
  const who = await requireUser(request, env, true);
  const body = await readBody(request);
  allowedKeys(body, ['status', 'resumeQuota', 'displayName']);
  if (!Object.keys(body).length) throw new ApiError(400, 'INVALID_BODY', '请提供需要修改的字段');
  const updates: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [new Date().toISOString()];
  if (body.status !== undefined) {
    if (!['active', 'disabled'].includes(body.status as string)) throw new ApiError(400, 'INVALID_STATUS', '账户状态无效');
    updates.push('status = ?'); values.push(body.status as string);
  }
  if (body.resumeQuota !== undefined) { updates.push('resume_quota = ?'); values.push(quota(body.resumeQuota)); }
  if (body.displayName !== undefined) { updates.push('display_name = ?'); values.push(displayName(body.displayName, '')); }
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?
      AND EXISTS (SELECT 1 FROM users actor WHERE actor.id = ? AND actor.role = 'admin' AND actor.status = 'active')
      AND (role != 'admin' OR status != 'active' OR ? = 1 OR
        (SELECT COUNT(*) FROM users WHERE role = 'admin' AND status = 'active') > 1)`)
      .bind(...values, id, who.user.id, body.status !== 'disabled' ? 1 : 0),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND EXISTS
      (SELECT 1 FROM users WHERE id = ? AND status = 'disabled')`).bind(id, id),
  ]);
  const updated = await userById(env, id);
  if (!updated) throw new ApiError(404, 'USER_NOT_FOUND', '用户不存在');
  if (!result[0].meta.changes) {
    const actor = await userById(env, who.user.id);
    if (!actor || actor.status !== 'active' || actor.role !== 'admin') throw new ApiError(403, 'ADMIN_REQUIRED', '管理员登录已失效');
    throw new ApiError(409, 'LAST_ADMIN', '不能停用最后一位有效管理员');
  }
  return { body: publicUser(updated) };
}

export async function resetPassword(request: Request, env: Env, id: string): Promise<ApiResult> {
  const who = await requireUser(request, env, true);
  const body = await readBody(request);
  allowedKeys(body, ['password']);
  const password = validatePassword(body.password);
  if (id === who.user.id) throw new ApiError(400, 'USE_PASSWORD_CHANGE', '修改自己的密码请使用账户密码修改功能');
  const user = await userById(env, id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', '用户不存在');
  await authRateLimit(request, env, 'login', who.user.username);
  const encoded = hashPassword(password);
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?
      AND EXISTS (SELECT 1 FROM users actor WHERE actor.id = ? AND actor.role = 'admin' AND actor.status = 'active')`)
      .bind(encoded, new Date().toISOString(), id, who.user.id),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND EXISTS
      (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)`).bind(id, id, encoded),
  ]);
  if (!result[0].meta.changes) throw new ApiError(403, 'ADMIN_REQUIRED', '管理员登录已失效');
  return { body: { reset: true } };
}

export async function patchSettings(request: Request, env: Env): Promise<ApiResult> {
  const who = await requireUser(request, env, true);
  const body = await readBody(request);
  allowedKeys(body, ['registrationOpen', 'defaultResumeQuota']);
  if (!Object.keys(body).length) throw new ApiError(400, 'INVALID_BODY', '请提供需要修改的设置');
  const updates: string[] = [], values: (string | number)[] = [];
  if (body.registrationOpen !== undefined) {
    if (typeof body.registrationOpen !== 'boolean') throw new ApiError(400, 'INVALID_SETTING', '注册设置需为布尔值');
    updates.push('registration_open = ?'); values.push(body.registrationOpen ? 1 : 0);
  }
  if (body.defaultResumeQuota !== undefined) { updates.push('default_resume_quota = ?'); values.push(quota(body.defaultResumeQuota)); }
  const result = await env.DB.prepare(`UPDATE app_settings SET ${updates.join(', ')} WHERE singleton = 1
    AND EXISTS (SELECT 1 FROM users WHERE id = ? AND role = 'admin' AND status = 'active')`)
    .bind(...values, who.user.id).run();
  if (!result.meta.changes) throw new ApiError(403, 'ADMIN_REQUIRED', '管理员登录已失效');
  return { body: await settings(env) };
}
