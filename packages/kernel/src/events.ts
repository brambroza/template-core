import { randomUUID } from 'node:crypto';
import { EventEnvelope, isKnownEvent, parseEvent, type EventData, type EventType } from '@erp/contracts';
import type { Client, Db } from './db.ts';

/**
 * Publish an event from inside a business transaction (transactional outbox).
 * The row commits or rolls back together with your data; the dispatcher delivers it later.
 */
export async function emit<T extends EventType>(c: Client, source: string, type: T, data: EventData<T>): Promise<string> {
  const parsed = parseEvent(type, data);
  const id = randomUUID();
  await c.query(
    `insert into _outbox (id, tenant_id, type, data) values ($1, nullif(current_setting('app.tenant_id', true), '')::uuid, $2, $3)`,
    [id, type, JSON.stringify({ source, data: parsed })],
  );
  return id;
}

export interface DispatchResult {
  sent: number;
  failed: number;
}

/**
 * Deliver pending outbox rows to the event router (the gateway). At-least-once:
 * receivers de-duplicate with the inbox table, so retries are safe.
 */
export async function dispatchOutbox(db: Db, routerUrl: string, internalToken: string, batch = 50): Promise<DispatchResult> {
  return db.rawTx(async (c) => {
    const rows = (
      await c.query<{ id: string; tenant_id: string; type: string; data: { source: string; data: unknown }; occurred_at: Date }>(
        `select id, tenant_id, type, data, occurred_at from _outbox where sent_at is null order by occurred_at limit $1 for update skip locked`,
        [batch],
      )
    ).rows;
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      const envelope: EventEnvelope = {
        id: row.id, type: row.type, tenantId: row.tenant_id, source: row.data.source,
        occurredAt: new Date(row.occurred_at).toISOString(), data: row.data.data,
      };
      try {
        const res = await fetch(routerUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-token': internalToken },
          body: JSON.stringify(envelope),
        });
        if (!res.ok) throw new Error(`router responded ${res.status}: ${await res.text()}`);
        await c.query('update _outbox set sent_at = now(), attempts = attempts + 1, last_error = null where id = $1', [row.id]);
        sent++;
      } catch (e) {
        await c.query('update _outbox set attempts = attempts + 1, last_error = $2 where id = $1', [row.id, String((e as Error).message).slice(0, 500)]);
        failed++;
      }
    }
    return { sent, failed };
  });
}

export interface HandlerContext {
  client: Client;
  tenantId: string;
  event: EventEnvelope;
  /** emit a follow-up event in the same transaction */
  emit: <T extends EventType>(type: T, data: EventData<T>) => Promise<string>;
  /** the service's environment (for handlers that call out, e.g. LINE/webhooks) */
  env: NodeJS.ProcessEnv;
}

export type EventHandlers = { [T in EventType]?: (data: EventData<T>, ctx: HandlerContext) => Promise<void> };

/** Process one inbound event exactly once per module (inbox de-duplication inside the tenant transaction). */
export async function receiveEvent(db: Db, source: string, handlers: EventHandlers, raw: unknown, env: NodeJS.ProcessEnv = {}): Promise<'handled' | 'duplicate' | 'ignored'> {
  const envelope = EventEnvelope.parse(raw);
  const type = envelope.type;
  if (!isKnownEvent(type)) return 'ignored';
  const handler = handlers[type] as ((data: unknown, ctx: HandlerContext) => Promise<void>) | undefined;
  if (!handler) return 'ignored';
  const data = parseEvent(type, envelope.data);
  return db.tx(envelope.tenantId, async (client) => {
    const first = await client.query('insert into _inbox (id, type) values ($1, $2) on conflict do nothing returning id', [envelope.id, type]);
    if (first.rowCount === 0) return 'duplicate';
    await handler(data, { client, tenantId: envelope.tenantId, event: envelope, emit: (t, d) => emit(client, source, t, d), env });
    return 'handled';
  });
}
