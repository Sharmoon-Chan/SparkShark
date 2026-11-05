/// <reference types="node" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'fflate';
import { readCompressedFont, type CompressedFontFile } from './fontDelivery';

const original = Uint8Array.from([0, 1, 0, 0, ...new TextEncoder().encode('A complete sfnt is passed through unchanged')]);
const compressed = gzipSync(original);
const hash = async (data: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data.slice().buffer as ArrayBuffer))].map(value => value.toString(16).padStart(2, '0')).join('');
const file: CompressedFontFile = { file: 'sample.ttf', sha256: await hash(original), compressed: {
  file: 'compressed/sample.hash.ttf.gz', bytes: compressed.length, originalBytes: original.length,
  sha256: await hash(compressed),
} };
afterEach(() => vi.unstubAllGlobals());

describe('lossless compressed font delivery', () => {
  it('restores original TTF bytes with native gzip decompression', async () => {
    const fetcher = vi.fn(async () => new Response(compressed)); vi.stubGlobal('fetch', fetcher);
    const blob = await readCompressedFont('/fonts', file);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(original);
    expect(blob.type).toBe('font/ttf');
    expect(fetcher).toHaveBeenCalledWith('/fonts/compressed/sample.hash.ttf.gz', { signal: undefined });
  });

  it('supports engines without DecompressionStream', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    vi.stubGlobal('fetch', async () => new Response(compressed));
    expect(new Uint8Array(await (await readCompressedFont('/fonts', file)).arrayBuffer())).toEqual(original);
  });

  it('accepts HTTP-level decoded content and rejects corruption', async () => {
    vi.stubGlobal('fetch', async () => new Response(original));
    expect(new Uint8Array(await (await readCompressedFont('/fonts', file)).arrayBuffer())).toEqual(original);
    const broken = original.slice(); broken[8] ^= 1;
    vi.stubGlobal('fetch', async () => new Response(broken));
    await expect(readCompressedFont('/fonts', file)).rejects.toThrow('校验失败');
  });

  it('does not fetch cancelled work and forwards cancellation to a pending download', async () => {
    const controller = new AbortController(); controller.abort();
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(readCompressedFont('/fonts', file, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
    const active = new AbortController();
    vi.stubGlobal('fetch', (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
    }));
    const pending = readCompressedFont('/fonts', file, active.signal);
    active.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
