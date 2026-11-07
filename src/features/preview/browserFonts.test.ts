import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type API = typeof import('./browserFonts');
type Manifest = ReturnType<API['parseBrowserFontManifest']>;
type Controller = ReturnType<API['createBrowserFontController']>;
let api: API;
let manifest: Manifest;
let files: Map<string, Uint8Array>;
let controllers: Controller[];
const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer))].map(byte => byte.toString(16).padStart(2, '0')).join('');

class FakeFontFace {
  static instances: FakeFontFace[] = [];
  status = 'unloaded';
  constructor(readonly family: string, readonly source: ArrayBuffer, readonly descriptors: FontFaceDescriptors) { FakeFontFace.instances.push(this); }
  async load() { this.status = 'loaded'; return this; }
}
function fakeDocument() {
  return { URL: 'https://resume.test/', defaultView: { FontFace: FakeFontFace }, fonts: new Set<FakeFontFace>() } as unknown as Document;
}
function controller(document = fakeDocument(), onStatus?: Parameters<API['createBrowserFontController']>[1]) {
  const created = api.createBrowserFontController(document, onStatus); controllers.push(created); return created;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function installFetch(handler?: (path: string, options: RequestInit | undefined) => Promise<Response> | undefined) {
  const fetcher = vi.fn(async (url: URL | string, options?: RequestInit) => {
    const path = new URL(url).pathname.replace(/^\/fonts\//, '');
    if (path.startsWith('browser-manifests/')) {
      const id = path.slice('browser-manifests/'.length, -'.json'.length);
      return new Response(JSON.stringify({ version: 1, families: { [id]: manifest.families[id] } }));
    }
    const custom = handler?.(path, options); if (custom) return custom;
    const bytes = files.get(path);
    if (!bytes) return new Response('', { status: 404 });
    return new Response(bytes.slice().buffer as ArrayBuffer);
  });
  vi.stubGlobal('fetch', fetcher); return fetcher;
}
function paths(fetcher: ReturnType<typeof installFetch>) { return fetcher.mock.calls.map(([url]) => new URL(url).pathname); }

beforeEach(async () => {
  vi.resetModules();
  api = await import('./browserFonts');
  files = new Map(); controllers = []; FakeFontFace.instances = [];
  manifest = { version: 1, families: {} };
  for (const [id, family] of [['noto-sans-sc', 'PreviewMyResumeSansSC'], ['noto-serif-sc', 'PreviewMyResumeSerifSC']]) {
    const chunks = [{ id: 'base', ranges: [[65, 67]] }, { id: 'han', ranges: [[0x4e2d, 0x4e2d]] }];
    const faces = [];
    for (const weight of [400, 700]) for (const style of ['normal', 'italic'] as const) {
      const parts = [];
      for (const chunk of chunks) {
        const bytes = new TextEncoder().encode(`${id}:${weight}:${style}:${chunk.id}`);
        const file = `browser/${id}-${weight}-${style}-${chunk.id}.woff2`;
        files.set(file, bytes);
        parts.push({ chunk: chunk.id, file, bytes: bytes.byteLength, sha256: await digest(bytes) });
      }
      faces.push({ weight, style, parts });
    }
    manifest.families[id] = { family, coverage: [[65, 67], [0x4e2d, 0x4e2d]], chunks, faces };
  }
});
afterEach(() => { controllers.forEach(item => item.dispose()); vi.unstubAllGlobals(); });

describe('browser preview font demand loading', () => {
  it('requests a separate catalog only when its family is selected and reuses it on return', async () => {
    const fetcher = installFetch(), load = controller();
    await load.update('noto-sans-sc', 'A');
    expect(paths(fetcher).filter(path => path.includes('browser-manifests/'))).toEqual(['/fonts/browser-manifests/noto-sans-sc.json']);
    await load.update('noto-serif-sc', 'A'); await load.update('noto-sans-sc', 'A');
    expect(paths(fetcher).filter(path => path.includes('browser-manifests/'))).toEqual(['/fonts/browser-manifests/noto-sans-sc.json', '/fonts/browser-manifests/noto-serif-sc.json']);
  });

  it('loads body-only characters only in the regular face and adds bold or italic ranges when used', async () => {
    const fetcher = installFetch(), load = controller();
    const usage: import('./browserFonts').BrowserFontUse[] = [{ weight: 400, style: 'normal', text: 'A中' }, { weight: 700, style: 'normal', text: 'A' }];
    expect(await load.update('noto-sans-sc', 'A中', false, usage)).toMatchObject({ loaded: 3, total: 3 });
    expect(paths(fetcher).some(path => path.includes('700-normal-han'))).toBe(false);
    expect(paths(fetcher).some(path => path.includes('italic'))).toBe(false);
    usage[1].text += '中';
    expect(await load.update('noto-sans-sc', 'A中', false, usage)).toMatchObject({ loaded: 4, total: 4 });
    usage.push({ weight: 400, style: 'italic', text: 'A' });
    expect(await load.update('noto-sans-sc', 'A中', false, usage)).toMatchObject({ loaded: 5, total: 5 });
    expect(paths(fetcher).some(path => path.includes('700-italic'))).toBe(false);
  });

  it('loads only selected glyph ranges and faces as verified ArrayBuffers, then reuses them while typing', async () => {
    const statuses: string[] = [];
    const fetcher = installFetch(), document = fakeDocument(), load = controller(document, status => statuses.push(status.state));
    const first = await load.update('noto-sans-sc', 'A');
    expect(first).toMatchObject({ state: 'ready', loaded: 2, total: 2 });
    expect(FakeFontFace.instances.every(face => face.source instanceof ArrayBuffer && face.descriptors.unicodeRange === 'U+41-43')).toBe(true);
    expect(FakeFontFace.instances.map(face => face.descriptors.weight)).toEqual(['400', '700']);
    statuses.length = 0;
    await load.update('noto-sans-sc', 'ABCAB');
    expect(statuses).toEqual(['ready']);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await load.update('noto-sans-sc', 'ABC中');
    expect(fetcher).toHaveBeenCalledTimes(5);
    await load.update('noto-sans-sc', 'ABC中', true);
    expect(fetcher).toHaveBeenCalledTimes(9);
    expect(paths(fetcher).some(path => path.includes('serif'))).toBe(false);
    expect(document.fonts.size).toBe(8);
  });

  it('does not abort shared in-flight work when the same family updates before completion', async () => {
    const pending: Array<{ gate: ReturnType<typeof deferred<Response>>; signal: AbortSignal }> = [];
    const fetcher = installFetch((_path, options) => {
      const gate = deferred<Response>(); pending.push({ gate, signal: options!.signal as AbortSignal });
      return gate.promise;
    });
    const load = controller();
    const old = load.update('noto-sans-sc', 'A'); const oldResult = old.catch(error => error);
    await vi.waitFor(() => expect(pending.length).toBe(2));
    const current = load.update('noto-sans-sc', 'AB');
    await Promise.resolve();
    expect(pending.every(item => !item.signal.aborted)).toBe(true);
    pending.forEach((item, index) => item.gate.resolve(new Response(files.get(paths(fetcher)[index + 1].replace('/fonts/', ''))!.slice().buffer as ArrayBuffer)));
    expect((await oldResult).name).toBe('AbortError');
    expect(await current).toMatchObject({ state: 'ready', loaded: 2 });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('cancels obsolete A→B→A requests without poisoning the retry or reporting stale success', async () => {
    const pending: Array<{ path: string; signal: AbortSignal; gate: ReturnType<typeof deferred<Response>> }> = [];
    installFetch((path, options) => {
      const signal = options!.signal as AbortSignal, gate = deferred<Response>();
      signal.addEventListener('abort', () => gate.reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      pending.push({ path, signal, gate }); return gate.promise;
    });
    const reports: import('./browserFonts').BrowserFontStatus[] = [], load = controller(fakeDocument(), status => reports.push(status));
    const a = load.update('noto-sans-sc', 'A').catch(error => error);
    await vi.waitFor(() => expect(pending.length).toBe(2));
    const b = load.update('noto-serif-sc', 'A').catch(error => error);
    await vi.waitFor(() => expect(pending.length).toBe(4));
    expect(pending.slice(0, 2).every(item => item.signal.aborted)).toBe(true);
    const current = load.update('noto-sans-sc', 'A');
    await vi.waitFor(() => expect(pending.length).toBe(6));
    expect(pending.slice(2, 4).every(item => item.signal.aborted)).toBe(true);
    pending.slice(4).forEach(item => item.gate.resolve(new Response(files.get(item.path)!.slice().buffer as ArrayBuffer)));
    expect((await a).name).toBe('AbortError'); expect((await b).name).toBe('AbortError');
    expect(await current).toMatchObject({ state: 'ready', family: 'PreviewMyResumeSansSC' });
    expect(reports.filter(status => status.state === 'ready').map(status => status.family)).toEqual(['PreviewMyResumeSansSC']);
  });

  it('keeps a shared document consumer alive when another controller is disposed', async () => {
    const pending: Array<{ path: string; signal: AbortSignal; gate: ReturnType<typeof deferred<Response>> }> = [];
    const fetcher = installFetch((path, options) => { const gate = deferred<Response>(); pending.push({ path, signal: options!.signal as AbortSignal, gate }); return gate.promise; });
    const document = fakeDocument(), first = controller(document), attached: number[] = [], second = controller(document, status => attached.push(status.total));
    const old = first.update('noto-sans-sc', 'A').catch(error => error);
    await vi.waitFor(() => expect(pending.length).toBe(2));
    const current = second.update('noto-sans-sc', 'A');
    await vi.waitFor(() => expect(attached).toContain(2)); first.dispose();
    expect(pending.every(item => !item.signal.aborted)).toBe(true);
    pending.forEach(item => item.gate.resolve(new Response(files.get(item.path)!.slice().buffer as ArrayBuffer)));
    expect((await old).name).toBe('AbortError'); expect((await current).state).toBe('ready');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('bounds concurrent downloads and never fetches abandoned queued shards', async () => {
    const pending: AbortSignal[] = [];
    const fetcher = installFetch((_path, options) => new Promise((_resolve, reject) => {
      const signal = options!.signal as AbortSignal; pending.push(signal);
      signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    }));
    const document = fakeDocument(), load = controller(document);
    const result = load.update('noto-sans-sc', 'A中', true).catch(error => error);
    await vi.waitFor(() => expect(pending.length).toBe(6));
    load.dispose();
    expect((await result).name).toBe('AbortError');
    expect(fetcher).toHaveBeenCalledTimes(7); // One manifest plus six active font requests.
    expect(pending.every(signal => signal.aborted)).toBe(true);
    expect(document.fonts.size).toBe(0);
  });

  it('reports fallback after a download failure and can recover on a later update', async () => {
    let fail = true;
    installFetch(path => fail && path.includes('400') ? Promise.resolve(new Response('', { status: 503 })) : undefined);
    const load = controller();
    const broken = await load.update('noto-sans-sc', 'A');
    expect(broken).toMatchObject({ state: 'fallback', total: 2, loaded: 1 });
    fail = false;
    expect(await load.update('noto-sans-sc', 'A')).toMatchObject({ state: 'ready', loaded: 2 });
  });

  it('rejects corrupt or oversized bytes before constructing FontFace', async () => {
    installFetch(async () => new Response(new Uint8Array([0]).buffer));
    expect((await controller().update('noto-sans-sc', 'A')).state).toBe('fallback');
    expect(FakeFontFace.instances).toHaveLength(0);
    installFetch(async path => {
      const original = files.get(path)!;
      const wrong = original.slice(); wrong[0] ^= 1;
      return new Response(wrong.buffer as ArrayBuffer);
    });
    expect((await controller().update('noto-sans-sc', 'A')).error).toContain('校验失败');
    expect(FakeFontFace.instances).toHaveLength(0);
    installFetch(async path => new Response(new Uint8Array(files.get(path)!.byteLength + 1).buffer));
    expect((await controller().update('noto-sans-sc', 'A')).error).toContain('大小限制');
    expect(FakeFontFace.instances).toHaveLength(0);
  });

  it('preserves fallback if native font decoding rejects verified bytes', async () => {
    installFetch();
    class RejectingFontFace extends FakeFontFace { async load(): Promise<this> { throw new Error('Native font decode failed'); } }
    const document = { URL: 'https://resume.test/', defaultView: { FontFace: RejectingFontFace }, fonts: new Set() } as unknown as Document;
    expect(await controller(document).update('noto-sans-sc', 'A')).toMatchObject({ state: 'fallback', error: 'Native font decode failed' });
    expect(document.fonts.size).toBe(0);
  });

  it('reports unsupported characters and ignores line separators without requesting nonexistent shards', async () => {
    const fetcher = installFetch();
    const result = await controller().update('noto-sans-sc', 'A\n\t😀😀\r');
    expect(result).toMatchObject({ state: 'fallback', total: 2, loaded: 2, missingCharacters: ['😀'] });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(api.browserFontFamily('toString')).toBe('PreviewMyResumeSansSC');
  });

  it('registers identical bytes under different family descriptors independently', async () => {
    const sans = manifest.families['noto-sans-sc'], serif = manifest.families['noto-serif-sc'];
    serif.faces.forEach((face, index) => { face.parts = structuredClone(sans.faces[index].parts); });
    installFetch(); const document = fakeDocument(), load = controller(document);
    await load.update('noto-sans-sc', 'A'); await load.update('noto-serif-sc', 'A');
    expect([...document.fonts].map(face => face.family)).toEqual(['PreviewMyResumeSansSC', 'PreviewMyResumeSansSC', 'PreviewMyResumeSerifSC', 'PreviewMyResumeSerifSC']);
  });

  it('does not evict active glyphs when the ready cache exceeds its entry budget', async () => {
    const family = manifest.families['noto-sans-sc'];
    family.chunks = Array.from({ length: 42 }, (_, i) => ({ id: `chunk-${i}`, ranges: [[65 + i, 65 + i]] }));
    family.coverage = [[65, 106]];
    for (const face of family.faces) {
      const original = face.parts[0];
      face.parts = family.chunks.map(chunk => ({ ...original, chunk: chunk.id }));
    }
    const fetcher = installFetch(), document = fakeDocument(), load = controller(document), text = Array.from({ length: 42 }, (_, i) => String.fromCharCode(65 + i)).join('');
    expect((await load.update('noto-sans-sc', text, true)).loaded).toBe(168);
    expect(document.fonts.size).toBe(168);
    const requests = fetcher.mock.calls.length;
    expect((await load.update('noto-sans-sc', text, true)).state).toBe('ready');
    expect(fetcher).toHaveBeenCalledTimes(requests);
    load.dispose(); expect(document.fonts.size).toBe(160);
  });
});

describe('browser font manifest validation', () => {
  it('accepts valid complete coverage and refuses external paths, overlapping ranges and missing faces', () => {
    expect(api.parseBrowserFontManifest(manifest)).toBe(manifest);
    const badPath = structuredClone(manifest); badPath.families['noto-sans-sc'].faces[0].parts[0].file = 'https://example.com/font.woff2';
    expect(() => api.parseBrowserFontManifest(badPath)).toThrow('分片');
    const overlap = structuredClone(manifest); overlap.families['noto-sans-sc'].chunks[1].ranges = [[67, 0x4e2d]];
    expect(() => api.parseBrowserFontManifest(overlap)).toThrow('重叠');
    const missing = structuredClone(manifest); missing.families['noto-sans-sc'].faces.pop();
    expect(() => api.parseBrowserFontManifest(missing)).toThrow();
    const duplicate = structuredClone(manifest); duplicate.families['noto-sans-sc'].faces[0].parts[1] = duplicate.families['noto-sans-sc'].faces[0].parts[0];
    expect(() => api.parseBrowserFontManifest(duplicate)).toThrow();
  });

  it('rejects an oversized streamed manifest and recovers without retaining a rejected promise', async () => {
    const bad = vi.fn(async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    vi.stubGlobal('fetch', bad);
    expect((await controller().update('noto-sans-sc', 'A')).state).toBe('fallback');
    installFetch();
    expect((await controller().update('noto-sans-sc', 'A')).state).toBe('ready');
  });
});
