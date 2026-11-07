export interface BrowserFontStatus {
  state: 'loading' | 'ready' | 'fallback';
  family: string;
  loaded: number;
  total: number;
  bytes: number;
  missingCharacters: string[];
  error?: string;
}
interface Chunk { id: string; ranges: number[][] }
interface Part { chunk: string; file: string; sha256: string; bytes: number }
interface Face { weight: number; style: 'normal' | 'italic'; parts: Part[] }
interface Family { family: string; coverage: number[][]; chunks: Chunk[]; faces: Face[] }
interface BrowserFontManifest { version: number; families: Record<string, Family> }
interface FontRequest extends Part { family: string; weight: number; style: 'normal' | 'italic'; ranges: number[][] }
export interface BrowserFontUse { weight: 400 | 700; style: 'normal' | 'italic'; text: string }

const FAMILIES: Record<string, string> = {
  'noto-sans-sc': 'PreviewMyResumeSansSC', 'noto-serif-sc': 'PreviewMyResumeSerifSC',
  'lxgw-wenkai': 'PreviewMyResumeWenKaiTC', 'ibm-plex-sans-sc': 'PreviewMyResumePlexSansSC',
  'chiron-round-tc': 'PreviewMyResumeRoundTC', 'source-han-sans-sc': 'PreviewMyResumeSourceHanSansSC',
};
export const browserFontFamily = (fontId: string): string => Object.hasOwn(FAMILIES, fontId) ? FAMILIES[fontId] : FAMILIES['noto-sans-sc'];
const knownFontId = (fontId: string) => Object.hasOwn(FAMILIES, fontId) ? fontId : 'noto-sans-sc';
const abortError = () => new DOMException('字体加载已取消', 'AbortError');
const contains = (ranges: number[][], point: number) => ranges.some(([start, end]) => point >= start && point <= end);
const unicodeRange = (ranges: number[][]) => ranges.map(([start, end]) => `U+${start.toString(16)}${end === start ? '' : '-' + end.toString(16)}`).join(',');
const manifestCache = new Map<string, Promise<BrowserFontManifest>>();
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function validRanges(value: unknown): value is number[][] {
  if (!Array.isArray(value) || !value.length || value.length > 8192) return false;
  let previous = -1;
  for (const range of value) {
    if (!Array.isArray(range) || range.length !== 2) return false;
    const [start, end] = range;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 0x10ffff || start > end || start <= previous || (start <= 0xdfff && end >= 0xd800)) return false;
    previous = end;
  }
  return true;
}
function mergedRanges(ranges: number[][]): number[][] {
  const merged: number[][] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) throw new Error('字体分片范围重叠');
    if (previous && start === previous[1] + 1) previous[1] = end;
    else merged.push([start, end]);
  }
  return merged;
}

/** Validate bounded, same-origin delivery metadata before requesting any font. */
export function parseBrowserFontManifest(input: unknown): BrowserFontManifest {
  if (!record(input) || input.version !== 1 || !record(input.families)) throw new Error('字体目录无效');
  const families = Object.entries(input.families);
  if (!families.length || families.length > Object.keys(FAMILIES).length) throw new Error('字体目录无效');
  for (const [id, family] of families) {
    if (!Object.hasOwn(FAMILIES, id) || !record(family) || family.family !== FAMILIES[id] || !validRanges(family.coverage) || !Array.isArray(family.chunks) || !family.chunks.length || family.chunks.length > 128 || !Array.isArray(family.faces) || family.faces.length !== 4) throw new Error('字体目录与选项不一致');
    const chunks = new Set<string>();
    const ranges: number[][] = [];
    for (const chunk of family.chunks) {
      if (!record(chunk) || typeof chunk.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(chunk.id) || chunks.has(chunk.id) || !validRanges(chunk.ranges)) throw new Error('字体分片范围无效');
      chunks.add(chunk.id); ranges.push(...chunk.ranges);
    }
    if (JSON.stringify(mergedRanges(ranges)) !== JSON.stringify(mergedRanges(family.coverage))) throw new Error('字体覆盖范围不完整');
    const faces = new Set<string>();
    for (const face of family.faces) {
      if (!record(face) || ![400, 700].includes(face.weight as number) || !['normal', 'italic'].includes(face.style as string) || !Array.isArray(face.parts) || face.parts.length !== chunks.size) throw new Error('字体样式无效');
      const identity = `${face.weight}:${face.style}`;
      if (faces.has(identity)) throw new Error('字体样式重复');
      faces.add(identity);
      const parts = new Set<string>();
      for (const part of face.parts) {
        if (!record(part) || typeof part.chunk !== 'string' || !chunks.has(part.chunk) || parts.has(part.chunk) || typeof part.file !== 'string' || !/^browser\/[A-Za-z0-9_.-]{1,160}\.woff2$/.test(part.file) || part.file.includes('..') || typeof part.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(part.sha256) || !Number.isSafeInteger(part.bytes) || (part.bytes as number) <= 0 || (part.bytes as number) > 4 * 1024 * 1024) throw new Error('字体分片无效');
        parts.add(part.chunk);
      }
    }
  }
  return input as unknown as BrowserFontManifest;
}

