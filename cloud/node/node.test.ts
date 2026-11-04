import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import { createHash, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { SqliteD1Database } from './sqlite-d1';
import { bodyBytes, configuration, startNodeServer } from './server';
import { ApiWorkerPool } from './worker-pool';
import { createResume } from '../../src/domain/resume';
import type { BackupAsset } from '../../src/domain/types';
import type { CloudResumeDocument, CloudSession } from '../../src/cloud/types';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let temporary: string;
before(async () => { temporary = await mkdtemp(path.join(tmpdir(), 'myresume-node-tests-')); });
after(async () => {
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(temporary));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  assert.ok(path.basename(temporary).startsWith('myresume-node-tests-'));
  await rm(path.resolve(temporary), { recursive: true, force: true });
});

describe('Node SQLite D1 adapter', () => {
  it('preserves byte-view binding, D1 rows/meta, columns, and WAL/FK/timeout settings', async () => {
    const db = new SqliteD1Database(path.join(temporary, 'adapter.sqlite'));
    try {
      await db.exec('CREATE TABLE values_table(id INTEGER PRIMARY KEY, bytes BLOB NOT NULL);');
      const result = await db.prepare('INSERT INTO values_table(id, bytes) VALUES (?, ?) RETURNING id')
        .bind(1, new Uint8Array([9, 1, 2, 8]).subarray(1, 3)).run<{ id: number }>();
      assert.equal(result.meta.changes, 1); assert.deepEqual(result.results, [{ id: 1 }]);
      assert.deepEqual(await db.prepare('SELECT bytes FROM values_table').first('bytes'), new Uint8Array([1, 2]));
      assert.equal(await db.prepare('SELECT id FROM values_table').first<number>('id'), 1);
      assert.equal(await db.prepare('SELECT id FROM values_table WHERE id=2').first(), null);
      assert.equal((await db.prepare('SELECT * FROM values_table').all()).meta.changes, 0);
      assert.deepEqual(await db.prepare('SELECT id FROM values_table').raw({ columnNames: true }), [['id'], [1]]);
      assert.equal((await db.prepare('PRAGMA journal_mode').first<{ journal_mode: string }>())!.journal_mode, 'wal');
      assert.equal((await db.prepare('PRAGMA foreign_keys').first<{ foreign_keys: number }>())!.foreign_keys, 1);
      assert.equal((await db.prepare('PRAGMA busy_timeout').first<{ timeout: number }>())!.timeout, 5000);
      assert.throws(() => db.prepare('SELECT ?').bind(Number.NaN), /Unsupported/);
      await assert.rejects(db.prepare('SELECT id FROM values_table').first('constructor'), /COLUMN_NOTFOUND/);
    } finally { db.close(); }
  });

  it('rolls back all batch/exec effects on failure, supports savepoints and enforces foreign keys', async () => {
    const db = new SqliteD1Database(path.join(temporary, 'transactions.sqlite'));
    try {
      await db.exec('CREATE TABLE parents(id INTEGER PRIMARY KEY); CREATE TABLE children(id INTEGER PRIMARY KEY, parent INTEGER REFERENCES parents(id) ON DELETE CASCADE);');
      await assert.rejects(db.batch([db.prepare('INSERT INTO parents(id) VALUES (1)'), db.prepare('INSERT INTO children(id,parent) VALUES (1,999)')]), /FOREIGN KEY/);
      assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM parents').first<number>('count'), 0);
      await assert.rejects(db.exec('INSERT INTO parents(id) VALUES(2); INSERT INTO children(id,parent) VALUES(2,999);'), /FOREIGN KEY/);
      assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM parents').first<number>('count'), 0);
      db.transaction(() => {
        db.native.exec('INSERT INTO parents(id) VALUES(3)');
        assert.throws(() => db.transaction(() => { db.native.exec('INSERT INTO parents(id) VALUES(4)'); throw new Error('abort nested'); }));
      });
      assert.deepEqual((await db.prepare('SELECT id FROM parents').all()).results, [{ id: 3 }]);
      await db.batch([db.prepare('INSERT INTO children(id,parent) VALUES(3,3)'), db.prepare('DELETE FROM parents WHERE id=3')]);
      assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM children').first<number>('count'), 0);
    } finally { db.close(); }
  });
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let index = 0; index < 8; index++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Buffer {
  const label = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.byteLength); checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([length, label, data, checksum]);
}
function photo(bytes = 1024 * 1024): BackupAsset {
  const dimensions = Buffer.alloc(13); dimensions.writeUInt32BE(1); dimensions.writeUInt32BE(1, 4); dimensions[8] = 8; dimensions[9] = 6;
  const data = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', dimensions),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), pngChunk('tEXt', Buffer.alloc(bytes, 65)), pngChunk('IEND', Buffer.alloc(0))]);
  return { id: 'synthetic-photo', mime: 'image/png', width: 1, height: 1,
    sha256: createHash('sha256').update(data).digest('hex'), dataBase64: data.toString('base64') };
}

describe('Node HTTP adapter with unchanged account/cloud APIs', () => {
  let runtime: Awaited<ReturnType<typeof startNodeServer>>;
  let base: string;
  const origin = 'https://me.sharmoon.cc.cd', password = 'Synthetic password 2026!';
  const bootstrapToken = randomBytes(32).toString('base64url');
  let admin: { cookie: string; session: CloudSession }, user: { cookie: string; session: CloudSession };

  async function api(route: string, options: { method?: string; body?: unknown; actor?: typeof user; headers?: Record<string, string>; origin?: string } = {}) {
    return fetch(base + route, { method: options.method ?? 'GET', headers: {
      Origin: options.origin ?? origin, ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(options.actor ? { Cookie: options.actor.cookie, 'X-CSRF-Token': options.actor.session.csrfToken! } : {}), ...options.headers,
    }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  }
  async function actor(response: Response) {
    assert.ok(response.ok, await response.clone().text());
    return { cookie: response.headers.get('Set-Cookie')!.split(';')[0], session: await response.json() as CloudSession };
  }
  before(async () => {
    const publicRoot = path.join(temporary, 'public'); await mkdir(publicRoot);
    await writeFile(path.join(publicRoot, 'index.html'), '<!doctype html><title>synthetic SPA</title>');
    await mkdir(path.join(publicRoot, 'fonts')); await writeFile(path.join(publicRoot, 'fonts', 'large.ttf'), Buffer.alloc(26 * 1024 * 1024, 42));
    runtime = await startNodeServer({ appOrigin: origin, host: '127.0.0.1', port: 0, dataDirectory: path.join(temporary, 'api-data'),
      publicDirectory: publicRoot, migrationsDirectory: path.join(project, 'cloud', 'migrations'),
      workerPath: path.join(project, 'output', 'node-backend', 'api-worker.mjs'), bootstrapToken, workerCount: 1 });
    const address = runtime.server.address(); assert.ok(address && typeof address !== 'string'); base = `http://127.0.0.1:${address.port}`;
    admin = await actor(await api('/api/admin/bootstrap', { method: 'POST', headers: { 'X-Bootstrap-Token': bootstrapToken }, body: { username: 'administrator', password } }));
    user = await actor(await api('/api/auth/register', { method: 'POST', body: { username: 'test-user', password, displayName: '' } }));
  });
  after(async () => { await runtime?.close(); });

  it('preserves secure session, origin/CSRF and administrator checks', async () => {
    assert.equal(user.session.user?.role, 'user'); assert.equal(user.session.user?.resumeQuota, 10);
    assert.ok(user.cookie.startsWith('__Host-myresume-session='));
    assert.equal((await api('/api/admin/users', { actor: user })).status, 403);
    assert.equal((await api('/api/auth/logout', { method: 'POST', body: {}, actor: user, origin: 'https://untrusted.test' })).status, 403);
    assert.equal((await api('/api/auth/logout', { method: 'POST', body: {}, actor: user, headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
    assert.equal((await api('/api/auth/me', { actor: user })).status, 200);
  });

  it('keeps quota, binary photo chunks, CAS conflicts, user isolation and cascade deletion', async () => {
    const updatedQuota = await api('/api/admin/users/' + user.session.user!.id, { method: 'PATCH', actor: admin, body: { resumeQuota: 1 } }); assert.equal(updatedQuota.status, 200);
    const resume = createResume('Synthetic Node photo');
    const overhead = Buffer.from(photo(0).dataBase64, 'base64').byteLength;
    const asset = photo(5 * 1024 * 1024 - overhead); resume.basics.avatarAssetId = asset.id;
    assert.equal(Buffer.from(asset.dataBase64, 'base64').byteLength, 5 * 1024 * 1024);
    const created = await api('/api/resumes', { method: 'POST', actor: user, body: { resume, assets: [asset] } }); assert.equal(created.status, 201, await created.clone().text());
    const saved = await created.json() as CloudResumeDocument;
    assert.equal(saved.assets[0].sha256, asset.sha256); assert.equal(saved.revision, 1);
    const other = createResume('Synthetic beyond quota');
    assert.equal((await api('/api/resumes', { method: 'POST', actor: user, body: { resume: other, assets: [] } })).status, 403);
    assert.equal((await api('/api/resumes/' + resume.id, { actor: admin })).status, 404);
    const updated = await api('/api/resumes/' + resume.id, { method: 'PUT', actor: user,
      body: { resume: { ...resume, title: 'New cloud title' }, assets: [asset], expectedRevision: 1 } }); assert.equal(updated.status, 200);
    assert.equal((await updated.json() as CloudResumeDocument).revision, 2);
    assert.equal((await api('/api/resumes/' + resume.id, { method: 'PUT', actor: user, body: { resume, assets: [asset], expectedRevision: 1 } })).status, 409);
    const read = await api('/api/resumes/' + resume.id, { actor: user }); const document = await read.json() as CloudResumeDocument;
    assert.equal(document.resume.title, 'New cloud title'); assert.equal(document.assets[0].dataBase64, asset.dataBase64);
    assert.equal((await api('/api/resumes/' + resume.id, { method: 'DELETE', actor: user, body: { expectedRevision: 2 } })).status, 200);
    const db = new SqliteD1Database(runtime.filename);
    try { assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM resume_asset_chunks').first<number>('count'), 0); } finally { db.close(); }
  });

  it('retains original large fonts, uses strict SPA fallback and denies traversal/private paths', async () => {
    const head = await fetch(base + '/fonts/large.ttf', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.headers.get('Content-Length'), String(26 * 1024 * 1024));
    assert.equal((await fetch(base + '/fonts/missing.ttf', { headers: { Accept: 'text/html' } })).status, 404);
    assert.equal((await fetch(base + '/assets/missing.js', { headers: { Accept: 'text/html' } })).status, 404);
    assert.equal((await fetch(base + '/resume/synthetic', { headers: { Accept: 'text/html' } })).status, 200);
    assert.equal((await fetch(base + '/resume/synthetic')).status, 404);
    assert.equal((await fetch(base + '/.env')).status, 400);
    const malicious = await new Promise<number>(resolve => {
      const request = httpRequest(base, { path: '/fonts/%2e%2e/api-data/myresume.sqlite' }, response => { response.resume(); resolve(response.statusCode!); }); request.end();
    }); assert.equal(malicious, 400);
  });

  it('keeps the HTTP main loop responsive while scrypt runs, then reuses the worker after requests', async () => {
    const started = performance.now(); let finished = false;
    const login = api('/api/auth/login', { method: 'POST', body: { username: 'test-user', password } }).then(response => { finished = true; return response; });
    await new Promise(resolve => setTimeout(resolve, 10));
    const health = await fetch(base + '/healthz'); assert.equal(health.status, 200);
    assert.equal(finished, false, 'The main-loop health response should arrive before the expensive password operation');
    assert.ok(performance.now() - started < 1500);
    const result = await login; assert.equal(result.status, 200);
    assert.equal((await api('/api/auth/me', { actor: user })).status, 200);
  });

  it('enforces body limits before processing known oversized uploads', async () => {
    const response = await api('/api/resumes', { method: 'POST', actor: user, body: { value: 'x'.repeat(8 * 1024 * 1024) } });
    assert.equal(response.status, 413);
  });
});

describe('Node configuration', () => {
  it('rejects public interfaces and malformed origins, while allowing configured HTTPS previews', () => {
    assert.throws(() => configuration({ LISTEN_HOST: '0.0.0.0' }), /loopback/);
    assert.throws(() => configuration({ APP_ORIGIN: 'https://another.test/private' }), /exact HTTPS/);
    assert.throws(() => configuration({ APP_ORIGIN: 'https://user:pass@another.test' }), /exact HTTPS/);
    assert.throws(() => configuration({ APP_ORIGIN: 'http://another.test' }), /exact HTTPS/);
    assert.equal(configuration({ APP_ORIGIN: 'https://preview.myresume.test' }).appOrigin, 'https://preview.myresume.test');
    assert.throws(() => configuration({ MAX_API_WORKERS: '3' }), /worker count/);
    assert.equal(configuration({ APP_ORIGIN: 'http://127.0.0.1:5178' }).workerCount, 1);
  });
});

describe('API worker admission and recovery', () => {
  it('bounds the wait queue, releases cancelled waiters, and recovers a failed worker without leaking a lease', async () => {
    const worker = path.join(temporary, 'pool-fixture.mjs');
    await writeFile(worker, `import { parentPort } from 'node:worker_threads';
      parentPort.postMessage({type:'ready'});
      parentPort.on('message', job => {
        if (job.url.endsWith('/fail')) throw new Error('synthetic worker failure');
        const body = new TextEncoder().encode('ok').buffer;
        parentPort.postMessage({type:'response',id:job.id,status:200,headers:[],body},[body]);
      });`);
    const pool = new ApiWorkerPool(worker, { filename: 'unused', appOrigin: 'http://127.0.0.1' }, { size: 1, maxQueue: 1 });
    try {
      await pool.ready();
      const first = await pool.acquire();
      const controller = new AbortController();
      const waiting = pool.acquire(controller.signal);
      await assert.rejects(pool.acquire(), /queue full/);
      controller.abort(); await assert.rejects(waiting, /cancelled/);
      first.release();
      const failing = await pool.acquire();
      try { await assert.rejects(failing.run({ url: 'http://127.0.0.1/fail', method: 'GET', headers: [], body: null }), /unavailable/); }
      finally { failing.release(); }
      await pool.ready();
      const recovered = await pool.acquire();
      try { assert.equal((await recovered.run({ url: 'http://127.0.0.1/ok', method: 'GET', headers: [], body: null })).status, 200); }
      finally { recovered.release(); }
    } finally { await pool.close(); }
  });
});

describe('bounded upload body reader', () => {
  const input = (length?: string) => Object.assign(new PassThrough(), { headers: length === undefined ? {} : { 'content-length': length } });
  it('fills a single declared-length allocation and keeps unknown-length input bounded', async () => {
    const known = input('6'); const result = bodyBytes(known as unknown as IncomingMessage);
    known.write(Buffer.from([1, 2])); known.end(Buffer.from([3, 4, 5, 6]));
    assert.deepEqual(new Uint8Array((await result)!), new Uint8Array([1, 2, 3, 4, 5, 6]));
    assert.equal(known.listenerCount('data'), 0); assert.equal(known.listenerCount('aborted'), 0);
    const unknown = input(); const streamed = bodyBytes(unknown as unknown as IncomingMessage);
    unknown.write('abc'); unknown.end('def'); assert.equal(Buffer.from((await streamed)!).toString(), 'abcdef');
    assert.equal(unknown.listenerCount('data'), 0);
  });
  it('rejects short/long declared bodies, over-cap headers and aborts, while removing listeners', async () => {
    const short = input('5'); const shortResult = bodyBytes(short as unknown as IncomingMessage); short.end('abc');
    await assert.rejects(shortResult, (error: unknown) => (error as { status: number }).status === 400);
    const long = input('2'); const longResult = bodyBytes(long as unknown as IncomingMessage); long.end('abc');
    await assert.rejects(longResult, (error: unknown) => (error as { status: number }).status === 400);
    await assert.rejects(bodyBytes(input(String(8 * 1024 * 1024 + 1)) as unknown as IncomingMessage), (error: unknown) => (error as { status: number }).status === 413);
    const cancelled = input('5'); const cancelledResult = bodyBytes(cancelled as unknown as IncomingMessage); cancelled.write('a'); cancelled.emit('aborted');
    await assert.rejects(cancelledResult, /aborted/); assert.equal(cancelled.listenerCount('data'), 0); assert.equal(cancelled.listenerCount('aborted'), 0);
    const oversized = input(); const overResult = bodyBytes(oversized as unknown as IncomingMessage); oversized.end(Buffer.alloc(8 * 1024 * 1024 + 1));
    await assert.rejects(overResult, (error: unknown) => (error as { status: number }).status === 413);
  });
});
