import initialSchema from '../migrations/0001_accounts_and_resumes.sql';
import type { DurableSqlD1Database } from './sqlite-d1';

const migrationName = '0001_accounts_and_resumes.sql';

export async function initializeSchema(database: DurableSqlD1Database): Promise<void> {
  const schema = initialSchema.replace(/\r\n/g, '\n');
  const encoded = new TextEncoder().encode(schema);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const sha256 = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');

  // Enabling foreign keys is supported by workerd's SQLite pragma allowlist.
  // Do not issue Node-specific WAL/busy_timeout pragmas against managed DO storage.
  database.sql.exec('PRAGMA foreign_keys = ON;').toArray();
  database.sql.exec(`CREATE TABLE IF NOT EXISTS free_schema_migrations (
    name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL
  )`).toArray();
  database.transactionSync(() => {
    const existing = database.sql.exec('SELECT sha256 FROM free_schema_migrations WHERE name = ?', migrationName).toArray()[0];
    if (existing) {
      if (existing.sha256 !== sha256) throw new Error('An already-applied Durable Object schema migration was changed');
      return;
    }
    database.sql.exec(schema).toArray();
    database.sql.exec('INSERT INTO free_schema_migrations (name, sha256, applied_at) VALUES (?, ?, ?)',
      migrationName, sha256, new Date().toISOString()).toArray();
  });
}