async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) { await response.body?.cancel(); throw new Error('字体资源超过大小限制'); }
  if (!response.body) throw new Error('字体资源为空');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      size += result.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('字体资源超过大小限制'); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(size);
  let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

function fontBase(document: Document): URL {
  // Resolve against the parent application, never an imported resume URL or a
  // srcdoc base element. Resume data cannot supply resource paths.
  const origin = globalThis.location?.origin ?? new URL(document.URL).origin;
  return new URL(`${import.meta.env.BASE_URL}fonts/`, origin);
}

async function manifestAt(base: URL, fontId: string): Promise<BrowserFontManifest> {
  const id = knownFontId(fontId);
  const url = new URL(`browser-manifests/${id}.json`, base);
  const key = url.href;
  let existing = manifestCache.get(key);
  if (!existing) {
    existing = (async () => {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`字体目录下载失败 (${response.status})`);
      const bytes = await readBounded(response, MAX_MANIFEST_BYTES);
      const catalog = parseBrowserFontManifest(JSON.parse(new TextDecoder().decode(bytes)));
      if (Object.keys(catalog.families).length !== 1 || !catalog.families[id]) throw new Error('字体目录与选项不一致');
      return catalog;
    })();
    manifestCache.set(key, existing);
    void existing.catch(() => { if (manifestCache.get(key) === existing) manifestCache.delete(key); });
  }
  return existing;
}

/** Public for meaningful coverage/request-count tests and offline measurement. */
export function requestedBrowserFontParts(manifest: BrowserFontManifest, fontId: string, text: string, italic = false, usage?: BrowserFontUse[]): { requests: FontRequest[]; missingCharacters: string[] } {
  const familyId = Object.hasOwn(FAMILIES, fontId) ? fontId : 'noto-sans-sc';
  const family = manifest.families[familyId];
  if (!family || family.family !== browserFontFamily(fontId)) throw new Error('字体目录与选项不一致');
  const points = [...new Set(Array.from(text).map(character => character.codePointAt(0)!))].filter(point => ![9, 10, 13].includes(point));
  const chunks = family.chunks.filter(chunk => points.some(point => contains(chunk.ranges, point)));
  const needed = new Map(chunks.map(chunk => [chunk.id, chunk.ranges]));
  const requests: FontRequest[] = [];
  for (const face of family.faces) {
    if (!usage && face.style === 'italic' && !italic) continue;
    const facePoints = usage ? new Set(usage.filter(use => use.weight === face.weight && use.style === face.style).flatMap(use => Array.from(use.text, character => character.codePointAt(0)!))) : null;
    if (facePoints?.size === 0) continue;
    if (![400, 700].includes(face.weight) || !['normal', 'italic'].includes(face.style)) throw new Error('字体样式无效');
    for (const part of face.parts) {
      const ranges = needed.get(part.chunk);
      if (!ranges) continue;
      if (facePoints && ![...facePoints].some(point => contains(ranges, point))) continue;
      if (!/^browser\/[A-Za-z0-9_.-]+\.woff2$/.test(part.file) || part.file.includes('..') || !/^[a-f0-9]{64}$/.test(part.sha256) || !Number.isSafeInteger(part.bytes) || part.bytes <= 0 || part.bytes > 4 * 1024 * 1024) throw new Error('字体分片无效');
      requests.push({ ...part, family: family.family, weight: face.weight, style: face.style, ranges });
    }
  }
  return { requests, missingCharacters: points.filter(point => !contains(family.coverage, point)).map(point => String.fromCodePoint(point)) };
}

