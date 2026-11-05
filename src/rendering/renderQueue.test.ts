import { describe, expect, it } from 'vitest';
import { RenderQueue } from './renderQueue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe('PDF scheduling', () => {
  it('lets a current preview pass queued thumbnails while keeping rendering serial', async () => {
    const queue = new RenderQueue<number>(), first = deferred<number>();
    const order: string[] = [];
    const a = queue.enqueue('active', () => { order.push('active'); return first.promise; }, { priority: 'background' });
    await Promise.resolve();
    const b = queue.enqueue('thumbnail', async () => { order.push('thumbnail'); return 2; }, { priority: 'background' });
    const c = queue.enqueue('current', async () => { order.push('current'); return 3; });
    expect(order).toEqual(['active']);
    first.resolve(1);
    await Promise.all([a, b, c]);
    expect(order).toEqual(['active', 'current', 'thumbnail']);
  });

  it('deduplicates an in-flight thumbnail and preview without cancelling the surviving caller', async () => {
    const queue = new RenderQueue<number>(), work = deferred<number>(), controller = new AbortController();
    let calls = 0, workerSignal: AbortSignal | undefined;
    const thumbnail = queue.enqueue('same', signal => { calls++; workerSignal = signal; return work.promise; }, { priority: 'background', signal: controller.signal });
    const current = queue.enqueue('same', async () => 99);
    await Promise.resolve();
    const cancelled = expect(thumbnail).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    expect(workerSignal?.aborted).toBe(false);
    work.resolve(7);
    await cancelled;
    expect(await current).toBe(7);
    expect(calls).toBe(1);
  });

  it('removes cancelled queued work before it reaches the worker', async () => {
    const queue = new RenderQueue<number>(), work = deferred<number>(), controller = new AbortController();
    const current = queue.enqueue('current', () => work.promise);
    let calls = 0;
    const obsolete = queue.enqueue('obsolete', async () => { calls++; return 2; }, { signal: controller.signal });
    const cancelled = expect(obsolete).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); work.resolve(1);
    await Promise.all([current, cancelled]);
    expect(calls).toBe(0);
  });

  it('signals abandoned active work and can schedule the same key again', async () => {
    const queue = new RenderQueue<number>(), work = deferred<number>(), controller = new AbortController();
    let signal: AbortSignal | undefined;
    const old = queue.enqueue('same', value => { signal = value; return work.promise; }, { signal: controller.signal });
    await Promise.resolve();
    const cancelled = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    expect(signal?.aborted).toBe(true);
    const current = queue.enqueue('same', async () => 8);
    work.resolve(1);
    await cancelled;
    expect(await current).toBe(8);
  });

  it('continues after a rendering failure', async () => {
    const queue = new RenderQueue<number>();
    const bad = queue.enqueue('bad', async () => { throw new Error('broken'); });
    const good = queue.enqueue('good', async () => 2);
    await expect(bad).rejects.toThrow('broken');
    expect(await good).toBe(2);
  });
});
