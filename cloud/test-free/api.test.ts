import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { deflateSync } from 'node:zlib';
import { createResume } from '../../src/domain/resume';
import type { BackupAsset, Resume } from '../../src/domain/types';
import type { CloudAdminUsers, CloudResumeDocument, CloudResumeList, CloudSession, CloudUser } from '../../src/cloud/types';
import { createHarness, origin, password, sha256, type TestActor } from './harness';

async function status(response: Response, expected: number) {
  assert.equal(response.status, expected, await response.clone().text());
  return response;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.byteLength);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function asset(size = 0, marker = 65): BackupAsset {
  const dimensions = Buffer.alloc(13);
  dimensions.writeUInt32BE(1, 0); dimensions.writeUInt32BE(1, 4);
  dimensions[8] = 8; dimensions[9] = 6;
  const bytes = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', dimensions),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
    ...(size ? [pngChunk('tEXt', Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(size, marker)]))] : []),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return { id: `asset-${marker}`, mime: 'image/png', width: 1, height: 1, sha256: sha256(bytes), dataBase64: bytes.toString('base64') };
}

function withPhoto(resume: Resume, photo: BackupAsset) {
  const value = structuredClone(resume);
  value.basics.avatarAssetId = photo.id;
  value.appearance.avatar.visible = true;
  return { resume: value, assets: [photo] };
}

