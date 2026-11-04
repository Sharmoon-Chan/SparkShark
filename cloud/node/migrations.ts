import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { SqliteD1Database } from './sqlite-d1';

export async function migrateDatabase(filename: string, directory: string): Promise<void> {
  const database = new SqliteD1Database(filename);
  try {
    database.native.exec(`CREATE TABLE IF NOT EXISTS node_schema_migrations (
      name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL
    )`);
    for (const name of (await readdir(directory)).filter(name => /^\d[^/\\]*\.sql$/.test(name)).sort()) {
      const sql = await readFile(path.join(directory, name), 'utf8');
      const sha256 = createHash('sha256').update(sql).digest('hex');
      const existing = await database.prepare('SELECT sha256 FROM node_schema_migrations WHERE name = ?').bind(name).first<{ sha256: string }>();
      if (existing) {
        if (existing.sha256 !== sha256) throw new Error(`Applied migration changed: ${name}`);
        continue;
      }
      database.transaction(() => {
        database.native.exec(sql);
        database.native.prepare('INSERT INTO node_schema_migrations (name, sha256, applied_at) VALUES (?, ?, ?)')
          .run(name, sha256, new Date().toISOString());
      });
    }
  } finally { database.close(); }
}
