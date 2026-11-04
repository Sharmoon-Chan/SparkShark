export class AdmissionBusy extends Error {}
interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort: () => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RequestAdmission {
  private active = false;
  private readonly waiting: Waiter[] = [];
  constructor(private maxWaiting = 8, private timeoutMs = 10000) {
    if (!Number.isInteger(maxWaiting) || maxWaiting < 0 || maxWaiting > 8 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
      throw new Error('Invalid Durable Object admission limits');
    }
  }

  private grant(): () => void {
    this.active = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = false;
      while (this.waiting.length) {
        const waiter = this.waiting.shift()!;
        clearTimeout(waiter.timer); waiter.signal?.removeEventListener('abort', waiter.abort);
        if (waiter.signal?.aborted) { waiter.reject(new AdmissionBusy('Request cancelled')); continue; }
        waiter.resolve(this.grant()); return;
      }
    };
  }

  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new AdmissionBusy('Request cancelled'));
    if (!this.active) return Promise.resolve(this.grant());
    if (this.waiting.length >= this.maxWaiting) return Promise.reject(new AdmissionBusy('Durable Object request queue full'));
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal } as Waiter;
      const remove = () => {
        const index = this.waiting.indexOf(waiter);
        if (index >= 0) this.waiting.splice(index, 1);
        clearTimeout(waiter.timer); signal?.removeEventListener('abort', waiter.abort);
      };
      waiter.abort = () => { remove(); reject(new AdmissionBusy('Request cancelled')); };
      waiter.timer = setTimeout(() => { remove(); reject(new AdmissionBusy('Durable Object request queue timeout')); }, this.timeoutMs);
      signal?.addEventListener('abort', waiter.abort, { once: true });
      this.waiting.push(waiter);
    });
  }
}
