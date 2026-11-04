import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

try {
  const root = process.env.TEST_CASE_ROOT!;
  const publicDirectory = resolve(root, 'public');
  await mkdir(publicDirectory, { recursive: true });
  await writeFile(resolve(publicDirectory, 'index.html'), '<!doctype html><html><title>Synthetic test fixture</title></html>');
  // Separate bundles preserve the production server module's CLI guard. The
  // fixture imports that module without also executing its CLI startup path.
  const { startNodeServer } = await import(pathToFileURL(process.env.TEST_SERVER_PATH!).href);
  const runtime = await startNodeServer({
    appOrigin: process.env.TEST_APP_ORIGIN!, host: '127.0.0.1', port: 0,
    dataDirectory: resolve(root, 'data'), publicDirectory,
    migrationsDirectory: process.env.TEST_MIGRATIONS!, workerPath: process.env.TEST_WORKER_PATH!,
    bootstrapToken: process.env.TEST_BOOTSTRAP_TOKEN!, workerCount: 1,
  });
  process.send?.({ type: 'ready', address: runtime.server.address() });
  let closing = false;
  process.on('message', async (message: any) => {
    if (message.type === 'metrics') {
      const memory = process.memoryUsage(), resource = process.resourceUsage();
      process.send?.({ type: 'metrics', id: message.id, metrics: {
        rss: memory.rss, heapUsed: memory.heapUsed, external: memory.external,
        maxRSS: resource.maxRSS, userCPUTime: resource.userCPUTime, systemCPUTime: resource.systemCPUTime,
        nodeVersion: process.version,
      } });
    }
    if (message.type === 'shutdown' && !closing) {
      closing = true;
      await runtime.close();
      process.disconnect();
    }
  });
} catch (error) {
  process.send?.({ type: 'startup-failure', message: error instanceof Error ? error.message : 'Unknown startup error' });
  process.exitCode = 1;
  process.disconnect();
}
