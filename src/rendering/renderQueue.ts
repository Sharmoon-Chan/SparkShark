export type RenderPriority = 'preview' | 'background';
export const renderCancelled = () => new DOMException('操作已取消', 'AbortError');

type Listener<T> = { resolve: (value: T) => void; reject: (error: unknown) => void; cleanup: () => void };
type Job<T> = { key: string; priority: RenderPriority; run: (signal: AbortSignal) => Promise<T>; controller: AbortController; listeners: Set<Listener<T>> };

// Keep react-pdf serial, but let the user's current preview pass queued thumbnails.
// Identical requests share work; cancelling one caller never cancels another.
export class RenderQueue<T> {
  private jobs = new Map<string, Job<T>>();
  private active: Job<T> | null = null;
  private scheduled = false;

  enqueue(key: string, run: Job<T>['run'], { signal, priority = 'preview' }: { signal?: AbortSignal; priority?: RenderPriority } = {}): Promise<T> {
    if (signal?.aborted) return Promise.reject(renderCancelled());
    let job = this.jobs.get(key);
    if (!job || job.controller.signal.aborted) {
      job = { key, run, priority, controller: new AbortController(), listeners: new Set() };
      this.jobs.set(key, job);
    } else if (priority === 'preview') job.priority = priority;
    const target = job;
    const promise = new Promise<T>((resolve, reject) => {
      const abort = () => {
        target.listeners.delete(listener);
        listener.cleanup();
        reject(renderCancelled());
        if (!target.listeners.size) {
          target.controller.abort();
          if (this.jobs.get(key) === target) this.jobs.delete(key);
        }
      };
      const listener: Listener<T> = { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) };
      target.listeners.add(listener);
      signal?.addEventListener('abort', abort, { once: true });
    });
    this.schedule();
    return promise;
  }

  private schedule() {
    if (this.active || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; void this.drain(); });
  }

  private async drain() {
    if (this.active) return;
    const pending = [...this.jobs.values()].filter(job => job.listeners.size && !job.controller.signal.aborted);
    const job = pending.find(job => job.priority === 'preview') ?? pending[0];
    if (!job) return;
    this.active = job;
    try {
      const result = await job.run(job.controller.signal);
      for (const listener of job.listeners) { listener.cleanup(); listener.resolve(result); }
    } catch (error) {
      for (const listener of job.listeners) { listener.cleanup(); listener.reject(error); }
    } finally {
      job.listeners.clear();
      if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
      this.active = null;
      this.schedule();
    }
  }
}
