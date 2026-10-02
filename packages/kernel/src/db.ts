import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { toBuddhistYear } from '@erp/thai';

// numeric -> JS number (money/qty are numeric(18,4); fine for SME volumes, see docs/architecture.md)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// date -> keep as 'YYYY-MM-DD' string (no timezone surprises)
pg.types.setTypeParser(1082, (v) => v);

export type Client = pg.PoolClient;

export interface Db {
  pool: pg.Pool;
  /** Run `fn` in a transaction scoped to one tenant. Row-level security only shows that tenant's rows. */
  tx<T>(tenantId: string, fn: (c: Client) => Promise<T>): Promise<T>;
  /** Transaction WITHOUT tenant scope — only for kernel internals and global tables. */
  rawTx<T>(fn: (c: Client) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 10) });
  // an idle connection killed by the server (restart, failover, test teardown) must not crash the process;
  // the pool drops it and opens a new one on the next query
  pool.on('error', (err) => { if ((err as { code?: string }).code !== '57P01') console.error('[db] idle client error', err.message); });
  async function rawTx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const r = await fn(c);
      await c.query('commit');
      return r;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  return {
    pool,
    rawTx,
    tx: (tenantId, fn) =>
      rawTx(async (c) => {
        await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
        return fn(c);
      }),
    close: () => pool.end(),
  };
}

const TENANT_EXPR = `nullif(current_setting('app.tenant_id', true), '')::uuid`;

/** SQL that turns a table into a tenant-isolated table. Applied for every `-- @tenant <table>` line. */
export function tenantTableSql(table: string): string {
  return `
alter table ${table} alter column tenant_id set default ${TENANT_EXPR};
alter table ${table} enable row level security;
alter table ${table} force row level security;
drop policy if exists tenant_isolation on ${table};
create policy tenant_isolation on ${table} using (tenant_id = ${TENANT_EXPR}) with check (tenant_id = ${TENANT_EXPR});`;
}

const KERNEL_SQL = `
create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now());
create table if not exists _outbox (
  id uuid primary key, tenant_id uuid not null, type text not null, data jsonb not null,
  occurred_at timestamptz not null default now(), sent_at timestamptz, attempts int not null default 0, last_error text);
create index if not exists _outbox_pending on _outbox (occurred_at) where sent_at is null;
create table if not exists _inbox (id uuid primary key, type text not null, received_at timestamptz not null default now());
create table if not exists _doc_seq (tenant_id uuid not null, prefix text not null, year int not null, last int not null, primary key (tenant_id, prefix, year));
`;

/**
 * Apply `migrations/*.sql` in name order, once each.
 * A line `-- @tenant <table>` makes that table tenant-isolated (tenant_id default + RLS policy).
 */
export async function migrate(db: Db, dir: string): Promise<string[]> {
  const applied: string[] = [];
  await db.rawTx(async (c) => {
    await c.query(`select pg_advisory_xact_lock(424242)`);
    await c.query(KERNEL_SQL);
    if (!existsSync(dir)) return;
    const done = new Set((await c.query<{ name: string }>('select name from _migrations')).rows.map((r) => r.name));
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      await c.query(sql);
      for (const m of sql.matchAll(/^--\s*@tenant\s+([a-z_][a-z0-9_]*)\s*$/gim)) await c.query(tenantTableSql(m[1]));
      await c.query('insert into _migrations(name) values ($1)', [file]);
      applied.push(file);
    }
  });
  return applied;
}

/**
 * Next document number for the current tenant, Thai style: `PO-2569-0001`.
 * Must be called inside `db.tx(...)` so it shares the business transaction.
 */
export async function nextDocNo(c: Client, prefix: string, date = new Date()): Promise<string> {
  const year = toBuddhistYear(date);
  const r = await c.query<{ last: number }>(
    `insert into _doc_seq (tenant_id, prefix, year, last) values (${TENANT_EXPR}, $1, $2, 1)
     on conflict (tenant_id, prefix, year) do update set last = _doc_seq.last + 1 returning last`,
    [prefix, year],
  );
  return `${prefix}-${year}-${String(r.rows[0].last).padStart(4, '0')}`;
}

/** First row or a 404. */
export async function one<T = any>(c: Client, sql: string, params: unknown[] = [], what = 'Record'): Promise<T> {
  const r = await c.query(sql, params);
  if (r.rowCount === 0) {
    const { notFound } = await import('./errors.ts');
    throw notFound(what);
  }
  return r.rows[0] as T;
}
