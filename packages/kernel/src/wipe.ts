/**
 * "ล้างข้อมูลตัวอย่าง": a trial company starts with sample data (packages/starter); when the owner is ready to start for real,
 * identity emits `identity.tenant_data_cleared` and every installed module's kernel deletes ALL of that company's rows from
 * its own database (a built-in kernel subscription, like identity.tokens_revoked — module.json does not list it).
 *
 * Identity publishes the event and the router never sends an event back to its publisher, so the company, its users, roles,
 * plan and profile stay. Identity allows it once, only while the company still holds its untouched sample data (see
 * services/identity starter routes) — this file only does the deleting.
 *
 * Kept on purpose: `_revoked_tokens` (forgetting a revocation would make a logged-out token valid again — SEC-07) and `_inbox`
 * (no company column; it de-duplicates deliveries). Document numbers (`_doc_seq`) restart, so real documents begin at 0001.
 */
import type { Client } from './db.ts';

/** Tables never wiped (see the file header). */
export const WIPE_KEEP = new Set(['_revoked_tokens', '_inbox', '_migrations']);

/**
 * Tables with a tenant_id column, ordered so that every table comes before the tables it references (children first).
 * Throws when the foreign keys form a cycle between tables (a self-reference is fine: one DELETE removes the whole set).
 */
export async function wipeOrder(c: Client): Promise<string[]> {
  const tables = (await c.query<{ name: string }>(
    `select c.table_name as name from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'tenant_id' order by 1`,
  )).rows.map((r) => r.name).filter((t) => !WIPE_KEEP.has(t));
  const edges = (await c.query<{ child: string; parent: string }>(
    `select ch.relname as child, pa.relname as parent from pg_constraint k
       join pg_class ch on ch.oid = k.conrelid join pg_class pa on pa.oid = k.confrelid
      where k.contype = 'f' and k.connamespace = 'public'::regnamespace and k.conrelid <> k.confrelid`,
  )).rows;
  const remaining = new Set(tables);
  const order: string[] = [];
  while (remaining.size) {
    // a table can go once no remaining table still points at it
    const free = [...remaining].filter((t) => !edges.some((e) => e.parent === t && e.child !== t && remaining.has(e.child)));
    if (!free.length) throw new Error(`cannot order the wipe: foreign keys form a cycle between ${[...remaining].join(', ')}`);
    for (const t of free) { order.push(t); remaining.delete(t); }
  }
  return order;
}

/** Delete every row of `tenantId` in this database (inside the caller's transaction). Returns rows deleted per table. */
export async function wipeTenantData(c: Client, tenantId: string): Promise<Record<string, number>> {
  const deleted: Record<string, number> = {};
  for (const table of await wipeOrder(c)) {
    // identifiers come from the catalog, never from the request; quoted anyway
    const r = await c.query(`delete from "${table.replace(/"/g, '""')}" where tenant_id = $1`, [tenantId]);
    if (r.rowCount) deleted[table] = r.rowCount;
  }
  return deleted;
}
