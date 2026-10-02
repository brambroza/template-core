/**
 * Token revocation (security review 0.3, SEC-07).
 *
 * Login tokens are stateless HMAC JWTs that every module verifies on its own, so "log this user out" has to reach every module
 * without anyone reading identity's database. Identity emits `identity.tokens_revoked { userId, before, reason }`; the gateway's
 * event router delivers that event to EVERY installed module (a built-in kernel subscription — module.json does not list it),
 * and each module's kernel stores it in its own table `_revoked_tokens` (tenant_id, user_id, before — the largest cutoff wins)
 * and refuses tokens of that user whose `iat` is earlier than `before` (401 `session_revoked`).
 *
 * `auth()` stays synchronous: every service keeps the table in memory, loaded at boot, updated when the event is delivered,
 * and reloaded every `TOKEN_REVOCATION_RELOAD_MS` (default 30 s) so other instances of the same module catch up.
 *
 * Propagation delay: identity applies its own revocation in the same transaction (immediate); other modules get it when the
 * outbox dispatcher delivers it (normally ~1 s, `EVENT_DISPATCH_MS`); another instance of the same module that did not receive
 * the delivery itself picks it up on its next reload (≤ 30 s). If the gateway is down, the outbox retries until it is back.
 */
import type { EventData } from '@erp/contracts';
import type { Client, Db } from './db.ts';

/** Events every module's kernel subscribes to by itself, whatever module.json says. The gateway routes them to all modules. */
export const KERNEL_SUBSCRIPTIONS = ['identity.tokens_revoked'] as const;
export type KernelSubscription = (typeof KERNEL_SUBSCRIPTIONS)[number];
export const isKernelSubscription = (type: string): type is KernelSubscription => (KERNEL_SUBSCRIPTIONS as readonly string[]).includes(type);

export const DEFAULT_REVOCATION_RELOAD_MS = 30_000;

/** In-memory copy of `_revoked_tokens`: (tenant, user) → cutoff in epoch seconds. */
export class RevocationList {
  private cutoffs = new Map<string, number>();
  private key = (tenantId: string, userId: string) => `${tenantId}|${userId}`;

  /** cutoff for this user of this company, or undefined */
  before = (tenantId: string, userId: string): number | undefined => this.cutoffs.get(this.key(tenantId, userId));

  /** remember a cutoff; a smaller (older) one never lowers a larger one */
  note(tenantId: string, userId: string, before: number): void {
    const k = this.key(tenantId, userId);
    const cur = this.cutoffs.get(k);
    if (cur === undefined || before > cur) this.cutoffs.set(k, before);
  }

  get size(): number { return this.cutoffs.size; }

  /** (re)load every tenant's rows (kernel-only read, see the `kernel_revocation_load` policy) */
  async load(db: Db): Promise<number> {
    const rows = await db.rawTx(async (c) => {
      await c.query(`select set_config('app.kernel_read', 'revoked_tokens', true)`);
      return (await c.query<{ tenant_id: string; user_id: string; before: string }>('select tenant_id, user_id, before from _revoked_tokens')).rows;
    });
    for (const r of rows) this.note(r.tenant_id, r.user_id, Number(r.before));
    return rows.length;
  }
}

/**
 * Store a revocation inside the current tenant transaction (`db.tx`), keeping the largest cutoff, and note it in memory.
 * Idempotent: delivering the same (or an older) revocation again changes nothing.
 */
export async function applyRevocation(c: Client, list: RevocationList, data: EventData<'identity.tokens_revoked'>): Promise<void> {
  const r = await c.query<{ tenant_id: string; before: string }>(
    `insert into _revoked_tokens (user_id, before, reason) values ($1, $2, $3)
     on conflict (tenant_id, user_id) do update set before = greatest(_revoked_tokens.before, excluded.before),
       reason = case when excluded.before > _revoked_tokens.before then excluded.reason else _revoked_tokens.reason end,
       updated_at = now()
     returning tenant_id, before`,
    [data.userId, data.before, data.reason],
  );
  // noted before commit: if the transaction rolls back the user is merely refused a little early; the event is retried anyway
  list.note(r.rows[0].tenant_id, data.userId, Number(r.rows[0].before));
}
