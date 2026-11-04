import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { scryptSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const cloudRoot = fileURLToPath(new URL('../', import.meta.url));
const wranglerRequire = createRequire(resolve(cloudRoot, 'node_modules/wrangler/package.json'));
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);
const outputPath = resolve(cloudRoot, 'test-integration/output/auth-benchmark-worker.mjs');
const password = 'Synthetic password for local benchmark';
const salt = Buffer.alloc(16, 7);
const reference = `scrypt$32768$8$3$${salt.toString('base64url')}$${scryptSync(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('base64url')}`;
await mkdir(resolve(cloudRoot, 'test-integration/output'), { recursive: true });
await build({
  stdin: {
    contents: `import { hashPassword, verifyPassword } from './security.ts';
      const password = ${JSON.stringify(password)};
      const reference = ${JSON.stringify(reference)};
      export default { async fetch(request) {
        const operation = new URL(request.url).pathname.slice(1);
        const result = operation === 'hash' ? hashPassword(password) : operation === 'verify' ? verifyPassword(password, reference) : true;
        return Response.json({ok: Boolean(result)});
      }};`,
    resolveDir: resolve(cloudRoot, 'src'), sourcefile: 'auth-benchmark.ts', loader: 'ts',
  },
  outfile: outputPath, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'], external: ['node:*'],
});

const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, scriptPath: outputPath, compatibilityDate: '2026-11-04',
  compatibilityFlags: ['nodejs_compat'], cf: {}, log: new Log(LogLevel.ERROR),
}));

function getWorkerdPid(): number | null {
  if (process.platform !== 'win32') return null;
  const command = `$workerProcess = Get-CimInstance Win32_Process -Filter "ParentProcessId = ${process.pid}" | Where-Object { $_.Name -eq 'workerd.exe' } | Select-Object -First 1; if ($workerProcess) { $workerProcess.ProcessId }`;
  const pid = Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).trim());
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function cpuMilliseconds(pid: number | null): number | null {
  if (!pid) return null;
  const command = `(Get-Process -Id ${pid}).TotalProcessorTime.TotalMilliseconds | ConvertTo-Json -Compress`;
  return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).trim());
}

try {
  await mf.ready;
  const pid = getWorkerdPid();
  const results = [];
  for (const operation of ['noop', 'hash', 'verify']) {
    const warm = await mf.dispatchFetch(`https://benchmark.test/${operation}`);
    if (!warm.ok || !(await warm.json() as { ok: boolean }).ok) throw new Error(`Workerd ${operation} failed`);
    const count = operation === 'noop' ? 20 : 3;
    const cpuBefore = cpuMilliseconds(pid);
    const started = process.hrtime.bigint();
    for (let run = 0; run < count; run++) {
      const response = await mf.dispatchFetch(`https://benchmark.test/${operation}`);
      if (!response.ok || !(await response.json() as { ok: boolean }).ok) throw new Error(`Workerd ${operation} failed`);
    }
    const elapsedMilliseconds = Number(process.hrtime.bigint() - started) / 1e6;
    const cpuAfter = cpuMilliseconds(pid);
    results.push({
      operation, count,
      elapsedMilliseconds: Number(elapsedMilliseconds.toFixed(2)),
      elapsedPerRequestMilliseconds: Number((elapsedMilliseconds / count).toFixed(2)),
      workerdProcessCpuMilliseconds: cpuBefore === null || cpuAfter === null ? null : Number((cpuAfter - cpuBefore).toFixed(2)),
      workerdProcessCpuPerRequestMilliseconds: cpuBefore === null || cpuAfter === null ? null : Number(((cpuAfter - cpuBefore) / count).toFixed(2)),
    });
  }
  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(), runtime: 'local Miniflare/workerd',
    scrypt: { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
    note: 'Wall time is measured outside workerd. Process CPU is a local OS measurement, not managed Cloudflare Worker CPU billing. These results cannot confirm Free-plan compatibility; production Worker CPU metrics are required.',
    results,
  }, null, 2));
} finally { await mf.dispose(); }