type Entry = { key: string; controller: AbortController; consumers: Set<symbol>; promise: Promise<void>; status: 'loading' | 'ready' | 'error'; bytes: number; used: number; face?: FontFace };
type DocumentCache = { entries: Map<string, Entry> };
const documents = new WeakMap<Document, DocumentCache>();
let activeFetches = 0;
const fetchWaiters: Array<() => void> = [];
async function withFetchSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeFetches >= 6) await new Promise<void>(resolve => fetchWaiters.push(resolve));
  else activeFetches++;
  try { return await run(); }
  finally { const next = fetchWaiters.shift(); if (next) next(); else activeFetches--; }
}
// Identical font bytes can legitimately be used by more than one family/face.
// FontFace registration must still honor each distinct descriptor and range.
const requestKey = (request: FontRequest) => `${request.family}:${request.weight}:${request.style}:${request.chunk}:${request.sha256}`;
function trimCache(document: Document, cache: DocumentCache) {
  const unused = [...cache.entries.values()].filter(entry => !entry.consumers.size && entry.status === 'ready').sort((a, b) => a.used - b.used);
  let bytes = [...cache.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  while (unused.length && (cache.entries.size > 160 || bytes > 24 * 1024 * 1024)) {
    const entry = unused.shift()!;
    if (entry.face) document.fonts.delete(entry.face);
    cache.entries.delete(entry.key); bytes -= entry.bytes;
  }
}
function release(document: Document, cache: DocumentCache, entry: Entry, consumer: symbol) {
  entry.consumers.delete(consumer);
  if (!entry.consumers.size && entry.status !== 'ready') {
    entry.controller.abort();
    if (cache.entries.get(entry.key) === entry) cache.entries.delete(entry.key);
  }
  trimCache(document, cache);
}
function acquire(document: Document, cache: DocumentCache, base: URL, request: FontRequest, consumer: symbol): Entry {
  const key = requestKey(request);
  let entry = cache.entries.get(key);
  if (!entry || entry.status === 'error' || entry.controller.signal.aborted) {
    const controller = new AbortController();
    entry = { key, controller, consumers: new Set(), promise: Promise.resolve(), status: 'loading', bytes: request.bytes, used: Date.now() };
    const target = entry;
    target.promise = withFetchSlot(async () => {
      const signal = controller.signal;
      if (signal.aborted) throw abortError();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(new URL(request.file, base), { signal });
        if (!response.ok) throw new Error(`字体下载失败 (${response.status})`);
        const bytes = (await readBounded(response, request.bytes)).buffer as ArrayBuffer;
        if (signal.aborted) throw abortError();
        if (bytes.byteLength !== request.bytes) throw new Error('字体分片长度不符');
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        if ([...digest].map(value => value.toString(16).padStart(2, '0')).join('') !== request.sha256) throw new Error('字体分片校验失败');
        if (signal.aborted) throw abortError();
        const Constructor = (document.defaultView as unknown as { FontFace: typeof FontFace } | null)?.FontFace;
        if (!Constructor || !document.fonts) throw new Error('浏览器不支持渐进字体');
        const face = new Constructor(request.family, bytes, { weight: String(request.weight), style: request.style, display: 'swap', unicodeRange: unicodeRange(request.ranges) });
        await face.load();
        if (signal.aborted) throw abortError();
        document.fonts.add(face);
        target.face = face; target.status = 'ready'; target.used = Date.now();
      } catch (error) { target.status = 'error'; throw error; }
      finally { clearTimeout(timeout); }
    });
    cache.entries.set(key, target);
    // A cancelled update may stop awaiting this task while fetch winds down.
    void target.promise.catch(() => undefined);
  }
  entry.consumers.add(consumer); entry.used = Date.now();
  return entry;
}

