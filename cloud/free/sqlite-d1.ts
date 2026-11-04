type BindValue = string | number | null | ArrayBuffer | ArrayBufferView;

export interface DurableSqlResult<T = Record<string, unknown>> {
  success: true;
  results: T[];
  meta: { changes: number; last_row_id: number; duration: number; changed_db: boolean;
    rows_read: number; rows_written: number; size_after: number; served_by: string };
}

function binding(value: unknown): BindValue {
  if (value === null || typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
  throw new TypeError('Unsupported Durable Object SQLite bind value');
}

export class DurableSqlD1Statement {
  constructor(readonly database: DurableSqlD1Database, readonly sql: string, readonly bindings: unknown[] = []) {}

  bind(...values: unknown[]): DurableSqlD1Statement {
    values.forEach(binding);
    return new DurableSqlD1Statement(this.database, this.sql, values);
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

  async all<T = Record<string, unknown>>(): Promise<DurableSqlResult<T>> { return this.database.execute(this) as DurableSqlResult<T>; }
  async run<T = Record<string, unknown>>(): Promise<DurableSqlResult<T>> { return this.database.execute(this) as DurableSqlResult<T>; }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const cursor = this.database.sql.exec(this.sql, ...this.bindings.map(binding));
    const rows = Array.from(cursor.raw());
    return (options?.columnNames ? [cursor.columnNames, ...rows] : rows) as T[];
  }
}

export class DurableSqlD1Database {
  readonly sql: SqlStorage;
  constructor(readonly storage: DurableObjectStorage) { this.sql = storage.sql; }

  prepare(sql: string): DurableSqlD1Statement {
    if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('SQL statement required');
    return new DurableSqlD1Statement(this, sql);
  }

  execute(statement: DurableSqlD1Statement): DurableSqlResult {
    if (statement.database !== this) throw new Error('Statement belongs to a different Durable Object database');
    const started = performance.now();
    const cursor = this.sql.exec(statement.sql, ...statement.bindings.map(binding));
    const results = cursor.toArray();
    // Consume the cursor before reading statistics, including UPDATE ... RETURNING.
    const rowsWritten = cursor.rowsWritten;
    const changes = rowsWritten > 0 ? Number(this.sql.exec('SELECT changes() AS count').one().count) : 0;
    const lastRowId = Number(this.sql.exec('SELECT last_insert_rowid() AS id').one().id);
    return { success: true, results, meta: {
      changes, last_row_id: lastRowId, duration: performance.now() - started,
      changed_db: rowsWritten > 0, rows_read: cursor.rowsRead, rows_written: rowsWritten,
      size_after: this.sql.databaseSize, served_by: 'durable-object-sqlite',
    } };
  }

  transactionSync<T>(operation: () => T): T {
    // SQL BEGIN/SAVEPOINT statements are not permitted by the DO SQL API.
    return this.storage.transactionSync(() => {
      const result = operation();
      if (result instanceof Promise) throw new Error('Durable Object SQLite transaction callback must be synchronous');
      return result;
    });
  }

  async batch<T = Record<string, unknown>>(statements: DurableSqlD1Statement[]): Promise<DurableSqlResult<T>[]> {
    if (!Array.isArray(statements) || statements.some(statement => !(statement instanceof DurableSqlD1Statement) || statement.database !== this)) {
      throw new Error('Invalid Durable Object SQLite batch');
    }
    return this.transactionSync(() => statements.map(statement => this.execute(statement) as DurableSqlResult<T>));
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const started = performance.now();
    const count = this.transactionSync(() => {
      const cursor = this.sql.exec(sql); cursor.toArray(); return cursor.rowsWritten;
    });
    return { count, duration: performance.now() - started };
  }
}
