import { DurableObject } from 'cloudflare:workers';
import application from '../src/index';
import type { Env as ApiEnv } from '../src/security';
import { DurableSqlD1Database } from './sqlite-d1';
import { initializeSchema } from './schema';
import { AdmissionBusy, RequestAdmission } from './request-admission';

export interface FreeEnv {
  STATE: DurableObjectNamespace<MyResumeState>;
  ASSETS?: Fetcher;
  APP_ORIGIN: string;
  BOOTSTRAP_TOKEN?: string;
  AUTH_RATE_LIMIT?: ApiEnv['AUTH_RATE_LIMIT'];
}

function busyResponse(): Response {
  return new Response(JSON.stringify({ error: { code: 'SERVICE_BUSY', message: '云端服务正在处理其他请求，请稍后重试。本机内容已保留' } }),
    { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export class MyResumeState extends DurableObject<FreeEnv> {
  readonly database: DurableSqlD1Database;
  private readonly admission = new RequestAdmission();
  constructor(ctx: DurableObjectState, env: FreeEnv) {
    super(ctx, env);
    this.database = new DurableSqlD1Database(ctx.storage);
    ctx.blockConcurrencyWhile(async () => { await initializeSchema(this.database); });
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== '/api' && !path.startsWith('/api/')) return new Response('Not found', { status: 404 });
    let release: () => void;
    try { release = await this.admission.acquire(request.signal); }
    catch (error) {
      if (!(error instanceof AdmissionBusy)) throw error;
      await request.body?.cancel().catch(() => undefined);
      return busyResponse();
    }
    // Take a body reader only after admission; waiting requests never parse or read uploads.
    let input: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let inputDone = false, processing = true, finished = false;
    let output: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let outputController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = async (reason?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(drainTimer);
      request.signal?.removeEventListener('abort', abort);
      if (input && !inputDone) await input.cancel(reason).catch(() => undefined);
      try { input?.releaseLock(); } catch { /* A cancelled reader may already have released its lock. */ }
      try { output?.releaseLock(); } catch { /* Pending cancellation/read will settle independently. */ }
      outputController = undefined;
      release();
    };
    const abort = () => {
      const reason = new Error('Request cancelled');
      void input?.cancel(reason).catch(() => undefined);
      if (!processing) {
        outputController?.error(reason); // Discard any chunk already queued in the response wrapper.
        void output?.cancel(reason).catch(() => undefined).finally(() => finish());
      }
    };
    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) { await finish(); return busyResponse(); }
    try {
    let forwarded = request;
    if (request.body) {
      input = request.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await input!.read();
            if (chunk.done) { inputDone = true; controller.close(); }
            else controller.enqueue(chunk.value);
          } catch (error) { controller.error(error); }
        },
        async cancel(reason) { await input!.cancel(reason).catch(() => undefined); },
      });
      forwarded = new Request(request, { body });
    }
    const apiEnv: ApiEnv = { DB: this.database as unknown as D1Database,
      APP_ORIGIN: this.env.APP_ORIGIN, BOOTSTRAP_TOKEN: this.env.BOOTSTRAP_TOKEN,
      AUTH_RATE_LIMIT: this.env.AUTH_RATE_LIMIT };
    // Password hashing, JSON parsing, quotas, CAS, and SQLite all run inside this object.
    let response: Response;
    try { response = await application.fetch(forwarded, apiEnv); }
    catch (error) { processing = false; await finish(error); throw error; }
    processing = false;
    if (request.signal?.aborted) { await response.body?.cancel().catch(() => undefined); await finish(); return busyResponse(); }
    if (!response.body) { await finish(); return response; }
    output = response.body.getReader();
    // Keep the sole parser slot until its response drains/cancels; otherwise a
    // buffered 5 MiB document can overlap the next large document's allocations.
    const body = new ReadableStream<Uint8Array>({
      start(controller) { outputController = controller; },
      async pull(controller) {
        try {
          const chunk = await output!.read();
          if (chunk.done) { controller.close(); await finish(); }
          else controller.enqueue(chunk.value);
        } catch (error) { controller.error(error); await finish(error); }
      },
      async cancel(reason) { await output!.cancel(reason).catch(() => undefined); await finish(reason); },
    });
    // Bound a disconnected/stalled outgoing stream without holding this object's slot forever.
    drainTimer = setTimeout(() => {
      const reason = new Error('Response drain timeout');
      outputController?.error(reason);
      void output!.cancel(reason).catch(() => undefined).finally(() => finish());
    }, 30000);
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { processing = false; await finish(error); throw error; }
  }
}
