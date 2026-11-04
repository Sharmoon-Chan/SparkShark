import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness, password } from './harness';

const h = await createHarness();
function workerdPid(): number | null {
  if (process.platform !== 'win32') return null;
  const command = `$runtimeProcess = Get-CimInstance Win32_Process -Filter "ParentProcessId = ${process.pid}" | Where-Object { $_.Name -eq 'workerd.exe' } | Select-Object -First 1; if ($runtimeProcess) { $runtimeProcess.ProcessId }`;
  const pid = Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).trim());
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}
function cpuMs(pid: number | null): number | null {
  if (!pid) return null;
  const command = `(Get-Process -Id ${pid}).TotalProcessorTime.TotalMilliseconds | ConvertTo-Json -Compress`;
  return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).trim());
}
try {
  const pid = workerdPid();
  const results: unknown[] = [];
  async function phase(name: string, count: number, operation: () => Promise<void>) {
    const before = cpuMs(pid), started = process.hrtime.bigint();
    for (let cycle = 0; cycle < count; cycle++) await operation();
    const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
    const after = cpuMs(pid);
    results.push({ name, count, wallMs: Number(wallMs.toFixed(2)), wallMsPerRequest: Number((wallMs / count).toFixed(2)),
      localWorkerdProcessCpuMs: before === null || after === null ? null : Number((after - before).toFixed(2)),
      localWorkerdProcessCpuMsPerRequest: before === null || after === null ? null : Number(((after - before) / count).toFixed(2)) });
  }
  await phase('anonymous_me_SQLite_baseline', 5, async () => {
    const response = await h.request('/api/auth/me');
    if (response.status !== 200) throw new Error('Baseline request failed');
    await response.json();
  });
  let actor: Awaited<ReturnType<typeof h.register>>;
  await phase('DO_registration_native_scrypt', 1, async () => { actor = await h.register('cpu-test'); });
  await phase('DO_login_native_scrypt', 3, async () => {
    const response = await h.request('/api/auth/login', { method: 'POST', body: { username: 'cpu-test', password }, ip: actor!.ip });
    if (response.status !== 200) throw new Error('Password verification failed');
    actor = await h.actorFrom(response, actor!.ip);
  });
  const result = { measuredAt: new Date().toISOString(), runtime: 'local Miniflare 5/workerd with real SQLite Durable Object',
    objectClass: h.config.className, objectName: h.config.objectName,
    scrypt: { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
    note: 'CPU values are aggregate local OS workerd-process measurements including routing and SQLite. Source inspection and an original-stream proxy test establish that password operations occur inside the DO, but this is not per-isolate managed Cloudflare CPU accounting or proof that the deployed Free plan has been verified.', results };
  const resultPath = fileURLToPath(new URL('./output/auth-result.json', import.meta.url));
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally { await h.dispose(); }
