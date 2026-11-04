import type { CloudErrorBody } from '../../src/cloud/types';
import { adminOverview, adminUsers, patchSettings, patchUser, resetPassword } from './admin';
import { authMe, bootstrap, changePassword, login, logout, register } from './auth';
import type { ApiResult } from './auth';
import { createResume, deleteResume, getResume, listResumes, updateResume } from './resumes';
import { ApiError, checkOrigin } from './security';
import type { Env } from './security';
import { fontAssetResponse } from './font-assets';

export type { Env } from './security';

function response(result: ApiResult): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Vary': 'Cookie, Origin',
  });
  if (result.cookie) headers.set('Set-Cookie', result.cookie);
  return new Response(JSON.stringify(result.body), { status: result.status ?? 200, headers });
}

async function route(request: Request, env: Env, path: string): Promise<ApiResult> {
  const method = request.method;
  if (path === '/api/auth/me' && method === 'GET') return authMe(request, env);
  if (path === '/api/auth/register' && method === 'POST') return register(request, env);
  if (path === '/api/auth/login' && method === 'POST') return login(request, env);
  if (path === '/api/auth/logout' && method === 'POST') return logout(request, env);
  if (path === '/api/auth/password' && method === 'POST') return changePassword(request, env);
  if (path === '/api/admin/bootstrap' && method === 'POST') return bootstrap(request, env);
  if (path === '/api/resumes' && method === 'GET') return listResumes(request, env);
  if (path === '/api/resumes' && method === 'POST') return createResume(request, env);
  if (path === '/api/admin/overview' && method === 'GET') return adminOverview(request, env);
  if (path === '/api/admin/users' && method === 'GET') return adminUsers(request, env);
  if (path === '/api/admin/settings' && method === 'PATCH') return patchSettings(request, env);
  const user = path.match(/^\/api\/admin\/users\/([^/]+)(\/reset-password)?$/);
  if (user) {
    const id = decodeURIComponent(user[1]);
    if (user[2] && method === 'POST') return resetPassword(request, env, id);
    if (!user[2] && method === 'PATCH') return patchUser(request, env, id);
  }
  const resume = path.match(/^\/api\/resumes\/([^/]+)$/);
  if (resume) {
    const id = decodeURIComponent(resume[1]);
    if (method === 'GET') return getResume(request, env, id);
    if (method === 'PUT') return updateResume(request, env, id);
    if (method === 'DELETE') return deleteResume(request, env, id);
  }
  throw new ApiError(404, 'NOT_FOUND', '接口不存在');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      if (env.ASSETS && url.pathname.startsWith('/fonts/')) {
        const font = await fontAssetResponse(request, env.ASSETS);
        if (font) return font;
      }
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Static build not available', { status: 404 });
    }
    try {
      checkOrigin(request, env);
      return response(await route(request, env, url.pathname));
    } catch (error) {
      if (error instanceof ApiError) return response({ status: error.status,
        body: { error: { code: error.code, message: error.message } } satisfies CloudErrorBody });
      if (error instanceof URIError) return response({ status: 400,
        body: { error: { code: 'INVALID_PATH', message: '请求地址无效' } } satisfies CloudErrorBody });
      // Do not log request bodies, passwords, tokens, usernames, or resume contents.
      console.error('MyResume cloud API failure', { name: error instanceof Error ? error.name : 'UnknownError' });
      return response({ status: 500, body: { error: { code: 'INTERNAL_ERROR', message: '云端服务暂时无法处理请求，请稍后再试' } } satisfies CloudErrorBody });
    }
  },
} satisfies ExportedHandler<Env>;
