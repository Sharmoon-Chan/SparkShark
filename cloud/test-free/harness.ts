import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { CloudSession } from '../../src/cloud/types';

export const origin = 'https://me.sharmoon.cc.cd';
export const password = 'Synthetic password 2026!';
export const cloudRoot = fileURLToPath(new URL('../', import.meta.url));
const wranglerRequire = createRequire(resolve(cloudRoot, 'node_modules/wrangler/package.json'));
export const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);

export const sqlLoader = {
  name: 'inline-sql-text',
  setup(builder: any) {
    builder.onResolve({ filter: /\.sql(?:\?raw)?$/ }, (args: any) => ({
      path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'inline-sql-text',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'inline-sql-text' }, async (args: any) => ({
      contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))};`, loader: 'js',
    }));
  },
};

export async function freeConfiguration() {
  const config = await readFile(resolve(cloudRoot, 'wrangler-free.toml'), 'utf8');
  const bindingBlock = config.match(/\[\[durable_objects\.bindings\]\]([\s\S]*?)(?=\n\[|$)/)?.[1];
  const bindingName = bindingBlock?.match(/\bname\s*=\s*"([^"]+)"/)?.[1];
  const className = bindingBlock?.match(/\bclass_name\s*=\s*"([^"]+)"/)?.[1];
  if (!bindingName || !className) throw new Error('The free fixture requires the checked-in DO binding/class');
  const workerName = config.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? 'myresume-cloud-free';
  const main = config.match(/^main\s*=\s*"([^"]+)"/m)?.[1];
  if (!main) throw new Error('Missing free Worker entry point');
  const directory = resolve(cloudRoot, 'free');
  const source = (await Promise.all((await readdir(directory)).filter(name => name.endsWith('.ts')).map(name => readFile(resolve(directory, name), 'utf8')))).join('\n');
  const directName = source.match(/(?:idFromName|getByName)\(\s*(['"])([^'"]+)\1\s*\)/)?.[2];
  const identifier = source.match(/(?:idFromName|getByName)\(\s*([A-Za-z_$][\w$]*)\s*\)/)?.[1];
  const constantName = identifier ? source.match(new RegExp(`\\b(?:const|let)\\s+${identifier}\\s*=\\s*(['"])([^'"]+)\\1`))?.[2] : undefined;
  const objectName = directName ?? constantName;
  if (!objectName) throw new Error('Please document the stable singleton DO name for local storage inspection');
  const date = config.match(/^compatibility_date\s*=\s*"([^"]+)"/m)?.[1] ?? '2026-11-04';
  if (!config.includes('new_sqlite_classes') || !config.includes(className)) throw new Error('The DO migration must declare the SQLite class');
  return { config, workerName, bindingName, className, objectName, date, entryPoint: resolve(cloudRoot, main) };
}

export async function bundleFree(outputPath: string) {
  const config = await freeConfiguration();
  await build({ entryPoints: [config.entryPoint], outfile: outputPath,
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], plugins: [sqlLoader] });
  return config;
}

export interface TestActor { userId: string; cookie: string; csrf: string; session: CloudSession; ip: string; }

export async function createHarness() {
  const outputRoot = resolve(cloudRoot, 'test-free/output');
  await mkdir(outputRoot, { recursive: true });
  const caseRoot = await mkdtemp(resolve(outputRoot, 'case-'));
  const outputPath = resolve(caseRoot, 'worker.mjs');
  const config = await bundleFree(outputPath);
  const bootstrapToken = randomBytes(32).toString('base64url');
  const mf = new Miniflare(convertV4MiniflareOptions({
    name: config.workerName, modules: true, scriptPath: outputPath,
    compatibilityDate: config.date, compatibilityFlags: ['nodejs_compat'],
    bindings: { APP_ORIGIN: origin, BOOTSTRAP_TOKEN: bootstrapToken },
    durableObjects: { [config.bindingName]: { className: config.className, useSQLite: true } },
    durableObjectsPersist: resolve(caseRoot, 'storage'),
    unsafeInspectDurableObjects: true,
    cf: {}, log: new Log(LogLevel.ERROR),
  }));

  async function request(path: string, options: { method?: string; body?: unknown; actor?: TestActor; origin?: string | null; csrf?: string | null; headers?: Record<string, string>; ip?: string } = {}) {
    const headers: Record<string, string> = {
      Origin: options.origin === undefined ? origin : options.origin ?? '',
      'CF-Connecting-IP': options.ip ?? options.actor?.ip ?? '192.0.2.1',
      ...(options.actor ? { Cookie: options.actor.cookie } : {}),
      ...(options.actor && options.csrf === undefined ? { 'X-CSRF-Token': options.actor.csrf } : {}),
      ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}), ...options.headers,
    };
    if (options.origin === null) delete headers.Origin;
    if (options.csrf === null) delete headers['X-CSRF-Token'];
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return mf.dispatchFetch(origin + path, { method: options.method ?? 'GET', headers, body });
  }

  let inspection;
  try {
    await mf.ready;
    const ready = await request('/api/auth/me');
    if (ready.status !== 200) throw new Error(`DO schema initialization failed: ${ready.status} ${await ready.text()}`);
    inspection = await mf.unsafeGetDurableObjectStorage(config.workerName, config.className, { name: config.objectName });
  } catch (error) { await mf.dispose(); throw error; }

  // Read/write inspection is test-only. Business transactions execute in the
  // actual production DO adapter, and no SQL inspection endpoint is deployed.
  const db = {
    prepare(sql: string) {
      function statement(bindings: unknown[]) {
        return {
          bind: (...values: unknown[]) => statement(values),
          first: async <T = Record<string, unknown>>(column?: string): Promise<T | null> => {
            const row = (await inspection.exec(sql, ...bindings))[0];
            return row ? (column === undefined ? row : row[column]) as T : null;
          },
          run: async () => ({ results: await inspection.exec(sql, ...bindings) }),
        };
      }
      return statement([]);
    },
  };
  async function actorFrom(response: Response, ip: string): Promise<TestActor> {
    const session = await response.json() as CloudSession;
    if (!response.ok || !session.user || !session.csrfToken) throw new Error(`Cannot create actor: ${response.status} ${JSON.stringify(session)}`);
    const cookie = response.headers.get('Set-Cookie')?.split(';')[0];
    if (!cookie) throw new Error('Missing session cookie');
    return { userId: session.user.id, cookie, csrf: session.csrfToken, session, ip };
  }
  async function register(username: string, ip = '192.0.2.2', extra: Record<string, unknown> = {}) {
    return actorFrom(await request('/api/auth/register', { method: 'POST', body: { username, password, displayName: `Test ${username}`, ...extra }, ip }), ip);
  }
  async function bootstrap(username = 'administrator', ip = '192.0.2.10') {
    return actorFrom(await request('/api/admin/bootstrap', { method: 'POST', body: { username, password, displayName: 'Synthetic administrator' }, ip,
      headers: { 'X-Bootstrap-Token': bootstrapToken } }), ip);
  }
  return { mf, db, request, register, bootstrap, actorFrom, bootstrapToken, config, dispose: () => mf.dispose() };
}

export function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
