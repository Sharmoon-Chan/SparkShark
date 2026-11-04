import type { CloudErrorBody } from './types';
export class CloudApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'CloudApiError'; }
}
export async function request<T>(path: string, options: { method?: string; body?: unknown; csrf?: string | null; signal?: AbortSignal } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';
  if (options.csrf) headers['X-CSRF-Token'] = options.csrf;
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error('Cloud request timed out')), 10000);
  try {
    const response = await fetch('/api/' + path, { method, headers, credentials: 'same-origin', body: options.body === undefined ? undefined : JSON.stringify(options.body), signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as CloudErrorBody | null;
      throw new CloudApiError(response.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? '云端请求失败，请重试');
    }
    return response.status === 204 ? undefined as T : await response.json() as T;
  } catch (error) {
    if (options.signal?.aborted || error instanceof CloudApiError) throw error;
    throw new CloudApiError(0, 'NETWORK', controller.signal.aborted ? '云端连接超时，本机内容已保留。请稍后重试。' : '云端连接失败，本机内容已保留。请联网后重试。');
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
export const readableBytes = (bytes: number) => bytes < 1024 ? bytes + ' B' : bytes < 1024 * 1024 ? (bytes / 1024).toFixed(1) + ' KiB' : (bytes / (1024 * 1024)).toFixed(2) + ' MiB';
