/**
 * Attempt counting in Postgres (`auth_attempts`, migration 005): failed logins, sign-ups, password-reset requests. Shared by
 * every identity instance and kept across restarts (it used to live in each instance's memory). Sliding window per key.
 * Writes go through the pool, outside the request's transaction, so a failure is counted even when that transaction rolls back.
 */
export interface Queryable { query<R = any>(sql: string, params?: unknown[]): Promise<{ rows: R[] }> }

export const WINDOW_MS = 15 * 60 * 1000;

/** Attempts for `key` within the window (default 15 minutes). */
export async function attempts(db: Queryable, key: string, windowMs = WINDOW_MS): Promise<number> {
  const r = await db.query<{ n: string }>(`select count(*) as n from auth_attempts where key = $1 and at > now() - make_interval(secs => $2)`, [key, windowMs / 1000]);
  return Number(r.rows[0].n);
}

/** True when any bucket is at its limit. */
export async function overLimit(db: Queryable, buckets: Array<[key: string, max: number]>, windowMs = WINDOW_MS): Promise<boolean> {
  for (const [key, max] of buckets) if ((await attempts(db, key, windowMs)) >= max) return true;
  return false;
}

/** Count one attempt against every key; old rows of those keys are pruned on the way. */
export async function note(db: Queryable, keys: string[], keepMs = 24 * 60 * 60 * 1000): Promise<void> {
  if (!keys.length) return;
  await db.query(`insert into auth_attempts (key) select unnest($1::text[])`, [keys]);
  await db.query(`delete from auth_attempts where key = any($1::text[]) and at < now() - make_interval(secs => $2)`, [keys, keepMs / 1000]);
}

/** Forget a key (the right password clears its e-mail + IP bucket). */
export async function clear(db: Queryable, key: string): Promise<void> {
  await db.query('delete from auth_attempts where key = $1', [key]);
}
