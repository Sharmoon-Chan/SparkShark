import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';

export interface SqliteResult<T = Record<string, unknown>> {
  success: true;
  results: T[];
  meta: { changes: number; last_row_id: number; duration: number; changed_db: boolean;
    rows_read: number; rows_written: number; size_after: number; served_by: string };
}

function input(value: unknown): SQLInputValue {
  if (value === null || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value) && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return Uint8Array.from(value);
  throw new TypeError('Unsupported SQLite bind value');
}

function output(value: unknown): unknown {
  // The shared resume reader accepts typed bytes. Avoid expanding a 5 MiB BLOB into ~40 MiB of JS numbers.
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('SQLite integer exceeds the safe JSON range');
    return Number(value);
  }
  return value;
}

function resultRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([name, value]) => [name, output(value)]));
}

export class SqliteD1Statement {
  constructor(readonly database: SqliteD1Database, readonly sql: string, readonly bindings: unknown[] = []) {}

  bind(...values: unknown[]): SqliteD1Statement {
    values.forEach(input);
    return new SqliteD1Statement(this.database, this.sql, values);
  }

  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.database.execute(this).results[0];
    if (!row) return null;
    if (column !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(row, column)) throw new Error('D1_COLUMN_NOTFOUND');
      return row[column] as T;
    }
    return row as T;
  }

  async all<T = Record<string, unknown>>(): Promise<SqliteResult<T>> { return this.database.execute(this) as SqliteResult<T>; }
  async run<T = Record<string, unknown>>(): Promise<SqliteResult<T>> { return this.database.execute(this) as SqliteResult<T>; }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const statement = this.database.native.prepare(this.sql);
    const names = statement.columns().map(column => column.name);
    const rows = statement.all(...this.bindings.map(input)).map(row => names.map(name => output(row[name])));
    return (options?.columnNames ? [names, ...rows] : rows) as T[];
  }
}

export class SqliteD1Database {
  readonly native: DatabaseSync;
  private transactionDepth = 0;

  constructor(filename: string, options: { busyTimeoutMs?: number; cacheKiB?: number } = {}) {
    const timeout = options.busyTimeoutMs ?? 5000;
    const cache = options.cacheKiB ?? 4096;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60000 || !Number.isSafeInteger(cache) || cache < 256 || cache > 65536) {
      throw new Error('Invalid SQLite resource settings');
    }
    this.native = new DatabaseSync(filename, { timeout, enableForeignKeyConstraints: true });
    this.native.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${timeout}; PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL; PRAGMA cache_size = -${cache}; PRAGMA temp_store = MEMORY; PRAGMA mmap_size = 0;`);
  }

  prepare(sql: string): SqliteD1Statement {
    if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('SQL statement required');
    return new SqliteD1Statement(this, sql);
  }

  execute(statement: SqliteD1Statement): SqliteResult {
    if (statement.database !== this) throw new Error('Statement belongs to a different database');
    const started = performance.now();
    const before = Number(this.native.prepare('SELECT total_changes() AS count').get()!.count);
    const native = this.native.prepare(statement.sql);
    const values = statement.bindings.map(input);
    let rows: Record<string, unknown>[];
    let directChanges = 0, lastRowId = 0;
    if (native.columns().length) {
      rows = native.all(...values).map(resultRow);
      const after = Number(this.native.prepare('SELECT total_changes() AS count').get()!.count);
      if (after !== before) directChanges = Number(this.native.prepare('SELECT changes() AS count').get()!.count);
      lastRowId = Number(this.native.prepare('SELECT last_insert_rowid() AS id').get()!.id);
    } else {
      const mutation = native.run(...values);
      rows = [];
      directChanges = Number(mutation.changes); lastRowId = Number(mutation.lastInsertRowid);
    }
    return { success: true, results: rows, meta: {
      changes: directChanges, last_row_id: lastRowId, duration: performance.now() - started,
      changed_db: directChanges > 0, rows_read: rows.length, rows_written: directChanges,
      size_after: 0, served_by: 'node-sqlite',
    } };
  }

  transaction<T>(operation: () => T): T {
    const depth = this.transactionDepth++;
    const savepoint = `node_d1_${depth}`;
    try {
      this.native.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
      try {
        const value = operation();
        if (value instanceof Promise) throw new Error('SQLite transaction callback must be synchronous');
        this.native.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
        return value;
      } catch (error) {
        this.native.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      }
    } finally { this.transactionDepth--; }
  }

  async batch<T = Record<string, unknown>>(statements: SqliteD1Statement[]): Promise<SqliteResult<T>[]> {
    if (!Array.isArray(statements) || statements.some(statement => !(statement instanceof SqliteD1Statement) || statement.database !== this)) {
      throw new Error('Invalid SQLite batch');
    }
    return this.transaction(() => statements.map(statement => this.execute(statement) as SqliteResult<T>));
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const started = performance.now();
    const before = Number(this.native.prepare('SELECT total_changes() AS count').get()!.count);
    this.transaction(() => this.native.exec(sql));
    const after = Number(this.native.prepare('SELECT total_changes() AS count').get()!.count);
    return { count: after - before, duration: performance.now() - started };
  }

  close(): void { this.native.close(); }
}
