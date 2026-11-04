import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';

const script = `
import { scrypt, scryptSync } from 'node:crypto';
export default { async fetch(request) {
  const path = new URL(request.url).pathname;
  const params = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
  const salt = new Uint8Array(16);
  try {
    if (path === '/sync') scryptSync('Synthetic probe password', salt, 64, params);
    if (path === '/async') await new Promise((resolve, reject) => {
      scrypt('Synthetic probe password', salt, 64, params, (error, result) => error ? reject(error) : resolve(result));
    });
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ ok: false, error: String(error) }, { status: 500 }); }
}};`;
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, script, compatibilityDate: '2026-11-04',
  compatibilityFlags: ['nodejs_compat'], cf: {}, log: new Log(LogLevel.ERROR),
}));
try {
  await mf.ready;
  const result = [];
  for (const mode of ['sync', 'async']) {
    const warm = await mf.dispatchFetch(`https://probe.test/${mode}`);
    if (!warm.ok) throw new Error(await warm.text());
    const started = performance.now();
    const operation = mf.dispatchFetch(`https://probe.test/${mode}`).then(async response => ({
      status: response.status, elapsedMs: performance.now() - started, body: await response.json(),
    }));
    await new Promise(resolve => setTimeout(resolve, 5));
    const noop = await mf.dispatchFetch('https://probe.test/noop');
    const noopElapsedMs = performance.now() - started;
    await noop.arrayBuffer();
    result.push({ mode, noopElapsedMs, operation: await operation });
  }
  console.log(JSON.stringify({ runtime: 'local Miniflare/workerd',
    note: 'Concurrency probe only. This is not managed Worker CPU billing or a Free-tier compatibility guarantee.', result }, null, 2));
} finally { await mf.dispose(); }
