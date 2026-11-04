import { parentPort, workerData } from 'node:worker_threads';
import application from '../src/index';
import type { Env } from '../src/security';
import { SqliteD1Database } from './sqlite-d1';
import type { ApiJob, ApiReply, WorkerConfiguration } from './protocol';
import { releaseTransferredBuffer } from './protocol';

if (!parentPort) throw new Error('API runtime requires a worker thread');
const configuration = workerData as WorkerConfiguration;
const database = new SqliteD1Database(configuration.filename);
const env: Env = { DB: database as unknown as D1Database, APP_ORIGIN: configuration.appOrigin,
  BOOTSTRAP_TOKEN: configuration.bootstrapToken };
let active = false;

parentPort.on('message', async (job: ApiJob | { type: 'shutdown' }) => {
  if (job.type === 'shutdown') { database.close(); parentPort!.close(); return; }
  if (job.type !== 'request' || active) throw new Error('Unexpected concurrent API work');
  active = true;
  try {
    // A byte-sequence Request constructor copies the whole input buffer. Feeding
    // a one-chunk stream preserves the transferred allocation until consumption.
    const incoming = job.body === null ? null : new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(job.body!)); controller.close();
    } });
    const request = new Request(job.url, { method: job.method, headers: job.headers,
      ...(incoming === null ? {} : { body: incoming, duplex: 'half' }) } as RequestInit & { duplex?: 'half' });
    const response = await application.fetch(request, env);
    const body = await response.arrayBuffer();
    const reply: ApiReply = { type: 'response', id: job.id, status: response.status,
      headers: Array.from(response.headers.entries()), body };
    parentPort!.postMessage(reply, [body]);
  } catch {
    // Never include password, cookie, token, SQL bindings, or resume data in logs/messages.
    parentPort!.postMessage({ type: 'failure', id: job.id });
  } finally { releaseTransferredBuffer(job.body); job.body = null; active = false; }
});
parentPort.postMessage({ type: 'ready' });
