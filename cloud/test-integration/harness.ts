import { build } from 'esbuild';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { CloudSession } from '../../src/cloud/types';

export const origin = 'https://myresume.test';
export const password = 'Synthetic password 2026!';
const cloudRoot = fileURLToPath(new URL('../', import.meta.url));
// Use Wrangler's matching runtime instead of an independently pinned older one.
const wranglerRequire = createRequire(resolve(cloudRoot, 'node_modules/wrangler/package.json'));
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);

export interface TestActor {
  userId: string;
  cookie: string;
  csrf: string;
  session: CloudSession;
  ip: string;
}

export async function createHarness() {
  await mkdir(resolve(cloudRoot, 'test-integration/output'), { recursive: true });
  const outputPath = resolve(cloudRoot, 'test-integration/output/worker.mjs');
  await build({
    entryPoints: [resolve(cloudRoot, 'src/index.ts')], outfile: outputPath,
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*'],
  });
  const wrangler = await readFile(resolve(cloudRoot, 'wrangler.toml'), 'utf8');
  const date = wrangler.match(/compatibility_date\s*=\s*"([^"]+)"/)?.[1] ?? '2026-11-04';
  const bootstrapToken = randomBytes(32).toString('base64url');
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, scriptPath: outputPath, compatibilityDate: date,
    compatibilityFlags: ['nodejs_compat'],
    bindings: { APP_ORIGIN: origin, BOOTSTRAP_TOKEN: bootstrapToken },
    d1Databases: { DB: 'myresume-api-integration' },
    ratelimits: { AUTH_RATE_LIMIT: { namespace_id: '1001', simple: { limit: 10, period: 60 } } },
    cf: {}, log: new Log(LogLevel.ERROR),
  }));
  let db;
  try {
    await mf.ready;
    db = await mf.getD1Database('DB');
    const migrations = (await readdir(resolve(cloudRoot, 'migrations'))).filter(name => name.endsWith('.sql')).sort();
    for (const migration of migrations) {
      const sql = await readFile(resolve(cloudRoot, 'migrations', migration), 'utf8');
      // These migrations contain plain DDL, not triggers or semicolons in literals.
      // D1.exec() treats newline-separated input as separate statements, so execute
      // each complete semicolon-delimited statement rather than incomplete DDL lines.
      for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) {
        await db.prepare(statement).run();
      }
    }
  } catch (error) {
    await mf.dispose();
    throw error;
  }

  async function request(path: string, options: {
    method?: string; body?: unknown; actor?: TestActor; origin?: string | null;
    csrf?: string | null; headers?: Record<string, string>; ip?: string;
  } = {}) {
    const headers: Record<string, string> = {
      Origin: options.origin === undefined ? origin : options.origin ?? '',
      'CF-Connecting-IP': options.ip ?? options.actor?.ip ?? '192.0.2.1',
      ...(options.actor ? { Cookie: options.actor.cookie } : {}),
      ...(options.actor && options.csrf === undefined ? { 'X-CSRF-Token': options.actor.csrf } : {}),
      ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
      ...options.headers,
    };
    if (options.origin === null) delete headers.Origin;
    if (options.csrf === null) delete headers['X-CSRF-Token'];
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return mf.dispatchFetch(origin + path, { method: options.method ?? 'GET', headers, body });
  }

  async function actorFrom(response: Response, ip: string): Promise<TestActor> {
    const session = await response.json() as CloudSession;
    if (!response.ok || !session.user || !session.csrfToken) throw new Error(`Cannot create test actor: ${response.status} ${JSON.stringify(session)}`);
    const cookie = response.headers.get('Set-Cookie')?.split(';')[0];
    if (!cookie) throw new Error('Session response did not set a cookie');
    return { userId: session.user.id, cookie, csrf: session.csrfToken, session, ip };
  }

  async function register(username: string, ip = '192.0.2.2', extra: Record<string, unknown> = {}): Promise<TestActor> {
    return actorFrom(await request('/api/auth/register', {
      method: 'POST', body: { username, password, displayName: `Test ${username}`, ...extra }, ip,
    }), ip);
  }

  async function bootstrap(username = 'administrator', ip = '192.0.2.10'): Promise<TestActor> {
    return actorFrom(await request('/api/admin/bootstrap', {
      method: 'POST', body: { username, password, displayName: 'Synthetic administrator' },
      ip, headers: { 'X-Bootstrap-Token': bootstrapToken },
    }), ip);
  }

  return { mf, db, request, register, bootstrap, actorFrom, bootstrapToken, dispose: () => mf.dispose() };
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
