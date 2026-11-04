import assert from 'node:assert/strict';
import { it } from 'node:test';
import { build } from 'esbuild';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cloudRoot, freeConfiguration, origin, sqlLoader, Miniflare, Log, LogLevel, convertV4MiniflareOptions, sha256 } from './harness';

it('forwards the original unread API request stream to its DO binding', { timeout: 120_000 }, async () => {
  const config = await freeConfiguration();
  const outputRoot = resolve(cloudRoot, 'test-free/output');
  await mkdir(outputRoot, { recursive: true });
  const caseRoot = await mkdtemp(resolve(outputRoot, 'proxy-'));
  const spyPath = resolve(caseRoot, 'spy.mjs');
  await build({
    stdin: {
      contents: `import production from ${JSON.stringify(config.entryPoint)};
        export default { fetch(request, env) {
          const check = forwarded => {
            if (forwarded !== request || request.bodyUsed) throw new Error('Outer worker consumed or replaced the API request');
            return env.RECORDER.fetch(forwarded);
          };
          const fakeNamespace = {
            getByName(name) { if (name !== ${JSON.stringify(config.objectName)}) throw new Error('Unexpected DO name'); return {fetch:check}; },
            idFromName(name) { return name; }, get() { return {fetch:check}; }
          };
          return production.fetch(request, {...env, [${JSON.stringify(config.bindingName)}]:fakeNamespace, ASSETS:env.STATIC});
        }};`,
      resolveDir: cloudRoot, sourcefile: 'proxy-spy.ts', loader: 'ts',
    },
    outfile: spyPath, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], plugins: [sqlLoader],
  });
  const recorder = `export default {async fetch(request) {
    const bytes=new Uint8Array(await request.arrayBuffer());
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
    return Response.json({recorder:true,size:bytes.byteLength,sha256:hash,path:new URL(request.url).pathname,
      origin:request.headers.get('Origin'),cookie:request.headers.get('Cookie'),csrf:request.headers.get('X-CSRF-Token')});
  }};`;
  const mf = new Miniflare(convertV4MiniflareOptions({
    cf: {}, log: new Log(LogLevel.ERROR),
    workers: [
      { name: 'proxy-spy', modules: true, scriptPath: spyPath, compatibilityDate: config.date, compatibilityFlags: ['nodejs_compat'],
        bindings: { APP_ORIGIN: origin }, serviceBindings: { RECORDER: 'recorder', STATIC: 'recorder' } },
      { name: 'recorder', modules: true, script: recorder, compatibilityDate: config.date },
    ],
  }));
  try {
    await mf.ready;
    for (const body of ['{invalid-json', JSON.stringify({ username: 'synthetic', password: 'Synthetic password marker' }), 'x'.repeat(7 * 1024 * 1024)]) {
      const bytes = new TextEncoder().encode(body);
      const response = await mf.dispatchFetch(origin + '/api/auth/register', {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: 'test-cookie=marker', 'X-CSRF-Token': 'test-csrf' }, body,
      });
      assert.equal(response.status, 200, await response.clone().text());
      const captured = await response.json() as { recorder: boolean; size: number; sha256: string; path: string; origin: string; cookie: string; csrf: string };
      assert.equal(captured.recorder, true);
      assert.equal(captured.size, bytes.byteLength);
      assert.equal(captured.sha256, sha256(bytes));
      assert.equal(captured.path, '/api/auth/register');
      assert.equal(captured.origin, origin);
      assert.equal(captured.cookie, 'test-cookie=marker');
      assert.equal(captured.csrf, 'test-csrf');
    }
    const staticResponse = await mf.dispatchFetch(origin + '/styles.css');
    assert.equal(staticResponse.status, 200);
    assert.equal((await staticResponse.json() as { path: string }).path, '/styles.css');
  } finally { await mf.dispose(); }
});
