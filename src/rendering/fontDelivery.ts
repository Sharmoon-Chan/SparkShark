export interface CompressedFontFile {
  file: string;
  sha256: string;
  compressed: { file: string; bytes: number; originalBytes: number; sha256: string };
}

const cancelled = () => new DOMException('字体加载已取消', 'AbortError');
export async function readCompressedFont(base: string, file: CompressedFontFile, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) throw cancelled();
  const response = await fetch(`${base}/${file.compressed.file}`, { signal });
  if (!response.ok) throw new Error(`字体下载失败 (${response.status})，请重试。`);
  const packed = new Uint8Array(await response.arrayBuffer());
  if (signal?.aborted) throw cancelled();
  let bytes: Uint8Array;
  if (packed[0] === 0x1f && packed[1] === 0x8b) {
    if (typeof DecompressionStream !== 'undefined') {
      const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      const { gunzipSync } = await import('fflate');
      bytes = gunzipSync(packed);
    }
  } else {
    // A server may already have decoded a gzip Content-Encoding response.
    bytes = packed;
  }
  if (signal?.aborted) throw cancelled();
  if (bytes.byteLength !== file.compressed.originalBytes) throw new Error('字体资源不完整，请刷新后重试。');
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer));
  if ([...hash].map(value => value.toString(16).padStart(2, '0')).join('') !== file.sha256) throw new Error('字体资源校验失败，请刷新后重试。');
  if (signal?.aborted) throw cancelled();
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'font/ttf' });
}
