/**
 * Step 0 spike: can Factory OS run on Supabase Postgres with option A (one database per module)?
 *
 *   node --import tsx tools/erp/.supabase-spike.tmp.mts <env-file>
 *
 * The env file (kept outside the repo, chmod 600) holds:
 *   SPIKE_SESSION_URL=postgresql://postgres.<ref>:<pw>@aws-...pooler.supabase.com:5432/postgres   (Session pooler, role postgres)
 *   SPIKE_TX_URL=postgresql://postgres.<ref>:<pw>@aws-...pooler.supabase.com:6543/postgres        (Transaction pooler, role postgres)
 * The script adds SPIKE_APP_PASSWORD to the same file the first time (the erp_app password it creates).
 * It never prints a password or a full connection string.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import pg from 'pg';
import { createDb, migrate } from '@erp/kernel';

const envFile = process.argv[2];
if (!envFile) throw new Error('usage: spike <env-file>');

/** Parse KEY=VALUE lines. */
function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
  return out;
}
const env = readEnv(envFile);
const SESSION = env.SPIKE_SESSION_URL, TX = env.SPIKE_TX_URL;
if (!SESSION || !TX) throw new Error('env file needs SPIKE_SESSION_URL and SPIKE_TX_URL');

let appPassword = env.SPIKE_APP_PASSWORD;
if (!appPassword) {
  appPassword = randomBytes(24).toString('base64url');
  appendFileSync(envFile, `\nSPIKE_APP_PASSWORD=${appPassword}\n`);
}

