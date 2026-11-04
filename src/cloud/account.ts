import { create } from 'zustand';
import type { CloudResumeList, CloudSession, CloudSettings, CloudUser } from './types';
import { CloudApiError, request } from './api';
import { linkDatabase, type CloudLink } from './links';
const initialSettings: CloudSettings = { registrationOpen: true, defaultResumeQuota: 10, maxResumeBytes: 512 * 1024, maxAssetBytes: 5 * 1024 * 1024 };
let accountController = new AbortController();
const loginWaiters = new Set<(user: CloudUser | null) => void>();
interface AccountState {
  ready: boolean; ownershipReady: boolean; ownershipError: string | null; user: CloudUser | null; csrfToken: string | null; settings: CloudSettings; epoch: number;
  authOpen: boolean; error: string | null; list: CloudResumeList | null; links: Record<string, CloudLink>;
}
export const useCloud = create<AccountState>(() => ({ ready: false, ownershipReady: false, ownershipError: null, user: null, csrfToken: null, settings: initialSettings, epoch: 0, authOpen: false, error: null, list: null, links: {} }));
export function accountScope() { const state = useCloud.getState(); return { userId: state.user?.id ?? null, epoch: state.epoch, csrf: state.csrfToken, signal: accountController.signal }; }
export function assertScope(scope: ReturnType<typeof accountScope>) { if (scope.signal.aborted || scope.epoch !== useCloud.getState().epoch || scope.userId !== (useCloud.getState().user?.id ?? null)) throw new CloudApiError(0, 'ACCOUNT_CHANGED', '账号已切换，本机内容已保留，请在原账号重试'); }
export function adoptSession(session: CloudSession) {
  accountController.abort(); accountController = new AbortController();
  useCloud.setState(state => ({ ...session, ready: true, epoch: state.epoch + 1, list: null, error: null }));
}
export function invalidateAccount() { adoptSession({ user: null, csrfToken: null, settings: useCloud.getState().settings }); }
export async function refreshLinks() {
  try { const links = await linkDatabase.cloudLinks.toArray(); useCloud.setState({ ownershipReady: true, ownershipError: null, links: Object.fromEntries(links.map(link => [link.localId, link])) }); }
  catch (error) { useCloud.setState({ ownershipReady: true, ownershipError: '无法读取简历保存位置。为保护账户数据，已暂时隐藏本机简历，请重试读取。' }); throw error; }
}
export async function initializeAccount() {
  const scope = accountScope();
  await refreshLinks().catch(() => undefined);
  try { const session = await request<CloudSession>('auth/me', { signal: scope.signal }); assertScope(scope); adoptSession(session); }
  catch (error) { if (scope.epoch === useCloud.getState().epoch) useCloud.setState({ ready: true, error: error instanceof Error ? error.message : '账户服务暂不可用' }); }
}
export async function authenticate(mode: 'login' | 'register', credentials: { username: string; password: string; displayName?: string }) {
  const scope = accountScope();
  const session = await request<CloudSession>('auth/' + mode, { method: 'POST', body: credentials, signal: scope.signal }); assertScope(scope); adoptSession(session);
  useCloud.setState({ authOpen: false }); for (const resolve of loginWaiters) resolve(session.user); loginWaiters.clear();
}
export function promptLogin(): Promise<CloudUser | null> {
  const user = useCloud.getState().user; if (user) return Promise.resolve(user);
  useCloud.setState({ authOpen: true }); return new Promise(resolve => { loginWaiters.add(resolve); });
}
export function dismissLogin() { useCloud.setState({ authOpen: false }); for (const resolve of loginWaiters) resolve(null); loginWaiters.clear(); }
export async function logout() {
  const scope = accountScope();
  try { await request<void>('auth/logout', { method: 'POST', body: {}, csrf: scope.csrf, signal: scope.signal }); assertScope(scope); }
  catch (error) { if (scope.epoch === useCloud.getState().epoch) useCloud.setState({ error: error instanceof Error ? error.message : '退出失败' }); throw error; }
  invalidateAccount(); dismissLogin();
}
export async function accountRequest<T>(path: string, method = 'GET', body?: unknown, scope = accountScope()): Promise<T> {
  assertScope(scope); if (!scope.userId) throw new CloudApiError(401, 'UNAUTHENTICATED', '请先登录');
  const verifyIdentity = async () => {
    const session = await request<CloudSession>('auth/me', { signal: scope.signal }); assertScope(scope);
    if (session.user?.id !== scope.userId) { adoptSession(session); throw new CloudApiError(401, 'ACCOUNT_CHANGED', '登录账号已变更，请重新打开云端页面'); }
    useCloud.setState({ csrfToken: session.csrfToken });
  };
  try { await verifyIdentity(); const result = await request<T>(path, { method, body, csrf: useCloud.getState().csrfToken, signal: scope.signal }); assertScope(scope); if (path !== 'auth/password') await verifyIdentity(); return result; }
  catch (error) { if (scope.epoch === useCloud.getState().epoch && error instanceof CloudApiError && error.status === 401) invalidateAccount(); throw error; }
}
export async function refreshCloudList() {
  const scope = accountScope(); if (!scope.userId) return;
  const list = await accountRequest<CloudResumeList>('resumes'); assertScope(scope); useCloud.setState({ list, error: null });
}
