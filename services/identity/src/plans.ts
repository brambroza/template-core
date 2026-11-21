/**
 * Cloud plans (Factory OS Cloud, self-serve). Prices are monthly, THB, before VAT — change them here; nothing else hard-codes them.
 * A company with no row in `tenant_subscriptions` has no plan limit (self-hosted installs keep every installed module).
 *
 * Accounting, payroll and e-Tax are in Business but still set up with our team (chart of accounts, opening balances, certificates).
 */
export interface Plan {
  id: PlanId;
  nameTh: string;
  priceMonthly: number;
  /** feature modules (core modules — identity, master-data — are always included) */
  modules: string[];
  maxUsers: number;
}

export type PlanId = 'starter' | 'factory' | 'business';

const STARTER = ['approvals', 'expense', 'hr', 'booking'];
const FACTORY = [...STARTER, 'maintenance', 'inventory', 'purchasing', 'assets', 'automation'];
const BUSINESS = [...FACTORY, 'sales', 'production', 'quality', 'costing', 'crm', 'helpdesk', 'accounting', 'payroll', 'etax'];

export const PLANS: Record<PlanId, Plan> = {
  starter: { id: 'starter', nameTh: 'Starter', priceMonthly: 1490, modules: STARTER, maxUsers: 15 },
  factory: { id: 'factory', nameTh: 'Factory', priceMonthly: 3490, modules: FACTORY, maxUsers: 50 },
  business: { id: 'business', nameTh: 'Business', priceMonthly: 6990, modules: BUSINESS, maxUsers: 100 },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/** Free trial length for a new self-serve company. */
export const TRIAL_DAYS = 14;
/** Days a paid company keeps working after `paid_through` before it is blocked (time to pay the next transfer). */
export const GRACE_DAYS = 7;

export type SubscriptionStatus = 'trial' | 'active' | 'suspended' | 'cancelled';

export const STATUS_TH: Record<SubscriptionStatus, string> = {
  trial: 'ทดลองใช้', active: 'ใช้งาน', suspended: 'ระงับชั่วคราว', cancelled: 'ยกเลิกแล้ว',
};

/** One company's subscription row (identity migration 004). */
export interface SubscriptionRow {
  tenant_id: string;
  plan: PlanId;
  status: SubscriptionStatus;
  /** override of the plan's modules (null = the plan's) */
  modules: string[] | null;
  /** override of the plan's user limit (null = the plan's) */
  max_users: number | null;
  trial_ends_at: string | Date | null;
  /** last day paid for (Bangkok date, YYYY-MM-DD) */
  paid_through: string | null;
  note: string | null;
}

export interface Entitlement {
  plan: Plan;
  status: SubscriptionStatus;
  modules: string[];
  maxUsers: number;
  /** when access ends (trial end, or paid-through + grace), null = open-ended */
  usableUntil: Date | null;
  /** Thai reason the company cannot sign in now, null = it can */
  blocked: string | null;
}

/** End of a Bangkok calendar day as an instant: "2026-12-31" → 2026-12-31T23:59:59.999+07:00. */
export function endOfThaiDay(day: string): Date {
  return new Date(Date.parse(`${day}T23:59:59.999+07:00`));
}

/** What a subscription row allows at `now`. */
export function entitlementOf(row: SubscriptionRow, now: Date = new Date()): Entitlement {
  const plan = PLANS[row.plan] ?? PLANS.starter;
  const base = { plan, status: row.status, modules: row.modules ?? plan.modules, maxUsers: row.max_users ?? plan.maxUsers };
  if (row.status === 'suspended') return { ...base, usableUntil: null, blocked: 'บัญชีบริษัทถูกระงับชั่วคราว — ติดต่อ GO Along ทาง LINE เพื่อเปิดใช้งาน' };
  if (row.status === 'cancelled') return { ...base, usableUntil: null, blocked: 'บริษัทนี้ยกเลิกการใช้งานแล้ว — ติดต่อ GO Along หากต้องการกลับมาใช้' };
  if (row.status === 'trial') {
    const until = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
    const over = until !== null && until.getTime() <= now.getTime();
    return { ...base, usableUntil: until, blocked: over ? `ทดลองใช้ครบ ${TRIAL_DAYS} วันแล้ว — โอนค่าบริการแพ็กเกจ ${plan.nameTh} เพื่อใช้งานต่อ ข้อมูลของคุณยังอยู่ครบ` : null };
  }
  // active: paid through a day, plus a grace period
  if (!row.paid_through) return { ...base, usableUntil: null, blocked: null };
  const until = new Date(endOfThaiDay(row.paid_through).getTime() + GRACE_DAYS * 86_400_000);
  const over = until.getTime() <= now.getTime();
  return { ...base, usableUntil: until, blocked: over ? `เลยกำหนดชำระค่าบริการ (ชำระถึง ${row.paid_through}) — โอนค่าบริการเพื่อใช้งานต่อ ข้อมูลของคุณยังอยู่ครบ` : null };
}

/** Token lifetime: the normal TTL, cut short so no token outlives the company's access. At least 60 s. */
export function tokenTtl(ttl: number, e: Entitlement | null, now: Date = new Date()): number {
  if (!e?.usableUntil) return ttl;
  return Math.max(60, Math.min(ttl, Math.floor((e.usableUntil.getTime() - now.getTime()) / 1000)));
}

/** Whole days left of access (rounded up), null when open-ended. */
export function daysLeft(e: Entitlement, now: Date = new Date()): number | null {
  if (!e.usableUntil) return null;
  return Math.max(0, Math.ceil((e.usableUntil.getTime() - now.getTime()) / 86_400_000));
}
