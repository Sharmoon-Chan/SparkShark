import { Worker } from 'node:worker_threads';
import type { ApiFailure, ApiJob, ApiReply, WorkerConfiguration } from './protocol';

interface Slot {
  worker: Worker; ready: boolean; inUse: boolean; dead: boolean; generation: number;
  active?: { id: number; resolve: (reply: ApiReply) => void; reject: (error: Error) => void };
  restart?: ReturnType<typeof setTimeout>;
}
interface Waiter { resolve: (lease: ApiLease) => void; reject: (error: Error) => void; signal?: AbortSignal;
  abort: () => void; timer: ReturnType<typeof setTimeout>; }
export interface ApiLease { run(job: Omit<ApiJob, 'type' | 'id'>): Promise<ApiReply>; release(): void; }
export class ApiPoolBusy extends Error {}

export class ApiWorkerPool {
  private readonly slots: Slot[] = [];
  private readonly waiting: Waiter[] = [];
  private closing = false;
  private nextId = 1;

  constructor(private workerPath: string, private configuration: WorkerConfiguration,
    private options: { size?: number; maxQueue?: number; queueTimeoutMs?: number } = {}) {
    const size = options.size ?? 1;
    if (![1, 2].includes(size)) throw new Error('API worker count must be 1 or 2');
    for (let index = 0; index < size; index++) {
      const slot = { ready: false, inUse: false, dead: true, generation: 0 } as Slot;
      this.slots.push(slot); this.spawn(slot);
    }
  }

  private spawn(slot: Slot): void {
    if (this.closing) return;
    slot.generation++; slot.dead = false; slot.ready = false; slot.inUse = false;
    const worker = new Worker(this.workerPath, { workerData: this.configuration, execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 } });
    slot.worker = worker;
    const failed = () => {
      if (slot.worker !== worker || slot.dead) return;
      slot.dead = true; slot.ready = false;
      slot.active?.reject(new Error('API worker unavailable')); slot.active = undefined;
      if (!this.closing) slot.restart = setTimeout(() => this.spawn(slot), 250);
    };
    worker.on('error', failed);
    worker.on('exit', failed);
    worker.on('message', (reply: ApiReply | ApiFailure | { type: 'ready' }) => {
      if (slot.worker !== worker || slot.dead) return;
      if (reply.type === 'ready') { slot.ready = true; this.pump(); return; }
      const active = slot.active;
      if (!active || reply.id !== active.id) return;
      slot.active = undefined;
      if (reply.type === 'response') active.resolve(reply);
      else active.reject(new Error('API request failed'));
    });
  }

  async ready(): Promise<void> {
    const started = Date.now();
    while (!this.slots.every(slot => slot.ready)) {
      if (this.closing || Date.now() - started > 10000) throw new Error('API workers failed to initialize');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  private lease(slot: Slot): ApiLease {
    slot.inUse = true;
    const generation = slot.generation;
    let released = false, called = false;
    return {
      run: job => {
        if (released || called || slot.dead || slot.generation !== generation) return Promise.reject(new Error('API lease unavailable'));
        called = true;
        return new Promise((resolve, reject) => {
          const id = this.nextId++;
          slot.active = { id, resolve, reject };
          const request: ApiJob = { ...job, type: 'request', id };
          try { slot.worker.postMessage(request, job.body ? [job.body] : []); }
          catch { slot.active = undefined; reject(new Error('API dispatch failed')); }
        });
      },
      release: () => {
        if (released) return;
        released = true;
        if (slot.generation === generation) { slot.inUse = false; this.pump(); }
      },
    };
  }

  acquire(signal?: AbortSignal): Promise<ApiLease> {
    if (this.closing || signal?.aborted) return Promise.reject(new ApiPoolBusy('Request cancelled'));
    const available = this.slots.find(slot => slot.ready && !slot.dead && !slot.inUse);
    if (available) return Promise.resolve(this.lease(available));
    if (this.waiting.length >= (this.options.maxQueue ?? 16)) return Promise.reject(new ApiPoolBusy('API queue full'));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal } as Waiter;
      const remove = () => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        clearTimeout(waiter.timer); signal?.removeEventListener('abort', waiter.abort);
      };
      waiter.abort = () => { remove(); reject(new ApiPoolBusy('Request cancelled')); };
      waiter.timer = setTimeout(() => { remove(); reject(new ApiPoolBusy('API queue timeout')); }, this.options.queueTimeoutMs ?? 15000);
      signal?.addEventListener('abort', waiter.abort, { once: true });
      this.waiting.push(waiter);
    });
  }

  private pump(): void {
    if (this.closing) return;
    for (const slot of this.slots) {
      if (!slot.ready || slot.dead || slot.inUse || !this.waiting.length) continue;
      const waiter = this.waiting.shift()!;
      clearTimeout(waiter.timer); waiter.signal?.removeEventListener('abort', waiter.abort);
      if (waiter.signal?.aborted) { waiter.reject(new ApiPoolBusy('Request cancelled')); continue; }
      waiter.resolve(this.lease(slot));
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const waiter of this.waiting.splice(0)) {
      clearTimeout(waiter.timer); waiter.signal?.removeEventListener('abort', waiter.abort);
      waiter.reject(new ApiPoolBusy('Server shutting down'));
    }
    for (const slot of this.slots) clearTimeout(slot.restart);
    await Promise.all(this.slots.map(slot => slot.worker.terminate()));
  }
}
