import assert from 'node:assert/strict';
import { it } from 'node:test';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const cloud = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wranglerRequire = createRequire(path.join(cloud, 'node_modules/wrangler/package.json'));
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = await import(pathToFileURL(wranglerRequire.resolve('miniflare')).href);

it('adapts actual SQLite Durable Object cursors, native BLOBs and transaction rollback', async () => {
  const output = path.join(cloud, 'free', 'output'); await mkdir(output, { recursive: true });
  const scriptPath = path.join(output, 'adapter-test.mjs');
  await build({ stdin: { sourcefile: 'adapter-test.ts', resolveDir: path.join(cloud, 'free'), loader: 'ts', contents: `
    import { DurableObject } from 'cloudflare:workers';
    import { DurableSqlD1Database } from './sqlite-d1';
    export class Probe extends DurableObject {
      async fetch() {
        const db = new DurableSqlD1Database(this.ctx.storage);
        await db.exec('CREATE TABLE IF NOT EXISTS parent(id INTEGER PRIMARY KEY, bytes BLOB); CREATE TABLE IF NOT EXISTS child(id INTEGER PRIMARY KEY, parent INTEGER REFERENCES parent(id) ON DELETE CASCADE);');
        db.sql.exec('PRAGMA foreign_keys = ON').toArray();
        const insert = await db.prepare('INSERT INTO parent(id,bytes) VALUES(?,?) RETURNING id').bind(1, new Uint8Array([9,1,2,8]).subarray(1,3)).run();
        const binary = await db.prepare('SELECT bytes FROM parent WHERE id=1').first('bytes');
        const select = await db.prepare('SELECT id FROM parent').all();
        let rolledBack = false;
        try { await db.batch([db.prepare('INSERT INTO parent(id) VALUES(2)'),db.prepare('INSERT INTO child(id,parent) VALUES(2,999)')]); }
        catch { rolledBack = true; }
        const count = await db.prepare('SELECT COUNT(*) AS count FROM parent').first('count');
        const update = await db.prepare('UPDATE parent SET bytes=? WHERE id=1 RETURNING id').bind(new Uint8Array([3,4]).buffer).run();
        const stale = await db.prepare('UPDATE parent SET bytes=? WHERE id=99 RETURNING id').bind(new Uint8Array([5]).buffer).run();
        const fk = db.sql.exec('PRAGMA foreign_keys').one().foreign_keys;
        return Response.json({ insertChanges:insert.meta.changes,selectChanges:select.meta.changes,
          nativeBinary:binary instanceof ArrayBuffer,binary:Array.from(new Uint8Array(binary)),rolledBack,count,
          updateChanges:update.meta.changes,staleChanges:stale.meta.changes,fk });
      }
    }
    export default {fetch(request,env){return env.PROBE.getByName('adapter-probe').fetch(request)}};
  ` }, outfile: scriptPath, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', external: ['node:*', 'cloudflare:workers'], conditions: ['workerd', 'worker', 'browser'] });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath,
    compatibilityDate: '2026-11-04', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { PROBE: { className: 'Probe', useSQLite: true } }, cf: {}, log: new Log(LogLevel.ERROR) }));
  try {
    await mf.ready;
    const response = await mf.dispatchFetch('https://free-adapter.test/');
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { insertChanges: 1, selectChanges: 0, nativeBinary: true,
      binary: [1, 2], rolledBack: true, count: 1, updateChanges: 1, staleChanges: 0, fk: 1 });
  } finally { await mf.dispose(); }
});
