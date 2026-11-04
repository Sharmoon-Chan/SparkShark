import { writeFile, mkdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, dirname } from 'node:path';
import { createResume } from '../../src/domain/resume';
import type { CloudResumeDocument } from '../../src/cloud/types';
import { createHarness, password } from './harness';
import { pngAsset } from './photos';

const h = await createHarness();
const stages: unknown[] = [];
async function measure(label: string, operation?: () => Promise<unknown>) {
  const before = await h.metrics();
  const started = process.hrtime.bigint();
  let failure: unknown;
  try { if (operation) await operation(); } catch (error) { failure = error; }
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
  const after = await h.metrics();
  stages.push({
    label, wallMs: Number(wallMs.toFixed(2)),
    rssBytes: after.rss, peakRssBytesSinceStart: after.maxRSS * 1024,
    heapUsedBytes: after.heapUsed, externalBytes: after.external,
    childCpuMs: Number(((after.userCPUTime + after.systemCPUTime - before.userCPUTime - before.systemCPUTime) / 1000).toFixed(2)),
    ...(failure ? { failed: true, error: failure instanceof Error ? failure.message : String(failure) } : {}),
  });
  if (failure) throw failure;
}

try {
  await measure('idle');
  let actor: Awaited<ReturnType<typeof h.register>>;
  await measure('registration_password_hash', async () => { actor = await h.register('resource-test'); });
  await measure('password_verification', async () => {
    const response = await h.request('/api/auth/login', {
      method: 'POST', body: { username: 'resource-test', password }, ip: actor!.ip,
    });
    if (response.status !== 200) throw new Error(`Password verification failed: ${response.status}`);
    actor = await h.actorFrom(response, actor!.ip);
  });

  const photo = pngAsset(5 * 1024 * 1024);
  const resume = createResume('Synthetic 5 MiB avatar resource test');
  resume.basics.avatarAssetId = photo.id;
  let document: CloudResumeDocument;
  await measure('upload_exact_5MiB_photo', async () => {
    const response = await h.request('/api/resumes', { actor: actor!, method: 'POST', body: { resume, assets: [photo] } });
    if (response.status !== 201) throw new Error(`Photo upload failed: ${response.status} ${await response.text()}\n${h.diagnostics()}`);
    document = await response.json() as CloudResumeDocument;
    if (document.assets[0].sha256 !== photo.sha256) throw new Error('Uploaded photo hash differs');
  });
  await measure('download_exact_5MiB_photo', async () => {
    const response = await h.request(`/api/resumes/${resume.id}`, { actor: actor! });
    if (response.status !== 200) throw new Error(`Photo download failed: ${response.status}`);
    const downloaded = await response.json() as CloudResumeDocument;
    if (downloaded.assets[0].dataBase64 !== photo.dataBase64) throw new Error('Downloaded photo differs');
  });
  // Check retained allocations across the same document's ordinary save cycles,
  // rather than treating one successful maximum-size request as a lifetime cap.
  await measure('three_repeated_5MiB_photo_save_cycles', async () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      const response = await h.request(`/api/resumes/${resume.id}`, {
        actor: actor!, method: 'PUT', body: { resume, assets: [photo], expectedRevision: document!.revision },
      });
      if (response.status !== 200) throw new Error(`Repeated photo update failed: ${response.status}`);
      document = await response.json() as CloudResumeDocument;
      if (document.assets[0].sha256 !== photo.sha256) throw new Error('Updated photo hash differs');
    }
  });

  const disk = await Promise.all(['', '-wal', '-shm'].map(async suffix => {
    const info = await stat(h.dbPath + suffix).catch(() => null);
    return { file: basename(h.dbPath) + suffix, bytes: info?.size ?? 0 };
  }));
  const result = {
    measuredAt: new Date().toISOString(), runtime: 'local Node 24 process / real node:sqlite / real HTTP',
    nodeVersion: (await h.metrics()).nodeVersion,
    socket: h.address,
    scrypt: { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
    note: 'RSS and CPU belong to the separate bundled backend child process, excluding the test client. Peak RSS is the OS-reported cumulative high-water mark since backend startup, not an independently reset peak for each stage. Local hardware measurements do not establish Ali production capacity or latency.',
    logicalStorageBytes: document!.byteSize, disk, stages,
    budget: { limitBytes: 240 * 1024 * 1024,
      withinBudget: (await h.metrics()).maxRSS * 1024 <= 240 * 1024 * 1024 },
  };
  const resultPath = fileURLToPath(new URL('./output/resource-result.json', import.meta.url));
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.budget.withinBudget) process.exitCode = 1;
} catch (error) {
  const partial = { measuredAt: new Date().toISOString(), runtime: 'local bundled Node 24 / real node:sqlite / real HTTP',
    note: 'Incomplete benchmark; a valid 5 MiB image request failed. No successful maximum-image download has been measured. These local RSS/CPU values belong to the separate backend child process.',
    failed: true, error: error instanceof Error ? error.message : String(error), stages };
  const resultPath = fileURLToPath(new URL('./output/resource-partial-result.json', import.meta.url));
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify(partial, null, 2) + '\n');
  console.log(JSON.stringify(partial, null, 2));
  process.exitCode = 1;
} finally { await h.dispose(); }
