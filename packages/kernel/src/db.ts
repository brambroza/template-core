import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { toBuddhistYear } from '@erp/thai';
import { thaiToday } from './clock.ts';

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
        // business time zone for the transaction: any SQL current_date / now()::date / date_trunc is the Thai day, not UTC (round-2 #4).
        // Services still pass explicit dates computed with thaiToday(); SQL that needs "today" uses TODAY_SQL (= app.today, follows setClock).
        await c.query(`select set_config('app.tenant_id', $1, true), set_config('TimeZone', 'Asia/Bangkok', true), set_config('app.today', $2, true)`, [tenantId, thaiToday()]);
        return fn(c);
      }),
    close: () => pool.end(),
  };
}

const TENANT_EXPR = `nullif(current_setting('app.tenant_id', true), '')::uuid`;

/**
 * SQL expression for today's business date inside `db.tx`: the kernel clock's Thai day (`thaiToday()`, follows `setClock` in tests),
 * falling back to the Bangkok day of now() outside db.tx. Use it instead of `current_date` in queries.
 */
export const TODAY_SQL = `(coalesce(nullif(current_setting('app.today', true), '')::date, (now() at time zone 'Asia/Bangkok')::date))`;

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
create table if not exists _attachments (
  id uuid primary key, tenant_id uuid not null, ref text not null, file_name text not null, content_type text not null,
  size int not null, sha256 text not null, data bytea not null,
  uploaded_by text not null, uploaded_by_name text, created_at timestamptz not null default now());
create index if not exists _attachments_ref on _attachments (tenant_id, ref, created_at);
create table if not exists _audit (
  id bigserial primary key, tenant_id uuid not null, at timestamptz not null default now(),
  user_id text, user_name text, method text not null, route text not null, entity_id text, status int not null, summary jsonb);
create index if not exists _audit_at on _audit (tenant_id, at desc);
create index if not exists _audit_entity on _audit (tenant_id, entity_id, at desc);
create table if not exists _lock_date (
  tenant_id uuid primary key, lock_date date, source text check (source in ('accounting', 'manual')), period text,
  updated_at timestamptz not null default now(), updated_by_name text);
`;

/** Kernel tables holding tenant data: row-level security exactly like a `-- @tenant` business table. */
export const KERNEL_TENANT_TABLES = ['_attachments', '_audit', '_lock_date'] as const;

/**
 * Apply `migrations/*.sql` in name order, once each.
 * A line `-- @tenant <table>` makes that table tenant-isolated (tenant_id default + RLS policy).
 */
export async function migrate(db: Db, dir: string): Promise<string[]> {
  const applied: string[] = [];
  await db.rawTx(async (c) => {
    await c.query(`select pg_advisory_xact_lock(424242)`);
    await c.query(KERNEL_SQL);
    for (const t of KERNEL_TENANT_TABLES) {
      const has = await c.query(`select 1 from pg_policies where schemaname = current_schema() and tablename = $1 and policyname = 'tenant_isolation'`, [t]);
      if (!has.rowCount) await c.query(tenantTableSql(t));
    }
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
/** Next document number for the Thai (Buddhist-era) year of `date` — default: today in Bangkok, so 1 Jan 00:00–07:00 is already the new year. */
export async function nextDocNo(c: Client, prefix: string, date: Date = new Date(`${thaiToday()}T00:00:00Z`)): Promise<string> {
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