export interface BrowserFontController {
  update(fontId: string, text: string, italic?: boolean, usage?: BrowserFontUse[]): Promise<BrowserFontStatus>;
  dispose(): void;
}

/** Keep one controller for a stable preview document. Updates diff required
 * shards; existing glyphs and in-flight shared work survive ordinary typing. */
export function createBrowserFontController(document: Document, onStatus?: (status: BrowserFontStatus) => void): BrowserFontController {
  let cache = documents.get(document);
  if (!cache) { cache = { entries: new Map() }; documents.set(document, cache); }
  const documentCache = cache, base = fontBase(document), consumer = Symbol('preview-fonts');
  let current = new Map<string, Entry>(), sequence = 0, disposed = false;
  return {
    async update(fontId, text, italic = false, usage) {
      const revision = ++sequence;
      const family = browserFontFamily(fontId);
      const report = (state: BrowserFontStatus['state'], requests: FontRequest[] = [], missingCharacters: string[] = [], error?: string): BrowserFontStatus => {
        const value = { state, family, loaded: requests.filter(request => current.get(requestKey(request))?.status === 'ready').length, total: requests.length, bytes: requests.reduce((sum, request) => sum + request.bytes, 0), missingCharacters, ...(error ? { error } : {}) };
        if (!disposed && revision === sequence) onStatus?.(value);
        return value;
      };
      if (disposed) throw abortError();
      try {
        const manifest = await manifestAt(base, fontId);
        if (disposed || revision !== sequence) throw abortError();
        const { requests, missingCharacters } = requestedBrowserFontParts(manifest, fontId, text, italic, usage);
        const next = new Map<string, Entry>();
        // Acquire first so equivalent requests never briefly lose their final
        // consumer and abort while an editor re-renders.
        for (const request of requests) next.set(requestKey(request), acquire(document, documentCache, base, request, consumer));
        for (const [key, entry] of current) if (next.get(key) !== entry) release(document, documentCache, entry, consumer);
        current = next;
        // A keystroke using already loaded glyphs must not flip the preview
        // back to system fonts for one microtask before announcing ready again.
        if ([...next.values()].every(entry => entry.status === 'ready')) return report(missingCharacters.length ? 'fallback' : 'ready', requests, missingCharacters);
        report('loading', requests, missingCharacters);
        const settled = await Promise.allSettled([...next.values()].map(async entry => {
          await entry.promise;
          if (revision === sequence && !disposed) report('loading', requests, missingCharacters);
        }));
        if (disposed || revision !== sequence) throw abortError();
        const failure = settled.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') return report('fallback', requests, missingCharacters, failure.reason instanceof Error ? failure.reason.message : String(failure.reason));
        return report(missingCharacters.length ? 'fallback' : 'ready', requests, missingCharacters);
      } catch (error) {
        if (disposed || revision !== sequence || (error instanceof DOMException && error.name === 'AbortError')) throw abortError();
        return report('fallback', [], [], error instanceof Error ? error.message : String(error));
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true; sequence++;
      for (const entry of current.values()) release(document, documentCache, entry, consumer);
      current.clear();
    },
  };
}

/** Convenience for one request. A stable editor should use the controller API. */
export async function ensureBrowserFonts(document: Document, fontId: string, text: string, options: { signal?: AbortSignal; onStatus?: (status: BrowserFontStatus) => void; italic?: boolean } = {}): Promise<BrowserFontStatus> {
  if (options.signal?.aborted) throw abortError();
  const controller = createBrowserFontController(document, options.onStatus);
  const abort = () => controller.dispose();
  options.signal?.addEventListener('abort', abort, { once: true });
  try { return await controller.update(fontId, text, options.italic); }
  finally { options.signal?.removeEventListener('abort', abort); controller.dispose(); }
}