describe('MyResume Durable Objects SQLite API in real workerd', { concurrency: false, timeout: 240_000 }, () => {
  let h: Awaited<ReturnType<typeof createHarness>>;
  let admin: TestActor, alice: TestActor, bob: TestActor;
  const sharedId = 'shared-resume-id';
  let bobCurrent: CloudResumeDocument;

  before(async () => {
    h = await createHarness();
    admin = await h.bootstrap();
    alice = await h.register('alice', '192.0.2.20');
    bob = await h.register('bob', '192.0.2.21');
  });
  after(async () => { if (h) await h.dispose(); });

  it('issues secure session cookies and exposes no password/session secrets', async () => {
    const response = await status(await h.request('/api/auth/login', {
      method: 'POST', body: { username: 'ALICE', password }, ip: alice.ip,
    }), 200);
    const setCookie = response.headers.get('Set-Cookie') ?? '';
    assert.match(setCookie, /^__Host-myresume-session=/);
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(setCookie.includes(attribute));
    alice = await h.actorFrom(response, alice.ip);
    const me = await status(await h.request('/api/auth/me', { actor: alice }), 200);
    assert.match(me.headers.get('Cache-Control') ?? '', /no-store/);
    const body = await me.json() as CloudSession;
    assert.equal(body.user?.role, 'user');
    assert.equal(body.user?.resumeQuota, 10);
    assert.equal(body.user?.resumeCount, 0);
    assert.ok(!JSON.stringify(body).includes('password_hash'));
    assert.ok(!JSON.stringify(body).includes('token_hash'));
    const anonymous = await (await status(await h.request('/api/auth/me'), 200)).json() as CloudSession;
    assert.equal(anonymous.user, null);
    assert.equal(anonymous.csrfToken, null);
    assert.equal(anonymous.settings.registrationOpen, true);
  });

  it('keeps administrator bootstrap one-time and protects the final administrator', async () => {
    await status(await h.request('/api/admin/bootstrap', {
      method: 'POST', body: { username: 'intruder', password },
      headers: { 'X-Bootstrap-Token': h.bootstrapToken }, ip: '192.0.2.11',
    }), 409);
    const denied = await h.request('/api/admin/bootstrap', {
      method: 'POST', body: { username: 'intruder', password },
      headers: { 'X-Bootstrap-Token': 'not-the-token' }, ip: '192.0.2.12',
    });
    assert.ok([401, 403, 404].includes(denied.status), await denied.text());
    await status(await h.request(`/api/admin/users/${admin.userId}`, {
      actor: admin, method: 'PATCH', body: { status: 'disabled' },
    }), 409);
    const adminCount = await h.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'").first<{ count: number }>();
    assert.equal(adminCount?.count, 1);
  });

  it('does not permit privileged fields supplied by a public registrant', async () => {
    const response = await h.request('/api/auth/register', {
      method: 'POST', body: { username: 'tamper', password, role: 'admin', status: 'active', resumeQuota: 9999 },
      ip: '192.0.2.22',
    });
    if (response.status === 400) {
      assert.equal(await h.db.prepare("SELECT COUNT(*) AS count FROM users WHERE username = 'tamper'").first<number>('count'), 0);
    } else {
      await status(response, 201);
      const account = await response.json() as CloudSession;
      assert.equal(account.user?.role, 'user');
      assert.equal(account.user?.resumeQuota, 10);
    }
    await status(await h.request('/api/admin/users', { actor: alice }), 403);
    await status(await h.request(`/api/admin/users/${bob.userId}`, {
      actor: alice, method: 'PATCH', body: { resumeQuota: 9999 },
    }), 403);
    const before = await h.db.prepare('SELECT role FROM users WHERE id = ?').bind(bob.userId).first<string>('role');
    const modify = await h.request(`/api/admin/users/${bob.userId}`, {
      actor: admin, method: 'PATCH', body: { role: 'admin' },
    });
    assert.ok([400, 403].includes(modify.status), await modify.text());
    assert.equal(await h.db.prepare('SELECT role FROM users WHERE id = ?').bind(bob.userId).first<string>('role'), before);
  });

  it('rejects missing/incorrect Origin, cross-site fetches, CSRF and unauthenticated writes', async () => {
    const body = { resume: createResume('CSRF fixture'), assets: [] };
    await status(await h.request('/api/resumes', { method: 'POST', body, actor: alice, origin: null }), 403);
    await status(await h.request('/api/resumes', { method: 'POST', body, actor: alice, origin: 'https://attacker.invalid' }), 403);
    await status(await h.request('/api/resumes', { method: 'POST', body, actor: alice, csrf: null }), 403);
    await status(await h.request('/api/resumes', { method: 'POST', body, actor: alice, csrf: 'wrong-token' }), 403);
    await status(await h.request('/api/resumes', { method: 'POST', body }), 401);
    await status(await h.request('/api/resumes', { actor: alice, headers: { 'Sec-Fetch-Site': 'cross-site' } }), 403);
    assert.equal(await h.db.prepare('SELECT COUNT(*) AS count FROM resumes').first<number>('count'), 0);
  });

  it('isolates two users reading, changing and deleting the same logical resume ID', async () => {
    const a = createResume('Alice document'); a.id = sharedId;
    const b = createResume('Bob document'); b.id = sharedId;
    await status(await h.request('/api/resumes', { actor: alice, method: 'POST', body: { resume: a, assets: [] } }), 201);
    bobCurrent = await (await status(await h.request('/api/resumes', {
      actor: bob, method: 'POST', body: withPhoto(b, asset(1100 * 1024)),
    }), 201)).json() as CloudResumeDocument;
    const aRead = await (await status(await h.request(`/api/resumes/${sharedId}`, { actor: alice }), 200)).json() as CloudResumeDocument;
    assert.equal(aRead.resume.title, 'Alice document');
    assert.equal(bobCurrent.resume.title, 'Bob document');
    assert.equal(aRead.assets.length, 0);
    assert.equal(bobCurrent.assets.length, 1);
    const aList = await (await status(await h.request('/api/resumes', { actor: alice }), 200)).json() as CloudResumeList;
    assert.equal(aList.resumes.length, 1);
    assert.equal(aList.resumes[0].title, 'Alice document');
    const privateResume = createResume('Alice private document');
    await status(await h.request('/api/resumes', { actor: alice, method: 'POST', body: { resume: privateResume, assets: [] } }), 201);
    await status(await h.request(`/api/resumes/${privateResume.id}`, { actor: bob }), 404);
    await status(await h.request(`/api/resumes/${privateResume.id}`, {
      actor: bob, method: 'PUT', body: { resume: privateResume, assets: [], expectedRevision: 1 },
    }), 404);
    await status(await h.request(`/api/resumes/${privateResume.id}`, {
      actor: bob, method: 'DELETE', body: { expectedRevision: 1 },
    }), 404);
    const deleted = await (await status(await h.request(`/api/resumes/${privateResume.id}`, { actor: alice, method: 'DELETE', body: { expectedRevision: 1 } }), 200)).json() as { deleted: boolean };
    assert.equal(deleted.deleted, true);
  });

  it('stores large photos as bounded binary chunks and reports logical binary storage size', async () => {
    const stats = await h.db.prepare(`SELECT COUNT(*) AS count, MAX(length(data)) AS max_size, SUM(length(data)) AS bytes
      FROM resume_asset_chunks WHERE user_id = ? AND resume_id = ?`).bind(bob.userId, sharedId).first<{ count: number; max_size: number; bytes: number }>();
    assert.ok(stats && stats.count >= 3);
    assert.ok(stats.max_size <= 512 * 1024);
    const photoBytes = Buffer.from(bobCurrent.assets[0].dataBase64, 'base64');
    assert.equal(stats.bytes, photoBytes.byteLength);
    assert.equal(sha256(photoBytes), bobCurrent.assets[0].sha256);
    assert.equal(bobCurrent.byteSize, Buffer.byteLength(JSON.stringify(bobCurrent.resume), 'utf8') + photoBytes.byteLength);
  });

  it('atomically enforces the last available quota during simultaneous creates', async () => {
    await status(await h.request(`/api/admin/users/${alice.userId}`, { actor: admin, method: 'PATCH', body: { resumeQuota: 2 } }), 200);
    const requests = [createResume('Concurrent A'), createResume('Concurrent B')].map(resume =>
      h.request('/api/resumes', { actor: alice, method: 'POST', body: { resume, assets: [] } }));
    const responses = await Promise.all(requests);
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 403]);
    const rejected = responses.find(response => response.status === 403)!;
    assert.equal((await rejected.json() as { error: { code: string } }).error.code, 'QUOTA_EXCEEDED');
    const list = await (await status(await h.request('/api/resumes', { actor: alice }), 200)).json() as CloudResumeList;
    assert.equal(list.used, 2);
    assert.equal(list.resumes.length, 2);
  });

  it('rejects stale revisions without altering either the current body or current photo', async () => {
    const fresh = withPhoto({ ...bobCurrent.resume, title: 'Bob newest title' }, asset(200 * 1024, 66));
    bobCurrent = await (await status(await h.request(`/api/resumes/${sharedId}`, {
      actor: bob, method: 'PUT', body: { ...fresh, expectedRevision: bobCurrent.revision },
    }), 200)).json() as CloudResumeDocument;
    assert.equal(bobCurrent.revision, 2);
    const stale = withPhoto({ ...bobCurrent.resume, title: 'Stale overwritten title' }, asset(1, 67));
    await status(await h.request(`/api/resumes/${sharedId}`, {
      actor: bob, method: 'PUT', body: { ...stale, expectedRevision: 1 },
    }), 409);
    await status(await h.request(`/api/resumes/${sharedId}`, { actor: bob, method: 'DELETE', body: { expectedRevision: 1 } }), 409);
    const current = await (await status(await h.request(`/api/resumes/${sharedId}`, { actor: bob }), 200)).json() as CloudResumeDocument;
    assert.equal(current.resume.title, 'Bob newest title');
    assert.equal(current.revision, 2);
    assert.deepEqual(current.assets, bobCurrent.assets);
    assert.equal(current.byteSize, bobCurrent.byteSize);
  });

  it('keeps existing resumes when quotas are lowered to zero while blocking new creates', async () => {
    const patched = await (await status(await h.request(`/api/admin/users/${bob.userId}`, {
      actor: admin, method: 'PATCH', body: { resumeQuota: 0 },
    }), 200)).json() as CloudUser;
    assert.equal(patched.resumeQuota, 0);
    assert.equal(patched.resumeCount, 1);
    bobCurrent = await (await status(await h.request(`/api/resumes/${sharedId}`, {
      actor: bob, method: 'PUT', body: { resume: { ...bobCurrent.resume, title: 'Existing still editable' }, assets: bobCurrent.assets, expectedRevision: bobCurrent.revision },
    }), 200)).json() as CloudResumeDocument;
    await status(await h.request('/api/resumes', {
      actor: bob, method: 'POST', body: { resume: createResume('Quota zero'), assets: [] },
    }), 403);
    assert.equal(await h.db.prepare('SELECT COUNT(*) AS count FROM resumes WHERE user_id = ?').bind(bob.userId).first<number>('count'), 1);
  });

  it('invalidates existing sessions immediately when an administrator disables an account', async () => {
    await status(await h.request(`/api/admin/users/${alice.userId}`, { actor: admin, method: 'PATCH', body: { status: 'disabled' } }), 200);
    await status(await h.request('/api/resumes', { actor: alice }), 401);
    const me = await (await status(await h.request('/api/auth/me', { actor: alice }), 200)).json() as CloudSession;
    assert.equal(me.user, null);
    await status(await h.request('/api/auth/login', { method: 'POST', body: { username: 'alice', password }, ip: alice.ip }), 401);
    await status(await h.request(`/api/admin/users/${alice.userId}`, { actor: admin, method: 'PATCH', body: { status: 'active' } }), 200);
    await status(await h.request('/api/resumes', { actor: alice }), 401);
    alice = await h.actorFrom(await status(await h.request('/api/auth/login', { method: 'POST', body: { username: 'alice', password }, ip: alice.ip }), 200), alice.ip);
  });

  it('applies server-side content, binary asset, and request-body size limits', async () => {
    const large = createResume('Oversize content');
    large.basics.name = 'a'.repeat(180_000);
    large.basics.headline = 'b'.repeat(180_000);
    large.basics.email = 'c'.repeat(180_000);
    await status(await h.request('/api/resumes', { actor: alice, method: 'POST', body: { resume: large, assets: [] } }), 413);
    const largePhoto = asset(5 * 1024 * 1024 + 1);
    await status(await h.request('/api/resumes', {
      actor: alice, method: 'POST', body: withPhoto(createResume('Oversize photo'), largePhoto),
    }), 413);
    await status(await h.request('/api/resumes', {
      actor: alice, method: 'POST', body: { padding: 'x'.repeat(8 * 1024 * 1024 + 1) },
    }), 413);
  });

  it('allows administrators to manage registration and exposes counts without resume bodies', async () => {
    await status(await h.request('/api/admin/settings', { actor: admin, method: 'PATCH', body: { registrationOpen: false, defaultResumeQuota: 3 } }), 200);
    await status(await h.request('/api/auth/register', { method: 'POST', body: { username: 'closedtest', password }, ip: '192.0.2.30' }), 403);
    await status(await h.request('/api/admin/settings', { actor: admin, method: 'PATCH', body: { registrationOpen: true, defaultResumeQuota: 3 } }), 200);
    const newbie = await h.register('newdefault', '192.0.2.31');
    assert.equal(newbie.session.user?.resumeQuota, 3);
    const users = await (await status(await h.request('/api/admin/users?page=1&pageSize=2', { actor: admin }), 200)).json() as CloudAdminUsers;
    assert.equal(users.pageSize, 2);
    assert.equal(users.users.length, 2);
    assert.ok(users.total >= 4);
    const serialized = JSON.stringify(users);
    for (const forbidden of ['password_hash', 'data_json', 'dataBase64', 'token_hash']) assert.ok(!serialized.includes(forbidden));
    const overview = await (await status(await h.request('/api/admin/overview', { actor: admin }), 200)).json() as { totalResumes: number; totalStorageBytes: number };
    assert.equal(overview.totalResumes, 3);
    assert.ok(overview.totalStorageBytes > 200 * 1024);
  });

  it('checks passwords inside the Durable Object and revokes old sessions after a password change', async () => {
    const newPassword = 'Synthetic changed password 2026!';
    const oldActor = bob;
    bob = await h.actorFrom(await status(await h.request('/api/auth/password', { actor: bob, method: 'POST', body: { currentPassword: password, password: newPassword } }), 200), bob.ip);
    await status(await h.request('/api/resumes', { actor: oldActor }), 401);
    await status(await h.request('/api/resumes', { actor: bob }), 200);
    await status(await h.request('/api/auth/login', { method: 'POST', body: { username: 'bob', password }, ip: bob.ip }), 401);
    bob = await h.actorFrom(await status(await h.request('/api/auth/login', {
      method: 'POST', body: { username: 'bob', password: newPassword }, ip: bob.ip,
    }), 200), bob.ip);
    const loggedOut = await (await status(await h.request('/api/auth/logout', { actor: bob, method: 'POST', body: {} }), 200)).json() as CloudSession;
    assert.equal(loggedOut.user, null);
    await status(await h.request('/api/resumes', { actor: bob }), 401);
  });

  it('rate-limits repeated bad logins before doing an unlimited number of password hashes', async () => {
    let denied = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const response = await h.request('/api/auth/login', {
        method: 'POST', body: { username: 'missing-user', password: 'Wrong password 2026!' },
        ip: '192.0.2.40',
      });
      if (response.status === 429) { denied = true; break; }
      await status(response, 401);
    }
    assert.equal(denied, true);
  });
});

it('only one concurrent bootstrap request can create an administrator', { timeout: 120_000 }, async () => {
  const h = await createHarness();
  try {
    const responses = await Promise.all(['first-admin', 'second-admin'].map((username, index) => h.request('/api/admin/bootstrap', {
      method: 'POST', body: { username, password }, headers: { 'X-Bootstrap-Token': h.bootstrapToken }, ip: `192.0.2.${60 + index}`,
    })));
    assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
    assert.equal(await h.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").first<number>('count'), 1);
    assert.equal(await h.db.prepare('SELECT bootstrap_completed FROM app_settings').first<number>('bootstrap_completed'), 1);
  } finally { await h.dispose(); }
});