const DB = 'spike_crm';
/** Same URL as `admin`, logged in as erp_app (Supavisor wants `erp_app.<project-ref>`) on database `db`. */
function asApp(admin: string, db: string, ssl: string): string {
  const u = new URL(admin);
  const ref = u.username.includes('.') ? u.username.slice(u.username.indexOf('.')) : '';
  u.username = `erp_app${ref}`;
  u.password = appPassword!;
  u.pathname = `/${db}`;
  u.searchParams.set('sslmode', ssl);
  return u.toString();
}
const where = (url: string) => { const u = new URL(url); return `${u.username.split('.')[0]}@${u.hostname}:${u.port}${u.pathname}`; };
const results: { check: string; ok: boolean; note: string }[] = [];
const record = (check: string, ok: boolean, note = '') => { results.push({ check, ok, note }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${check}${note ? `  — ${note}` : ''}`); };
const errText = (e: unknown) => { const x = e as { code?: string; message?: string }; return `${x.code ?? ''} ${x.message ?? String(e)}`.trim(); };

/** Connect, trying full certificate checks first; report which ssl mode worked. */
async function connect(url: string): Promise<{ client: pg.Client; ssl: string }> {
  const isLocal = /127\.0\.0\.1|localhost/.test(url);
  for (const ssl of isLocal ? ['disable'] : ['verify-full', 'no-verify']) {
    const u = new URL(url); u.searchParams.set('sslmode', ssl);
    const client = new pg.Client({ connectionString: u.toString() });
    try { await client.connect(); return { client, ssl }; } catch (e) { if (ssl !== 'no-verify' && !isLocal) { console.log(`      (sslmode=${ssl} failed: ${errText(e)})`); continue; } throw e; }
  }
  throw new Error('unreachable');
}

// 1. admin connection and what the postgres role can do
const t0 = Date.now();
const { client: admin, ssl } = await connect(SESSION);
record('admin connects (session pooler)', true, `${where(SESSION)} sslmode=${ssl} in ${Date.now() - t0} ms`);
const ver = (await admin.query('show server_version')).rows[0].server_version;
const me = (await admin.query(`select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls from pg_roles where rolname = current_user`)).rows[0];
record('Postgres version', true, ver);
record('postgres role: createdb + createrole', me.rolcreatedb && me.rolcreaterole, JSON.stringify(me));
if (me.rolbypassrls) console.log('      note: the Supabase postgres role BYPASSES RLS — the app must never use it');

// 2. erp_app: login, no superuser, no BYPASSRLS
try {
  const has = (await admin.query(`select 1 from pg_roles where rolname = 'erp_app'`)).rowCount;
  const pw = appPassword.replace(/'/g, "''");
  await admin.query(has ? `alter role erp_app login password '${pw}' nosuperuser nobypassrls nocreatedb nocreaterole`
    : `create role erp_app login password '${pw}' nosuperuser nobypassrls nocreatedb nocreaterole`);
  await admin.query('grant erp_app to current_user').catch(() => {}); // needed to create a database owned by erp_app
  const r = (await admin.query(`select rolsuper, rolbypassrls from pg_roles where rolname = 'erp_app'`)).rows[0];
  record('erp_app is NOSUPERUSER NOBYPASSRLS', !r.rolsuper && !r.rolbypassrls, JSON.stringify(r));
} catch (e) { record('create erp_app', false, errText(e)); }

// 3. a module database owned by erp_app (option A)
try {
  const exists = (await admin.query('select 1 from pg_database where datname = $1', [DB])).rowCount;
  if (!exists) await admin.query(`create database ${DB} owner erp_app`);
  record(`create database ${DB} owner erp_app`, true, exists ? 'already there' : 'created');
} catch (e) { record(`create database ${DB}`, false, errText(e)); }
const dbList = (await admin.query(`select count(*)::int n from pg_database where not datistemplate`)).rows[0].n;
await admin.end();

// 4. erp_app through each pooler, to the non-postgres database (the open question of option A)
for (const [label, base] of [['session pooler :5432', SESSION], ['transaction pooler :6543', TX]] as const) {
  const url = asApp(base, DB, ssl);
  const c = new pg.Client({ connectionString: url });
  try {
    await c.connect();
    const r = (await c.query('select current_database() db, current_user u')).rows[0];
    record(`erp_app via ${label} reaches ${DB}`, r.db === DB, `${where(url)} → current_database=${r.db}`);
  } catch (e) { record(`erp_app via ${label} reaches ${DB}`, false, errText(e)); }
  finally { await c.end().catch(() => {}); }
}

// 5. CRM migrations through the transaction pooler (what a running service would do), pool of 3
process.env.DB_POOL_MAX = '3';
const db = createDb(asApp(TX, DB, ssl));
try {
  const t = Date.now();
  const applied = await migrate(db, join(import.meta.dirname, '../../services/crm/migrations'));
  record('CRM migrations via transaction pooler', true, `${applied.length} file(s) applied in ${Date.now() - t} ms (advisory xact lock ok)`);
} catch (e) { record('CRM migrations via transaction pooler', false, errText(e)); }

// 6. RLS: tenant B cannot see tenant A's row
const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';
try {
  await db.tx(A, (c) => c.query(`insert into leads (no, company) values ('SPIKE-1', 'spike rls test')`));
  const seenA = (await db.tx(A, (c) => c.query(`select 1 from leads where no = 'SPIKE-1'`))).rowCount;
  const seenB = (await db.tx(B, (c) => c.query(`select 1 from leads where no = 'SPIKE-1'`))).rowCount;
  const seenNone = (await db.rawTx((c) => c.query(`select 1 from leads where no = 'SPIKE-1'`))).rowCount;
  record('RLS isolates tenants', seenA === 1 && seenB === 0 && seenNone === 0, `tenant A sees ${seenA}, tenant B sees ${seenB}, no tenant sees ${seenNone}`);
  await db.tx(A, (c) => c.query(`delete from leads where no = 'SPIKE-1'`));
} catch (e) { record('RLS isolates tenants', false, errText(e)); }

// 7. round-trip time of one tenant transaction from this machine
try {
  const times: number[] = [];
  for (let i = 0; i < 20; i++) { const t = performance.now(); await db.tx(A, (c) => c.query('select 1')); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  record('tenant transaction round trip (20 runs)', true, `p50 ${times[9]!.toFixed(0)} ms, p95 ${times[18]!.toFixed(0)} ms`);
} catch (e) { record('round trip', false, errText(e)); }
await db.close();

// 8. many concurrent clients through the pooler (22 services × 3)
try {
  const pools = Array.from({ length: 22 }, () => new pg.Pool({ connectionString: asApp(TX, DB, ssl), max: 3 }));
  const t = Date.now();
  await Promise.all(pools.flatMap((p) => [0, 1, 2].map(() => p.query('select pg_sleep(0.2)'))));
  record('66 concurrent connections via transaction pooler', true, `done in ${Date.now() - t} ms`);
  await Promise.all(pools.map((p) => p.end()));
} catch (e) { record('66 concurrent connections', false, errText(e)); }

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed · databases on server: ${dbList}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
