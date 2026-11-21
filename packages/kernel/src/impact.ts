/**
 * "ดูผลกระทบก่อนยืนยัน" (impact preview) — two kernel pieces every module gets:
 *
 * 1. Dry run. A route that opts in with `config: { dryRun: true }` and is called with `?_dryRun=1` runs exactly as usual, but every
 *    transaction it opens is rolled back instead of committed and every event it publishes is captured. The answer is
 *    `{ dryRun: true, result, events: [{ type, data }] }` — the same validation, the same 409s, nothing saved, nothing sent.
 *    Only opt in routes that do all their work in the database (no LINE / webhook / e-mail calls) — those would still happen.
 *
 * 2. `POST /_impact { type, data }` (any signed-in user). A module that subscribes to `type` and declares an `impact` describer for
 *    it says, in Thai, what it WOULD do with that event ("สต็อก RM-01 คลัง MAIN 120 → 720"). The describer may run the module's real
 *    handler (`ctx.run()`) and read the result: the whole call is a dry run, rolled back. Describers check the caller's own
 *    permissions and return nothing they may not see. The gateway fans one preview out to every subscriber (`POST /api/_impact`).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { EventData, EventType } from '@erp/contracts';
import type { AuthContext } from './auth.ts';
import type { Client } from './db.ts';

export interface DryRunStore {
  events: { type: string; data: unknown }[];
}

/** Set while a dry run is in progress: `db.rawTx` rolls back, `kernel.emit` records. */
export const dryRunStore = new AsyncLocalStorage<DryRunStore>();

export const isDryRun = () => dryRunStore.getStore() !== undefined;

/** One line of an impact preview. */
export interface ImpactLine {
  text: string;
  tone?: 'info' | 'ok' | 'warn' | 'stop';
}

export interface ImpactContext {
  client: Client;
  tenantId: string;
  /** who asks (describers show only what this user may read) */
  auth: AuthContext;
  /** run this module's own handler for the event inside the (rolled back) transaction */
  run(): Promise<void>;
}

export type ImpactDescribers = { [T in EventType]?: (data: EventData<T>, ctx: ImpactContext) => Promise<ImpactLine[]> };

/** "1,234.50" — money in previews */
export const impactMoney = (n: number) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
/** "1,234" / "12.5" — quantities in previews */
export const impactQty = (n: number) => new Intl.NumberFormat('th-TH', { maximumFractionDigits: 4 }).format(n);
