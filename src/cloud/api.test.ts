import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudApiError, request } from './api';
import { accountRequest, accountScope, adoptSession, authenticate, dismissLogin, invalidateAccount, useCloud } from './account';
import type { CloudSession, CloudUser } from './types';
const user = (id: string): CloudUser => ({ id, username: id, displayName: id, role: 'user', status: 'active', resumeQuota: 10, resumeCount: 0, storageBytes: 0, createdAt: '2026-11-04T00:00:00.000Z' });
const session = (id: string, token = 'csrf-' + id): CloudSession => ({ user: user(id), csrfToken: token, settings: { registrationOpen: true, defaultResumeQuota: 10, maxResumeBytes: 524288, maxAssetBytes: 5242880 } });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => { invalidateAccount(); useCloud.setState({ ready: true, ownershipReady: true, links: {} }); });
afterEach(() => { dismissLogin(); invalidateAccount(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('cloud authentication and request isolation', () => {
  it('rejects an explicitly bound A request before issuing a GET after switching to B', async () => {
    adoptSession(session('user-a')); const scope = accountScope(); adoptSession(session('user-b'));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(accountRequest('resumes/synthetic-id', 'GET', undefined, scope)).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' }); expect(fetch).not.toHaveBeenCalled();
  });
  it('times out a stalled request so offline initialization can finish', async () => {
    vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => { init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true }); })));
    const outcome = expect(request('auth/me')).rejects.toMatchObject({ code: 'NETWORK', message: expect.stringContaining('超时') }); await vi.advanceTimersByTimeAsync(10000); await outcome;
  });

  it('sends same-origin credentials and JSON, with CSRF only when supplied', async () => {
    const fetch = vi.fn(async (_input: string, _init: RequestInit) => json({ ok: true })); vi.stubGlobal('fetch', fetch);
    await request('auth/login', { method: 'POST', body: { username: 'synthetic', password: 'synthetic-password' } });
    const init = fetch.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe('same-origin'); expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(init.headers).not.toHaveProperty('X-CSRF-Token');
    await request('resumes', { method: 'POST', body: {}, csrf: 'fresh-token' });
    expect((fetch.mock.calls[1][1].headers as Record<string, string>)['X-CSRF-Token']).toBe('fresh-token');
  });
  it('preserves structured API errors for quota and conflicts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { code: 'QUOTA_EXCEEDED', message: '配额已用完' } }, 409)));
    await expect(request('resumes')).rejects.toMatchObject({ status: 409, code: 'QUOTA_EXCEEDED', message: '配额已用完' });
  });
  it('discards a login response after the account generation changes', async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(done => { resolve = done; })));
    const login = authenticate('login', { username: 'user-a', password: 'synthetic-password' });
    const oldScope = accountScope(); invalidateAccount(); resolve(json(session('user-a')));
    await expect(login).rejects.toBeInstanceOf(CloudApiError); expect(oldScope.signal.aborted).toBe(true); expect(useCloud.getState().user).toBeNull();
  });
  it('adopts the renewed session after changing a password and uses the new CSRF token', async () => {
    let current = session('user-a'); const tokens: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('auth/me')) return json(current);
      tokens.push((init?.headers as Record<string, string>)['X-CSRF-Token']); current = session('user-a', 'renewed-csrf'); return json(current);
    }));
    adoptSession(current);
    const updated = await accountRequest<CloudSession>('auth/password', 'POST', { currentPassword: 'old-password-value', password: 'new-password-value' }); adoptSession(updated);
    await accountRequest('auth/password', 'POST', { currentPassword: 'new-password-value', password: 'next-password-value' });
    expect(tokens).toEqual(['csrf-user-a', 'renewed-csrf']); expect(useCloud.getState().csrfToken).toBe('renewed-csrf');
  });
  it('does not return data fetched while another browser tab changes the login cookie', async () => {
    let meCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('auth/me') ? json(session(++meCalls === 1 ? 'user-a' : 'user-b')) : json({ privateData: 'synthetic user-b content' })));
    adoptSession(session('user-a'));
    await expect(accountRequest('resumes')).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
    expect(useCloud.getState().user?.id).toBe('user-b'); expect(useCloud.getState().list).toBeNull();
  });
});
