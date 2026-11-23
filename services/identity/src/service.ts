import {
  auth, badRequest, forbidden, hashPassword, hasPerm, HttpError, isExplicitPerm, thaiToday, loadManifest, one, parse, requirePerm, s, signToken, unauthorized, verifyPassword, z,
  type AuthContext, type Client, type Kernel, type ServiceDefinition,
} from '@erp/kernel';
import { formatThaiDate, isValidThaiTaxId } from '@erp/thai';
import { fileURLToPath } from 'node:url';
import { applyTemplate, ROLE_TEMPLATES } from './role-templates.ts';
import { createHash, randomBytes } from 'node:crypto';
import { captchaOk } from './captcha.ts';
import { buttonMail, createMailer } from './mailer.ts';
import { attempts, clear as clearAttempts, note as noteAttempts, overLimit, type Queryable } from './throttle.ts';
import { INDUSTRIES, INDUSTRY_IDS, type IndustryId } from '@erp/starter';
import { runStarter, starterOf, starterView } from './starter.ts';
import { markStep, onboardingOf, ONBOARDING_STEP_IDS } from './onboarding.ts';
import {
  changeText, daysLeft, entitlementOf, MODULE_NAMES_TH, paymentPeriod, PLAN_IDS, PLANS, STATUS_TH, tokenTtl, TRIAL_DAYS, type Entitlement, type PlanId, type SubscriptionRow,
} from './plans.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const email = z.string().trim().toLowerCase().email();
const password = z.string().min(8);

const TenantInput = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/),
  name: s.name,
  admin: z.object({ email, name: s.name, password }),
  /** cloud plan: the company starts a TRIAL_DAYS trial of it. Omitted = no plan limit (self-hosted install). */
  plan: z.enum(PLAN_IDS as [string, ...string[]]).optional(),
  /** sample data of this type of business (see @erp/starter), put in after the answer; omitted = an empty company */
  industry: z.enum(INDUSTRY_IDS as [string, ...string[]]).optional(),
});
/** Back office: a bank transfer received for `months` of the plan (amount before VAT; default plan price × months). */
const PaymentInput = z.object({
  months: z.coerce.number().int().min(1).max(36),
  paidOn: s.isoDate.optional(),
  amount: z.coerce.number().finite().min(0).optional(),
  plan: z.enum(PLAN_IDS as [string, ...string[]]).optional(),
  ref: z.string().trim().max(100).optional(),
  note: z.string().trim().max(500).optional(),
});
/** Back office: change plan / status / trial / seats — always with a reason for the log. */
const OpsPlanInput = z.object({
  plan: z.enum(PLAN_IDS as [string, ...string[]]).optional(),
  status: z.enum(['trial', 'active', 'suspended', 'cancelled']).optional(),
  trialDays: z.coerce.number().int().min(0).max(90).optional(),
  maxUsers: z.coerce.number().int().positive().optional(),
  note: z.string().trim().min(3, 'ระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)').max(500),
}).refine((v) => v.plan || v.status || v.trialDays !== undefined || v.maxUsers !== undefined, 'ไม่มีค่าที่จะเปลี่ยน');

/** Self-serve sign-up (public). The company is created only when the e-mailed link is opened. */
const SignupInput = z.object({
  companyName: s.name,
  name: s.name,
  email,
  password: z.string().min(8, 'รหัสผ่านอย่างน้อย 8 ตัวอักษร').max(200),
  plan: z.enum(PLAN_IDS as [string, ...string[]]).default('factory'),
  /** sample data to start with; "none" = an empty company */
  industry: z.enum(['none', ...INDUSTRY_IDS] as [string, ...string[]]).default('none'),
  captchaToken: z.string().max(4096).optional(),
});
const ClearStarterInput = z.object({ confirm: z.literal('ล้างข้อมูลตัวอย่าง', { errorMap: () => ({ message: 'พิมพ์คำว่า "ล้างข้อมูลตัวอย่าง" เพื่อยืนยัน' }) }) });
const TokenInput = z.object({ token: z.string().min(20).max(200) });
const ForgotInput = z.object({ email, captchaToken: z.string().max(4096).optional() });
const ResetInput = z.object({ token: z.string().min(20).max(200), newPassword: z.string().min(8, 'รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร').max(200) });

/** GO Along back office: change a company's plan / status / payment (bank transfer confirmed by staff). */
const SubscriptionChange = z.object({
  plan: z.enum(PLAN_IDS as [string, ...string[]]).optional(),
  status: z.enum(['trial', 'active', 'suspended', 'cancelled']).optional(),
  /** last day paid for; with status active this is what keeps the company open (plus GRACE_DAYS) */
  paidThrough: s.isoDate.optional(),
  /** extend or shorten the trial: days from now */
  trialDays: z.number().int().min(0).max(90).optional(),
  modules: z.array(z.string().regex(/^[a-z-]+$/)).nullable().optional(),
  maxUsers: z.number().int().positive().nullable().optional(),
  note: z.string().trim().max(500).optional(),
  /** who at GO Along made the change (for the log) */
  by: z.string().trim().min(1).max(100),
}).refine((v) => Object.keys(v).some((k) => k !== 'by' && k !== 'note'), 'ไม่มีค่าที่จะเปลี่ยน');
/** `tenant` (company code) is optional: e-mail is unique across companies. It is still accepted (older apps, and e-mails duplicated before 003). */
const LoginInput = z.object({ tenant: z.string().trim().toLowerCase().optional().transform((v) => v || undefined), email, password: z.string() });
const UserInput = z.object({ email, name: s.name, password, roleIds: z.array(s.uuid).default([]) });
const PasswordChangeInput = z.object({
  currentPassword: z.string().min(1, 'กรอกรหัสผ่านปัจจุบัน'),
  newPassword: z.string().min(8, 'รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร').max(200),
});
const RoleInput = z.object({ name: s.name, permissions: z.array(z.string().regex(/^(\*|[a-z-]+\.(\*|[a-z_.]+))$/)) });

/** Largest logo accepted (decoded bytes). It is embedded in every printed document. */
export const LOGO_MAX_BYTES = 300 * 1024;

/**
 * A logo must be a base64 data URL of a PNG, JPEG or SVG image, ≤ 300 KB decoded,
 * and its bytes must really be that kind of image. Returns a Thai problem, or null when fine.
 */
export function logoProblem(dataUrl: string): string | null {
  const m = /^data:image\/(png|jpeg|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return 'โลโก้ต้องเป็นไฟล์ PNG, JPEG หรือ SVG (data URL แบบ base64)';
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > LOGO_MAX_BYTES) return 'โลโก้ใหญ่เกิน 300 KB';
  const kind = m[1];
  const ok = kind === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : kind === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : /<svg[\s>]/i.test(bytes.toString('utf8'));
  if (!ok) return 'ไฟล์โลโก้ไม่ตรงกับชนิดที่ระบุ';
  // an SVG is a document: no scripts, event handlers, embedded HTML, entities or outside resources (security review 0.3, SEC-11)
  if (kind === 'svg+xml' && /<script|<foreignObject|<!ENTITY|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*["']?\s*(?!#|data:image\/)[a-z]/i.test(bytes.toString('utf8'))) {
    return 'โลโก้ SVG ต้องไม่มีสคริปต์หรือลิงก์ภายนอก (บันทึกเป็น PNG แทนได้)';
  }
  return null;
}

const optText = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();

/** "ผู้จัดทำ, ผู้อนุมัติ" (form text) or ["ผู้จัดทำ", "ผู้อนุมัติ"] -> trimmed labels. */
const labelList = z
  .union([z.array(z.string()), z.string()])
  .transform((v) => (Array.isArray(v) ? v : v.split(/[,\n]/)).map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.string().max(60)).max(6, 'ลายเซ็นได้ไม่เกิน 6 ช่อง'));

const CompanyInput = z.object({
  legalName: z.string().trim().min(1, 'กรอกชื่อนิติบุคคล').max(200),
  nameEn: optText(200),
  branchCode: z.string().trim().regex(/^\d{5}$/, 'รหัสสาขาเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)').default('00000'),
  branchLabel: optText(100),
  address: z.string().trim().min(1, 'กรอกที่อยู่').max(500),
  taxId: z.string().transform((v) => v.replace(/[\s-]/g, '')).nullable().optional()
    .refine((v) => !v || isValidThaiTaxId(v), 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (13 หลัก ตรวจ check digit ไม่ผ่าน)')
    .transform((v) => v || null),
  phone: optText(50),
  email: z.string().trim().max(200).transform((v) => v || null).pipe(z.string().email('อีเมลไม่ถูกต้อง').nullable()).nullable().optional(),
  website: optText(200),
  logo: z.string().max(LOGO_MAX_BYTES * 2, 'โลโก้ใหญ่เกิน 300 KB').nullable().optional()
    .superRefine((v, ctx) => { const p = v ? logoProblem(v) : null; if (p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: p }); })
    .transform((v) => v || null),
  footerNote: optText(500),
  signatureLabels: labelList.optional(),
});

/** "สำนักงานใหญ่" for 00000, "สาขาที่ 00012" otherwise — the wording the Revenue Department expects. */
export const branchText = (code: string) => (code === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${code}`);
/** "0105559012342" -> "0-1055-59012-34-2", as printed on Thai documents (the company screen shows it this way) */
export const taxIdText = (id: string | null | undefined) => {
  const d = (id ?? '').replace(/\D/g, '');
  return d.length === 13 ? `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}` : id ?? null;
};
const companyView = (row: any) => ({ configured: true, ...row, branch_text: row.branch_label || branchText(row.branch_code), tax_id_text: taxIdText(row.tax_id) });

const companyCols = `legal_name, name_en, branch_code, branch_label, address, tax_id, phone, email, website, logo, footer_note, signature_labels, updated_at`;

async function permissionsOf(c: Client, userId: string): Promise<string[]> {
  const r = await c.query<{ p: string }>(
    `select distinct unnest(r.permissions) as p from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1`,
    [userId],
  );
  return r.rows.map((x) => x.p).sort();
}

const publicUser = `id, email, name, active, created_at`;

/**
 * May `a` hand out `perm`? Only what they hold themselves (security review 0.3, SEC-01): `*` needs `*`, `<module>.*` needs
 * `<module>.*` (or `*`), a single permission needs that permission (or a wildcard covering it).
 */
export function canGrant(a: AuthContext, perm: string): boolean {
  if (isExplicitPerm(perm)) return a.perms.includes(perm); // back-office rights: only someone who holds them by name
  if (a.perms.includes('*')) return true;
  if (perm === '*') return false;
  if (perm.endsWith('.*')) return a.perms.includes(perm);
  return hasPerm(a, perm);
}

/** 403 unless the caller holds every permission in `perms` (no granting, removing or taking over more than you have). */
function requireGrantable(a: AuthContext, perms: string[], what: string): void {
  const missing = [...new Set(perms.filter((p) => !canGrant(a, p)))];
  if (missing.length) throw forbidden(`${what}: คุณให้ได้เฉพาะสิทธิ์ที่ตัวเองมี (ขาด ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''})`);
}

/** Permissions of the given roles of this tenant (RLS); 400 when an id is not a role of this company. */
async function permissionsOfRoles(c: Client, roleIds: string[]): Promise<string[]> {
  if (!roleIds.length) return [];
  const rows = (await c.query<{ id: string; permissions: string[] }>('select id, permissions from roles where id = any($1::uuid[])', [roleIds])).rows;
  if (rows.length !== new Set(roleIds).size) throw badRequest('ไม่พบบทบาทที่เลือก');
  return rows.flatMap((r) => r.permissions);
}

/* ---- token revocation (security review 0.3, SEC-07) ---- */

export type RevokeReason = 'logout' | 'password_changed' | 'user_disabled' | 'roles_changed' | 'admin' | 'plan_changed';
const REVOKE_REASON_TH: Record<RevokeReason, string> = {
  logout: 'ออกจากระบบ', password_changed: 'เปลี่ยนรหัสผ่าน', user_disabled: 'ปิดใช้งานบัญชี', roles_changed: 'เปลี่ยนบทบาท', admin: 'ผู้ดูแลบังคับออกจากระบบ', plan_changed: 'เปลี่ยนแพ็กเกจ',
};

/**
 * Cutoff for "every token issued up to now": the NEXT second. Token `iat` has 1-second resolution, so a cutoff of the current
 * second would let a token issued earlier in this same second survive. A login right after a revocation is issued with
 * `iat` = the cutoff (see `/auth/login`), so it is not refused — which is why a second revocation must go past the previous
 * cutoff (`previous + 1`), not just past now. Real wall-clock time — not the kernel's (freezable) business clock — because
 * token `iat` is real time.
 */
export const revocationCutoff = (nowMs = Date.now(), previous?: number) => Math.max(Math.floor(nowMs / 1000), previous ?? 0) + 1;

/** Refuse every token of `userId` issued up to now: stored here at once (kernel) and delivered to every module by the gateway. */
async function revokeTokens(k: Kernel, c: Client, userId: string, reason: RevokeReason): Promise<number> {
  const before = revocationCutoff(Date.now(), await cutoffOf(c, userId));
  await k.emit(c, 'identity.tokens_revoked', { userId, before, reason });
  return before;
}

/** This user's revocation cutoff from identity's own copy of the kernel table (inside the tenant transaction). */
async function cutoffOf(c: Client, userId: string): Promise<number | undefined> {
  const r = await c.query<{ before: string }>('select before from _revoked_tokens where user_id = $1', [userId]);
  return r.rows[0] ? Number(r.rows[0].before) : undefined;
}

/* ---- login throttling (security review 0.3, SEC-02) ----
 * Failures count per e-mail + client IP (LOGIN_MAX_FAILURES), so someone who only knows the owner's e-mail cannot lock the owner
 * out from elsewhere. Two looser caps stop the obvious spreads: one e-mail from many IPs (LOGIN_MAX_FAILURES_PER_EMAIL) and one IP
 * trying many e-mails (LOGIN_MAX_FAILURES_PER_IP). The IP is what the gateway saw (`x-erp-client-ip`); without it ('direct',
 * e.g. tests or a module called inside the network) the per-IP keys share one bucket. */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_MAX_FAILURES_PER_EMAIL = 50;
export const LOGIN_MAX_FAILURES_PER_IP = 100;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const TOO_MANY = 'ใส่รหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่';

/** Client IP forwarded by the gateway (a short, printable value only). */
export function clientIp(headers: Record<string, unknown>): string {
  const v = headers['x-erp-client-ip'];
  return typeof v === 'string' && /^[0-9a-fA-F:.]{2,45}$/.test(v) ? v : 'direct';
}

/** The throttle buckets one login attempt counts against, with each bucket's limit. */
export function loginBuckets(email: string, ip: string): Array<[key: string, max: number]> {
  return [[`login|${email}|${ip}`, LOGIN_MAX_FAILURES], [`login-email|${email}`, LOGIN_MAX_FAILURES_PER_EMAIL], [`login-ip|${ip}`, LOGIN_MAX_FAILURES_PER_IP]];
}
/** the pool the throttle writes to (set when the routes are registered); tests clear it with resetLoginThrottle() */
let throttleDb: Queryable | null = null;
/** test hook: forget all counted attempts (every identity instance shares them in `auth_attempts`) */
export async function resetLoginThrottle(): Promise<void> { await throttleDb?.query('delete from auth_attempts'); }
/* ---- login by e-mail (migration 003): one e-mail = one user in the whole system ---- */
interface LoginCandidate { id: string; tenant_id: string; password_hash: string }
export const EMAIL_TAKEN = 'อีเมลนี้ถูกใช้แล้ว (อีเมลหนึ่งใช้ได้กับผู้ใช้เพียงคนเดียวในระบบ)';
const BAD_LOGIN = 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';

/** Users with this e-mail in ANY company (the `login_lookup` policy, on only inside this transaction). `activeOnly` for login. */
async function usersByEmail(k: Kernel, email: string, activeOnly: boolean): Promise<LoginCandidate[]> {
  return k.db.rawTx(async (c) => {
    await c.query(`select set_config('app.login_lookup', 'on', true)`);
    return (await c.query<LoginCandidate>(
      `select id, tenant_id, password_hash from users where email = $1 ${activeOnly ? 'and active' : ''}`, [email])).rows;
  });
}

/** 409 when the e-mail already belongs to a user in any company (active or not). */
async function requireEmailFree(k: Kernel, email: string): Promise<void> {
  if ((await usersByEmail(k, email, false)).length) throw new HttpError(409, 'email_taken', EMAIL_TAKEN);
}

/** The unique index (users_email_global) answers a race between two creates with the same e-mail: same Thai 409. */
function emailTakenOnRace(e: unknown): never {
  if ((e as { code?: string; constraint?: string }).code === '23505') throw new HttpError(409, 'email_taken', EMAIL_TAKEN);
  throw e;
}

/* ---- cloud plans (migration 004, src/plans.ts) ---- */

/** The company's subscription row, or undefined (no plan limit). Inside the company's transaction. */
async function subscriptionRow(c: Client): Promise<SubscriptionRow | undefined> {
  return (await c.query<SubscriptionRow>('select * from tenant_subscriptions')).rows[0];
}

/** What the company may use now, null = no plan limit. */
async function entitlement(c: Client): Promise<Entitlement | null> {
  const row = await subscriptionRow(c);
  return row ? entitlementOf(row) : null;
}

/** The plan as the apps show it (banner "ทดลองใช้เหลือ 5 วัน", settings page). */
function subscriptionView(e: Entitlement | null) {
  if (!e) return null;
  return {
    plan: e.plan.id, planName: e.plan.nameTh, priceMonthly: e.plan.priceMonthly, status: e.status, statusTh: STATUS_TH[e.status],
    modules: e.modules, maxUsers: e.maxUsers, usableUntil: e.usableUntil?.toISOString() ?? null, daysLeft: daysLeft(e), blocked: e.blocked,
  };
}

/** 409 `user_limit` when the plan's active users are all taken (deactivated users free a seat). */
async function requireUserSeat(c: Client): Promise<void> {
  const plan = await entitlement(c);
  if (!plan) return;
  await c.query('select pg_advisory_xact_lock(hashtext(current_setting(\'app.tenant_id\')))'); // two admins adding the last seat at once
  const used = Number((await c.query<{ n: string }>('select count(*) as n from users where active')).rows[0].n);
  if (used >= plan.maxUsers) {
    throw new HttpError(409, 'user_limit', `แพ็กเกจ ${plan.plan.nameTh} ใช้ได้ ${plan.maxUsers} ผู้ใช้ (ตอนนี้ ${used}) — ปิดบัญชีผู้ใช้ที่ไม่ใช้แล้ว หรืออัปเกรดแพ็กเกจ`);
  }
}

/** 402 with the Thai reason when the company may not sign in now (trial over, unpaid, suspended). */
function requireOpen(e: Entitlement | null): void {
  if (e?.blocked) throw new HttpError(402, 'subscription_inactive', e.blocked);
}

/* ---- self-serve sign-up and password reset (migration 005) ---- */

export const SIGNUP_LINK_HOURS = 24;
export const RESET_LINK_MINUTES = 60;
/** an invitation link (set your password) lasts longer than a reset: the colleague may read the mail days later */
export const INVITE_LINK_HOURS = 72;
const HOUR_MS = 60 * 60 * 1000;
/** per hour: sign-ups per IP / per e-mail, reset requests per e-mail / per IP, bad reset links per IP */
export const SIGNUP_LIMITS = { ip: 5, email: 3 } as const;
export const FORGOT_LIMITS = { email: 3, ip: 10 } as const;
const BAD_LINK_PER_IP = 20;

/** A one-time link token and the hash we keep (the token itself is only in the e-mail). */
function newLinkToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

const FREE_MAIL = new Set(['gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'hotmail.co.th', 'yahoo.co.th', 'msn.com', 'proton.me', 'protonmail.com']);

/** Company code candidates from the e-mail domain: owner@siam-parts.co.th → siam-parts; free mail → a random code. */
export function companyCodeBase(mail: string): string {
  const domain = mail.split('@')[1]?.toLowerCase() ?? '';
  const label = FREE_MAIL.has(domain) ? '' : (domain.split('.')[0] ?? '').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '').slice(0, 24);
  return label.length >= 2 ? label : `co-${randomBytes(4).toString('hex')}`;
}

/**
 * Public address of the web app for links in e-mails. Only APP_URL is trusted in production: a link built from the request's
 * Host header could point a reset mail at someone else's site. Outside production the gateway's forwarded host is used.
 */
function appUrl(env: Record<string, string | undefined>, headers: Record<string, unknown>): string {
  const configured = env.APP_URL || env.PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (env.NODE_ENV === 'production') throw new HttpError(503, 'not_configured', 'ระบบสมัครใช้งานยังไม่พร้อม (ยังไม่ได้ตั้ง APP_URL / PUBLIC_APP_URL) — ติดต่อ GO Along');
  const host = String(headers['x-forwarded-host'] ?? headers.host ?? 'localhost:3000');
  return `${String(headers['x-forwarded-proto'] ?? 'http')}://${host}`;
}

/** compared against when the user does not exist, so a wrong e-mail costs the same time as a wrong password */
const DUMMY_HASH = hashPassword('not-a-real-password-' + Math.random());

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    const secret = k.env.JWT_SECRET!;
    const ttl = Number(k.env.JWT_TTL_SECONDS ?? 60 * 60 * 12);
    throttleDb = k.db.pool;

    /** Create a company + its first admin. Called by GO Along's provisioning (internal token), not by end users. */
    /**
     * New company + Administrator role (`*`) + first admin, and with `plan` a trial of it. The e-mail must be free in every company
     * (checked before the company row; a lost race deletes the company again). Used by provisioning and by sign-up.
     */
    async function provision(p: { code: string; name: string; admin: { email: string; name: string; passwordHash: string }; plan?: string; by: string }) {
      await requireEmailFree(k, p.admin.email);
      const tenant = await k.db.rawTx(async (c) => (await c.query('insert into tenants (code, name) values ($1, $2) returning *', [p.code, p.name])).rows[0]);
      const user = await k.db.tx(tenant.id, async (c) => {
        const role = (await c.query(`insert into roles (name, permissions) values ('Administrator', '{*}') returning id`)).rows[0];
        const u = (await c.query(`insert into users (email, name, password_hash) values ($1, $2, $3) returning ${publicUser}`, [p.admin.email, p.admin.name, p.admin.passwordHash])).rows[0];
        await c.query('insert into user_roles (user_id, role_id) values ($1, $2)', [u.id, role.id]);
        if (p.plan) {
          await c.query(`insert into tenant_subscriptions (plan, status, trial_ends_at) values ($1, 'trial', now() + make_interval(days => $2))`, [p.plan, TRIAL_DAYS]);
          await c.query('insert into tenant_subscription_log (change, by_name) values ($1, $2)', [JSON.stringify({ plan: p.plan, status: 'trial', trialDays: TRIAL_DAYS }), p.by]);
          await c.query('insert into tenant_onboarding default values'); // cloud companies get the "ตั้งค่าเริ่มต้น" wizard
        }
        return u;
      }).catch(async (e) => {
        await k.db.rawTx((c) => c.query('delete from tenants where id = $1', [tenant.id])); // lost a race on the e-mail: no empty company
        return emailTakenOnRace(e);
      });
      return { tenant, user };
    }

    /** Sample data in the background (a few seconds): the answer does not wait; the home page shows "กำลังเตรียม…" meanwhile. */
    async function startStarter(tenantId: string, industry: string | null | undefined) {
      if (!industry || industry === 'none') return;
      const plan = await k.db.tx(tenantId, entitlement);
      void runStarter(k, { tenantId, industry: industry as IndustryId, modules: plan?.modules ?? null, log: (m) => app.log.info(`[starter ${tenantId}] ${m}`) });
    }

    /** A free company code from a base (base, base-2 … base-9, then base-<random>). */
    async function freeCode(base: string): Promise<string> {
      for (let i = 1; i <= 9; i++) {
        const code = i === 1 ? base : `${base}-${i}`;
        if (!(await k.db.pool.query('select 1 from tenants where code = $1', [code])).rowCount) return code;
      }
      return `${base.slice(0, 20)}-${randomBytes(3).toString('hex')}`;
    }

    /** Login answer for a user who just proved who they are (password, or a sign-up link). Inside the company's transaction. */
    async function session(c: Client, tenant: { id: string; code: string; name: string }, u: { id: string; email: string; name: string }) {
      // cloud plan: closed companies get the reason (402); the token lists the plan's modules and ends when access ends
      const plan = await entitlement(c);
      requireOpen(plan);
      const perms = await permissionsOf(c, u.id);
      const life = tokenTtl(ttl, plan);
      // signed at or after the user's revocation cutoff, so a login in the same second as a logout is not refused (SEC-07)
      const token = signToken(secret, { tenantId: tenant.id, userId: u.id, perms, userName: u.name, ...(plan ? { modules: plan.modules } : {}) }, life, { iat: await cutoffOf(c, u.id) });
      return { token, expiresIn: life, tenant, user: { id: u.id, email: u.email, name: u.name }, permissions: perms, subscription: subscriptionView(plan) };
    }

    const mailer = createMailer(k.env);

    app.post('/tenants', { config: { internal: true } }, async (req, reply) => {
      const body = parse(TenantInput, req.body);
      const { tenant, user } = await provision({
        code: body.code, name: body.name, plan: body.plan, by: 'GO Along (provisioning)',
        admin: { email: body.admin.email, name: body.admin.name, passwordHash: hashPassword(body.admin.password) },
      });
      await startStarter(tenant.id, body.industry);
      reply.code(201);
      return { tenant, admin: user, subscription: body.plan ? subscriptionView(await k.db.tx(tenant.id, entitlement)) : null, starter: body.industry ? 'seeding' : null };
    });

    /** Plans for the public sign-up page (no prices hard-coded in the apps). */
    app.get('/plans', { config: { public: true } }, async () => ({
      trialDays: TRIAL_DAYS,
      plans: Object.values(PLANS).map((p) => ({ ...p, modulesTh: p.modules.map((m) => MODULE_NAMES_TH[m] ?? m) })),
      // types of business with sample data (@erp/starter) for the sign-up page
      industries: INDUSTRY_IDS.map((id) => ({ id, nameTh: INDUSTRIES[id].nameTh, blurb: INDUSTRIES[id].blurb })),
    }));

    /**
     * Self-serve sign-up: `{ companyName, name, email, password, plan?, captchaToken? }` → 202 with the same Thai answer whether or not
     * the e-mail already has an account (no account discovery). New e-mail: a confirmation link (24 h). Taken: a mail pointing to
     * "ลืมรหัสผ่าน". CAPTCHA (Turnstile) when TURNSTILE_SECRET is set; 5 per hour per IP, 3 per hour per e-mail.
     */
    app.post('/signup', { config: { public: true } }, async (req, reply) => {
      const b = parse(SignupInput, req.body);
      const ip = clientIp(req.headers);
      const keys: Array<[string, number]> = [[`signup-ip|${ip}`, SIGNUP_LIMITS.ip], [`signup-email|${b.email}`, SIGNUP_LIMITS.email]];
      if (await overLimit(k.db.pool, keys, HOUR_MS)) throw new HttpError(429, 'too_many_attempts', 'สมัครหลายครั้งเกินไป กรุณารอ 1 ชั่วโมงแล้วลองใหม่');
      if (!(await captchaOk(k.env, b.captchaToken, ip))) throw new HttpError(400, 'captcha_failed', 'ยืนยันว่าไม่ใช่โปรแกรมอัตโนมัติไม่ผ่าน — ลองใหม่อีกครั้ง');
      await noteAttempts(k.db.pool, keys.map(([key]) => key));
      const base = appUrl(k.env, req.headers);
      let mail;
      if ((await usersByEmail(k, b.email, false)).length) {
        hashPassword(b.password); // same work as a new sign-up, so the answer time does not tell whether the e-mail exists
        mail = buttonMail(b.email, 'มีบัญชี GO Along สำหรับอีเมลนี้อยู่แล้ว', [
          `มีคนพยายามสมัครใช้งาน GO Along ด้วยอีเมลนี้ แต่อีเมลนี้มีบัญชีอยู่แล้ว`,
          'ถ้าเป็นคุณ เข้าสู่ระบบได้เลย หรือตั้งรหัสผ่านใหม่ถ้าจำไม่ได้',
        ], { label: 'ตั้งรหัสผ่านใหม่', url: `${base}/forgot-password` }, 'ถ้าไม่ได้สมัครเอง ไม่ต้องทำอะไร บัญชีของคุณยังปลอดภัย');
      } else {
        const link = newLinkToken();
        await k.db.pool.query(
          `insert into signups (email, company_name, name, password_hash, plan, token_hash, expires_at, industry)
           values ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7), $8)`,
          [b.email, b.companyName, b.name, hashPassword(b.password), b.plan, link.hash, SIGNUP_LINK_HOURS, b.industry === 'none' ? null : b.industry]);
        mail = buttonMail(b.email, 'ยืนยันอีเมลเพื่อเริ่มใช้งาน GO Along', [
          `สวัสดีคุณ${b.name}`,
          `กดปุ่มด้านล่างเพื่อยืนยันอีเมลและเริ่มทดลองใช้ ${b.companyName} ฟรี ${TRIAL_DAYS} วัน`,
        ], { label: 'ยืนยันอีเมลและเริ่มใช้งาน', url: `${base}/signup/verify?token=${link.token}` }, `ลิงก์นี้ใช้ได้ ${SIGNUP_LINK_HOURS} ชั่วโมง · ถ้าไม่ได้สมัครเอง ไม่ต้องทำอะไร`);
      }
      try { await mailer(mail); } catch (e) {
        req.log.error(e);
        throw new HttpError(503, 'mail_failed', 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้งในอีกสักครู่');
      }
      reply.code(202);
      return { ok: true, message: `ส่งลิงก์ยืนยันไปที่ ${b.email} แล้ว — เปิดอีเมลแล้วกดยืนยันภายใน ${SIGNUP_LINK_HOURS} ชั่วโมง (ถ้าไม่เห็น ลองดูในโฟลเดอร์สแปม)` };
    });

    /** The link in the sign-up mail: creates the company + first admin + trial, then answers like a login (the app goes straight in). */
    app.post('/signup/verify', { config: { public: true } }, async (req, reply) => {
      const { token } = parse(TokenInput, req.body);
      const ip = clientIp(req.headers);
      if (await overLimit(k.db.pool, [[`badlink-ip|${ip}`, BAD_LINK_PER_IP]])) throw new HttpError(429, 'too_many_attempts', TOO_MANY);
      const pending = await k.db.rawTx(async (c) => {
        const row = (await c.query(
          `select * from signups where token_hash = $1 and verified_at is null and expires_at > now() for update`, [sha256(token)])).rows[0];
        if (row) await c.query('update signups set verified_at = now() where id = $1', [row.id]);
        return row;
      });
      if (!pending) {
        await noteAttempts(k.db.pool, [`badlink-ip|${ip}`]);
        throw new HttpError(400, 'link_invalid', 'ลิงก์ยืนยันหมดอายุหรือถูกใช้ไปแล้ว — สมัครใหม่อีกครั้ง หรือเข้าสู่ระบบถ้ายืนยันไปแล้ว');
      }
      const { tenant, user } = await provision({
        code: await freeCode(companyCodeBase(pending.email)), name: pending.company_name, plan: pending.plan, by: 'สมัครใช้งานเอง',
        admin: { email: pending.email, name: pending.name, passwordHash: pending.password_hash },
      });
      await k.db.pool.query('update signups set tenant_id = $2 where id = $1', [pending.id, tenant.id]);
      await startStarter(tenant.id, pending.industry);
      reply.code(201);
      return k.db.tx(tenant.id, (c) => session(c, tenant, user));
    });

    /**
     * "ลืมรหัสผ่าน": `{ email, captchaToken? }` → 202 with the same answer whether or not the e-mail has an account. An active user
     * gets a one-time link (RESET_LINK_MINUTES). 3 per hour per e-mail, 10 per IP.
     */
    app.post('/auth/forgot', { config: { public: true } }, async (req, reply) => {
      const b = parse(ForgotInput, req.body);
      const ip = clientIp(req.headers);
      const keys: Array<[string, number]> = [[`forgot-email|${b.email}`, FORGOT_LIMITS.email], [`forgot-ip|${ip}`, FORGOT_LIMITS.ip]];
      if (await overLimit(k.db.pool, keys, HOUR_MS)) throw new HttpError(429, 'too_many_attempts', 'ขอตั้งรหัสผ่านใหม่หลายครั้งเกินไป กรุณารอ 1 ชั่วโมง');
      if (!(await captchaOk(k.env, b.captchaToken, ip))) throw new HttpError(400, 'captcha_failed', 'ยืนยันว่าไม่ใช่โปรแกรมอัตโนมัติไม่ผ่าน — ลองใหม่อีกครั้ง');
      await noteAttempts(k.db.pool, keys.map(([key]) => key));
      const base = appUrl(k.env, req.headers);
      const users = await usersByEmail(k, b.email, true);
      if (users.length === 1) {
        const link = newLinkToken();
        await k.db.pool.query(
          `insert into password_resets (tenant_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4))`,
          [users[0].tenant_id, users[0].id, link.hash, RESET_LINK_MINUTES]);
        try {
          await mailer(buttonMail(b.email, 'ตั้งรหัสผ่านใหม่ GO Along', [
            'มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ', 'กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่',
          ], { label: 'ตั้งรหัสผ่านใหม่', url: `${base}/reset-password?token=${link.token}` },
          `ลิงก์ใช้ได้ ${RESET_LINK_MINUTES} นาทีและครั้งเดียว · ถ้าไม่ได้ขอเอง ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้`));
        } catch (e) {
          req.log.error(e);
          throw new HttpError(503, 'mail_failed', 'ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่อีกครั้งในอีกสักครู่');
        }
      }
      reply.code(202);
      return { ok: true, message: `ถ้า ${b.email} มีบัญชีอยู่ เราส่งลิงก์ตั้งรหัสผ่านใหม่ให้แล้ว — ลิงก์ใช้ได้ ${RESET_LINK_MINUTES} นาที` };
    });

    /** The link in the reset mail: `{ token, newPassword }` → new password, every older session ends, the login throttle is cleared. */
    app.post('/auth/reset', { config: { public: true } }, async (req) => {
      const b = parse(ResetInput, req.body);
      const ip = clientIp(req.headers);
      if (await overLimit(k.db.pool, [[`badlink-ip|${ip}`, BAD_LINK_PER_IP]])) throw new HttpError(429, 'too_many_attempts', TOO_MANY);
      const reset = await k.db.rawTx(async (c) => {
        const row = (await c.query<{ id: string; tenant_id: string; user_id: string }>(
          `select id, tenant_id, user_id from password_resets where token_hash = $1 and used_at is null and expires_at > now() for update`, [sha256(b.token)])).rows[0];
        if (row) await c.query('update password_resets set used_at = now() where id = $1', [row.id]);
        return row;
      });
      if (!reset) {
        await noteAttempts(k.db.pool, [`badlink-ip|${ip}`]);
        throw new HttpError(400, 'link_invalid', 'ลิงก์ตั้งรหัสผ่านหมดอายุหรือถูกใช้ไปแล้ว — ขอลิงก์ใหม่ที่หน้า "ลืมรหัสผ่าน"');
      }
      const mail = await k.db.tx(reset.tenant_id, async (c) => {
        const u = (await c.query<{ email: string }>('update users set password_hash = $2 where id = $1 and active returning email', [reset.user_id, hashPassword(b.newPassword)])).rows[0];
        if (!u) throw new HttpError(400, 'link_invalid', 'บัญชีนี้ถูกปิดใช้งาน — ติดต่อผู้ดูแลระบบของบริษัท');
        // other links of this user stop working too (same transaction: a second pool connection here could deadlock under load)
        await c.query('update password_resets set used_at = now() where user_id = $1 and used_at is null', [reset.user_id]);
        await revokeTokens(k, c, reset.user_id, 'password_changed');
        return u.email;
      });
      for (const [key] of loginBuckets(mail, ip)) await clearAttempts(k.db.pool, key);
      return { ok: true, message: 'ตั้งรหัสผ่านใหม่แล้ว — เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย (อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะต้องเข้าสู่ระบบใหม่)' };
    });

    /**
     * `{ email, password }` → token. E-mail is unique across companies, so the company is found from the user.
     * `tenant` (company code) is optional and only needed for e-mails that two companies had before migration 003:
     * then the password picks the account, and if it fits several → 409 `tenant_required` (the apps then ask for the code).
     */
    app.post('/auth/login', { config: { public: true } }, async (req) => {
      const body = parse(LoginInput, req.body);
      // per e-mail + IP, plus looser per-e-mail and per-IP caps (see loginBuckets), then waits (429) — with or without a company code
      const buckets = loginBuckets(body.email, clientIp(req.headers));
      if (await overLimit(k.db.pool, buckets)) throw new HttpError(429, 'too_many_attempts', TOO_MANY);
      const fail = async (): Promise<never> => { await noteAttempts(k.db.pool, buckets.map(([key]) => key)); throw unauthorized(BAD_LOGIN); };
      let tenantId: string;
      if (body.tenant) {
        const t = (await k.db.pool.query<{ id: string }>('select id from tenants where code = $1', [body.tenant])).rows[0];
        if (!t) { verifyPassword(body.password, DUMMY_HASH); return fail(); }
        tenantId = t.id;
      } else {
        const candidates = await usersByEmail(k, body.email, true);
        if (!candidates.length) { verifyPassword(body.password, DUMMY_HASH); return fail(); }
        const fits = candidates.filter((u) => verifyPassword(body.password, u.password_hash));
        if (!fits.length) return fail();
        if (fits.length > 1) throw new HttpError(409, 'tenant_required', 'อีเมลนี้อยู่ในหลายบริษัท กรุณาใส่รหัสบริษัท');
        tenantId = fits[0].tenant_id;
      }
      const tenant = (await k.db.pool.query('select id, code, name from tenants where id = $1', [tenantId])).rows[0];
      // Never hold a transaction while taking a second pool connection (the throttle): with as many logins at once as the pool
      // has connections, every one of them waited for another forever. Read, check, count — then the session transaction.
      const u = await k.db.tx(tenant.id, async (c) => (await c.query('select * from users where email = $1 and active', [body.email])).rows[0]);
      const ok = verifyPassword(body.password, u?.password_hash ?? DUMMY_HASH) && !!u;
      if (!ok) return fail();
      await clearAttempts(k.db.pool, buckets[0][0]); // the right password clears this e-mail + IP; the wider caps age out on their own
      return k.db.tx(tenant.id, (c) => session(c, tenant, u));
    });

    app.get('/me', async (req) => {
      const a = auth(req);
      return k.db.tx(a.tenantId, async (c) => {
        const u = await one(c, `select ${publicUser} from users where id = $1`, [a.userId], 'User');
        return { ...u, tenantId: a.tenantId, permissions: await permissionsOf(c, a.userId), subscription: subscriptionView(await entitlement(c)) };
      });
    });

    /** The company's cloud plan (null = no plan limit): name, status, modules, user limit, days left. Any signed-in user. */
    /** Sample data of this company for the home-page banner: null when it has none (or it was cleared). */
    app.get('/starter', async (req) => {
      const a = auth(req);
      return { starter: starterView(await k.db.tx(a.tenantId, starterOf)) };
    });

    /**
     * "ล้างข้อมูลตัวอย่าง — เริ่มใช้จริง": every module deletes ALL of this company's data (sample and anything recorded since);
     * users, roles, the company profile and the plan stay. Once only, never while seeding, and the owner types the words.
     */
    app.post('/starter/clear', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.company.write');
      parse(ClearStarterInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const row = await starterOf(c);
        if (!row || row.state === 'cleared') throw new HttpError(409, 'no_sample_data', 'บริษัทนี้ไม่มีข้อมูลตัวอย่างให้ล้างแล้ว');
        if (row.state === 'seeding') throw new HttpError(409, 'starter_seeding', 'กำลังเตรียมข้อมูลตัวอย่างอยู่ — รอสักครู่แล้วลองใหม่');
        const by = a.userName ?? a.userId;
        await c.query(`update tenant_starter set state = 'cleared', cleared_at = now(), cleared_by = $1`, [by]);
        await k.emit(c, 'identity.tenant_data_cleared', { reason: 'starter', by });
        return { ok: true, message: 'กำลังล้างข้อมูลตัวอย่างในทุกระบบ (ไม่กี่วินาที) — ผู้ใช้ บทบาท ข้อมูลบริษัท และแพ็กเกจยังอยู่ครบ' };
      });
    });

    app.get('/subscription', async (req) => {
      const a = auth(req);
      return k.db.tx(a.tenantId, async (c) => {
        const view = subscriptionView(await entitlement(c));
        const usedUsers = Number((await c.query<{ n: string }>('select count(*) as n from users where active')).rows[0].n);
        // flat fields for the settings screen ("แพ็กเกจของบริษัท"), `subscription` for the apps' banner
        return {
          subscription: view, usedUsers, plans: Object.values(PLANS),
          plan_text: view ? `${view.planName} · ${view.priceMonthly.toLocaleString('en-US')} บาท/เดือน (ไม่รวม VAT)` : 'ไม่จำกัดแพ็กเกจ (ติดตั้งในเครื่องของบริษัท)',
          status_text: view ? (view.blocked ?? (view.daysLeft === null ? view.statusTh : `${view.statusTh} · เหลือ ${view.daysLeft} วัน`)) : 'ใช้งาน',
          usable_until: view?.usableUntil ?? null,
          users_text: view ? `${usedUsers} / ${view.maxUsers} คน` : `${usedUsers} คน`,
          modules: (view?.modules ?? []).map((m) => MODULE_NAMES_TH[m] ?? m),
          how_to_pay: view ? 'โอนค่าบริการเข้าบัญชีบริษัท โกอะลอง จำกัด แล้วส่งสลิปทาง LINE OA ของ GO Along — ทีมงานยืนยันและต่ออายุให้ภายในวันทำการ' : null,
        };
      });
    });

    /* ---- GO Along back office (internal token only; the ops console and `pnpm erp` call these) ---- */

    /** Every company with its plan, status, days left and active users. `?q=` filters by code or name. */
    app.get('/_ops/tenants', { config: { internal: true } }, async (req) => listCompanies(String((req.query as { q?: string }).q ?? '')));

    /**
     * Change a company's plan, status or payment — e.g. after a bank transfer: `{ status: 'active', paidThrough: '2026-12-31', by }`.
     * Creates the row when the company had none (it then gets plan limits). Every change is logged; when what the company may use
     * changes (plan, modules, status), every user's tokens are revoked so the next login carries the new module list.
     */
    /**
     * Apply a subscription change inside the company's transaction: creates the row when missing (`plan` then required), logs it,
     * and when what the company may use changes (plan, modules, status), revokes every user's tokens so the next login carries
     * the new module list. Shared by the internal API (`pnpm erp plan`) and the back-office screens.
     */
    async function changeSubscription(c: Client, b: z.infer<typeof SubscriptionChange>) {
      const before = await subscriptionRow(c);
      if (!before && !b.plan) throw badRequest('บริษัทนี้ยังไม่มีแพ็กเกจ — ระบุ plan', { fieldErrors: { plan: ['ระบุแพ็กเกจ'] }, formErrors: [] });
      if (b.status === 'active' && !b.paidThrough && !before?.paid_through) {
        throw badRequest('เปิดใช้งานแบบชำระเงินต้องระบุวันที่ชำระถึง (paidThrough)', { fieldErrors: { paidThrough: ['ระบุวันที่ชำระถึง'] }, formErrors: [] });
      }
      await c.query(
        `insert into tenant_subscriptions (plan, status, trial_ends_at) values ($1, 'trial', now() + make_interval(days => $2))
         on conflict (tenant_id) do nothing`, [b.plan ?? before?.plan, TRIAL_DAYS]);
      await c.query(
        `update tenant_subscriptions set
           plan = coalesce($1, plan), status = coalesce($2, status), paid_through = coalesce($3::date, paid_through),
           trial_ends_at = case when $4::int is null then trial_ends_at else now() + make_interval(days => $4::int) end,
           modules = case when $5::boolean then $6::text[] else modules end,
           max_users = case when $7::boolean then $8::int else max_users end,
           note = coalesce($9, note), updated_at = now()`,
        [b.plan ?? null, b.status ?? null, b.paidThrough ?? null, b.trialDays ?? null,
          b.modules !== undefined, b.modules ?? null, b.maxUsers !== undefined, b.maxUsers ?? null, b.note ?? null]);
      const { by, ...change } = b;
      await c.query('insert into tenant_subscription_log (change, by_name) values ($1, $2)', [JSON.stringify(change), by]);
      const after = (await subscriptionRow(c))!;
      const was = before ? entitlementOf(before) : null;
      const now = entitlementOf(after);
      const accessChanged = !was || was.modules.join() !== now.modules.join() || !!was.blocked !== !!now.blocked || was.status !== now.status;
      let revoked = 0;
      if (accessChanged) {
        for (const u of (await c.query<{ id: string }>('select id from users where active')).rows) { await revokeTokens(k, c, u.id, 'plan_changed'); revoked++; }
      }
      return { subscription: subscriptionView(now), revokedUsers: revoked };
    }

    /** Every company (newest first, ≤ 500) with its plan and active users; `q` filters by code or name. Cross-tenant: back office only. */
    async function listCompanies(query: string) {
      const q = query.trim().toLowerCase();
      return k.db.rawTx(async (c) => {
        await c.query(`select set_config('app.ops_read', 'on', true), set_config('app.login_lookup', 'on', true)`);
        const rows = (await c.query<SubscriptionRow & { id: string; code: string; name: string; tenant_created_at: string; users: string }>(
          `select t.id, t.code, t.name, t.created_at as tenant_created_at, s.tenant_id, s.plan, s.status, s.modules, s.max_users, s.trial_ends_at,
                  s.paid_through, s.note, (select count(*) from users u where u.tenant_id = t.id and u.active) as users
             from tenants t left join tenant_subscriptions s on s.tenant_id = t.id
            where $1 = '' or lower(t.code) like '%' || $1 || '%' or lower(t.name) like '%' || $1 || '%'
            order by t.created_at desc limit 500`, [q])).rows;
        return rows.map((r) => {
          const view = r.plan ? subscriptionView(entitlementOf(r)) : null;
          return {
            id: r.id, code: r.code, name: r.name, createdAt: r.tenant_created_at, activeUsers: Number(r.users),
            subscription: view, paidThrough: r.paid_through ?? null, note: r.note ?? null,
            // flat fields for the back-office list
            plan_name: view?.planName ?? 'ไม่จำกัด (ติดตั้งเอง)', status_th: view ? (view.blocked ? `${view.statusTh} · ปิดอยู่` : view.statusTh) : '—',
            days_left: view?.daysLeft ?? null, blocked: !!view?.blocked,
          };
        });
      });
    }

    async function tenantByCode(code: string): Promise<{ id: string; code: string; name: string }> {
      const t = (await k.db.pool.query('select id, code, name from tenants where code = $1', [code.toLowerCase()])).rows[0];
      if (!t) throw new HttpError(404, 'not_found', `ไม่พบบริษัทรหัส ${code}`);
      return t;
    }

    app.put('/_ops/tenants/:code/subscription', { config: { internal: true } }, async (req) => {
      const { code } = req.params as { code: string };
      const b = parse(SubscriptionChange, req.body);
      const t = await tenantByCode(code);
      return k.db.tx(t.id, (c) => changeSubscription(c, b));
    });

    /* ---- back office for GO Along staff (signed in to the operator company OPS_TENANT_CODE, explicit identity.ops.* rights) ---- */

    let opsTenantId: string | null | undefined;
    /** 403 unless the caller is in the operator company and holds `perm` by name (wildcards never grant `*.ops.*`). */
    async function requireOps(a: AuthContext, perm: 'identity.ops.read' | 'identity.ops.write'): Promise<void> {
      const code = k.env.OPS_TENANT_CODE;
      if (opsTenantId === undefined || (opsTenantId === null && code)) {
        opsTenantId = code ? ((await k.db.pool.query<{ id: string }>('select id from tenants where code = $1', [code.toLowerCase()])).rows[0]?.id ?? null) : null;
      }
      if (!opsTenantId || a.tenantId !== opsTenantId) throw forbidden('เฉพาะทีม GO Along (หลังบ้าน)');
      requirePerm(a, perm);
    }

    app.get('/ops/tenants', async (req) => {
      const a = auth(req);
      await requireOps(a, 'identity.ops.read');
      return listCompanies(String((req.query as { q?: string }).q ?? ''));
    });

    /** One company for the back office: plan, company profile (tax invoice details), users, payments and the plan log. */
    app.get('/ops/tenants/:code', async (req) => {
      const a = auth(req);
      await requireOps(a, 'identity.ops.read');
      const t = await tenantByCode((req.params as { code: string }).code);
      return k.db.tx(t.id, async (c) => {
        const row = await subscriptionRow(c);
        const view = row ? subscriptionView(entitlementOf(row)) : null;
        const profile = (await c.query(`select ${companyCols} from company_profiles`)).rows[0];
        const users = Number((await c.query<{ n: string }>('select count(*) as n from users where active')).rows[0].n);
        const owner = (await c.query<{ email: string; name: string }>(
          `select u.email, u.name from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
            where r.permissions @> '{*}' and u.active order by u.created_at limit 1`)).rows[0];
        return {
          code: t.code, name: t.name, subscription: view,
          plan_text: view ? `${view.planName} · ${view.priceMonthly.toLocaleString('en-US')} บาท/เดือน` : 'ไม่จำกัดแพ็กเกจ (ติดตั้งเอง)',
          status_text: view ? (view.blocked ?? (view.daysLeft === null ? view.statusTh : `${view.statusTh} · เหลือ ${view.daysLeft} วัน`)) : '—',
          paid_through: row?.paid_through ?? null, usable_until: view?.usableUntil ?? null,
          users_text: view ? `${users} / ${view.maxUsers} คน` : `${users} คน`,
          owner_text: owner ? `${owner.name} · ${owner.email}` : '—',
          legal_name: profile?.legal_name ?? t.name, tax_id: profile?.tax_id ?? null, address: profile?.address ?? null,
          invoice_ready: !!profile?.tax_id,
          payments: (await c.query(
            `select paid_on, months, amount, period_from, period_to, plan, ref, by_name from tenant_payments order by paid_on desc, created_at desc limit 100`)).rows
            .map((p) => ({ ...p, plan: PLANS[p.plan as PlanId]?.nameTh ?? p.plan })),
          log: (await c.query<{ created_at: string; by_name: string; change: Record<string, unknown> }>(
            `select created_at, by_name, change from tenant_subscription_log order by created_at desc, id desc limit 100`)).rows
            .map((l) => ({ created_at: l.created_at, by_name: l.by_name, change: changeText(l.change) })),
        };
      });
    });

    /**
     * Bank transfer received: extends `paid_through` by `months` (from the day after the current paid period, or today when it has
     * lapsed — see `paymentPeriod`), sets the company active (optionally on another plan), records the payment, and publishes
     * `identity.subscription_paid` in the OPERATOR company so its sales module drafts the tax-invoice order.
     */
    app.post('/ops/tenants/:code/payments', async (req, reply) => {
      const a = auth(req);
      await requireOps(a, 'identity.ops.write');
      const b = parse(PaymentInput, req.body);
      const t = await tenantByCode((req.params as { code: string }).code);
      const by = a.userName ?? 'ทีม GO Along';
      const paidOn = b.paidOn ?? thaiToday();
      if (paidOn > thaiToday()) throw badRequest('วันที่รับโอนต้องไม่เกินวันนี้', { fieldErrors: { paidOn: ['วันที่รับโอนต้องไม่เกินวันนี้'] }, formErrors: [] });
      const paid = await k.db.tx(t.id, async (c) => {
        const row = await subscriptionRow(c);
        if (!row && !b.plan) throw badRequest('บริษัทนี้ยังไม่มีแพ็กเกจ — เลือกแพ็กเกจ', { fieldErrors: { plan: ['เลือกแพ็กเกจ'] }, formErrors: [] });
        const plan = PLANS[(b.plan ?? row!.plan) as PlanId];
        const period = paymentPeriod(row?.status === 'active' ? row.paid_through : null, thaiToday(), b.months);
        const amount = b.amount ?? plan.priceMonthly * b.months;
        const pay = (await c.query<{ id: string }>(
          `insert into tenant_payments (plan, months, amount, paid_on, period_from, period_to, ref, note, by_name)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
          [plan.id, b.months, amount, paidOn, period.from, period.to, b.ref ?? null, b.note ?? null, by])).rows[0];
        const result = await changeSubscription(c, {
          plan: plan.id, status: 'active', paidThrough: period.to, by,
          note: `รับโอน ${amount.toLocaleString('en-US')} บาท (${b.months} เดือน) ${formatThaiDate(paidOn)}${b.ref ? ` อ้างอิง ${b.ref}` : ''}`,
        });
        const profile = (await c.query(`select legal_name, tax_id, branch_code, branch_label, address, email from company_profiles`)).rows[0];
        return { paymentId: pay.id, plan, period, amount, result, profile };
      });
      // the tax invoice is GO Along's own document: drafted by the operator company's sales module
      await k.db.tx(opsTenantId!, (c) => k.emit(c, 'identity.subscription_paid', {
        paymentId: paid.paymentId, tenantCode: t.code, companyName: paid.profile?.legal_name || t.name, taxId: paid.profile?.tax_id ?? null,
        branch: paid.profile?.tax_id ? (paid.profile.branch_label || branchText(paid.profile.branch_code ?? '00000')) : null,
        address: paid.profile?.address ?? null, email: paid.profile?.email ?? null, plan: paid.plan.id, planName: paid.plan.nameTh,
        months: b.months, amount: paid.amount, paidOn, periodFrom: paid.period.from, periodTo: paid.period.to, ref: b.ref ?? null,
      }));
      reply.code(201);
      return {
        ...paid.result, periodFrom: paid.period.from, periodTo: paid.period.to,
        message: `บันทึกรับโอนแล้ว — ${t.name} ใช้งาน ${paid.plan.nameTh} ถึง ${formatThaiDate(paid.period.to)} · ร่างใบสั่งขายสำหรับออกใบกำกับภาษีอยู่ในโมดูลขาย`,
      };
    });

    /** Change plan / status / trial length / user limit from the back office (reason required, logged). */
    app.post('/ops/tenants/:code/plan', async (req) => {
      const a = auth(req);
      await requireOps(a, 'identity.ops.write');
      const b = parse(OpsPlanInput, req.body);
      const t = await tenantByCode((req.params as { code: string }).code);
      const out = await k.db.tx(t.id, (c) => changeSubscription(c, { ...b, by: a.userName ?? 'ทีม GO Along' }));
      return { ...out, message: `${t.name}: ${out.subscription?.planName ?? ''} · ${out.subscription?.statusTh ?? ''}${out.revokedUsers ? ` — ผู้ใช้ ${out.revokedUsers} คนต้องเข้าสู่ระบบใหม่` : ''}` };
    });

    /**
     * Bootstrap (internal token, `pnpm erp plan grant-ops <email>`): give a user of the operator company the back-office role
     * (identity.ops.read + write, by name). Nobody can grant these rights from the app without holding them already.
     */
    app.post('/_ops/operators', { config: { internal: true } }, async (req) => {
      const { email: mail } = parse(z.object({ email }), req.body);
      const code = k.env.OPS_TENANT_CODE;
      if (!code) throw badRequest('ยังไม่ได้ตั้ง OPS_TENANT_CODE (รหัสบริษัท GO Along)');
      const t = await tenantByCode(code);
      return k.db.tx(t.id, async (c) => {
        const u = (await c.query<{ id: string; name: string }>('select id, name from users where email = $1 and active', [mail])).rows[0];
        if (!u) throw new HttpError(404, 'not_found', `ไม่พบผู้ใช้ ${mail} ในบริษัท ${code}`);
        const role = (await c.query<{ id: string }>(
          `insert into roles (name, permissions) values ('หลังบ้าน GO Along', '{identity.ops.read,identity.ops.write}')
           on conflict (tenant_id, name) do update set permissions = excluded.permissions returning id`)).rows[0];
        await c.query('insert into user_roles (user_id, role_id) values ($1, $2) on conflict do nothing', [u.id, role.id]);
        await revokeTokens(k, c, u.id, 'roles_changed');
        return { ok: true, message: `${u.name} ได้สิทธิ์หลังบ้าน GO Along แล้ว — เข้าสู่ระบบใหม่เพื่อเห็นเมนู` };
      });
    });

    /** A company's plan history (newest first). */
    app.get('/_ops/tenants/:code/subscription-log', { config: { internal: true } }, async (req) => {
      const { code } = req.params as { code: string };
      const t = (await k.db.pool.query<{ id: string }>('select id from tenants where code = $1', [code.toLowerCase()])).rows[0];
      if (!t) throw new HttpError(404, 'not_found', `ไม่พบบริษัทรหัส ${code}`);
      return k.db.tx(t.id, async (c) => (await c.query('select change, by_name, created_at from tenant_subscription_log order by created_at desc, id desc limit 200')).rows);
    });

    /** Log out everywhere: every token of the signed-in user issued up to now stops working in every module (SEC-07). */
    app.post('/logout', async (req) => {
      const a = auth(req);
      return k.db.tx(a.tenantId, async (c) => {
        const before = await revokeTokens(k, c, a.userId, 'logout');
        return { ok: true, revokedBefore: before, message: 'ออกจากระบบทุกอุปกรณ์แล้ว' };
      });
    });

    /**
     * Change own password: the current one must be right (wrong → 400 on `currentPassword`, counted like a wrong login), then every
     * older token is revoked and a fresh token is returned (body `token` + header `x-erp-session-token`, which the web app picks up).
     */
    app.post('/me/password', async (req, reply) => {
      const a = auth(req);
      const b = parse(PasswordChangeInput, req.body);
      const key = `me|${a.tenantId}|${a.userId}`;
      if ((await attempts(k.db.pool, key)) >= LOGIN_MAX_FAILURES) throw new HttpError(429, 'too_many_attempts', TOO_MANY);
      // the wrong-password count must survive the rollback, and taking a pool connection inside the transaction can deadlock:
      // check the current password first, outside any transaction
      const current = await k.db.tx(a.tenantId, async (c) => (await c.query<{ password_hash: string }>('select password_hash from users where id = $1 and active', [a.userId])).rows[0]);
      if (!current) throw unauthorized('บัญชีนี้ถูกปิดใช้งาน');
      if (!verifyPassword(b.currentPassword, current.password_hash)) {
        await noteAttempts(k.db.pool, [key]);
        throw badRequest('รหัสผ่านปัจจุบันไม่ถูกต้อง', { fieldErrors: { currentPassword: ['รหัสผ่านปัจจุบันไม่ถูกต้อง'] }, formErrors: [] });
      }
      const out = await k.db.tx(a.tenantId, async (c) => {
        const u = (await c.query('select id, name, password_hash from users where id = $1 and active', [a.userId])).rows[0];
        if (!u) throw unauthorized('บัญชีนี้ถูกปิดใช้งาน');
        // the password changed between the check and this transaction (another device): check again, without counting
        if (!verifyPassword(b.currentPassword, u.password_hash)) throw badRequest('รหัสผ่านปัจจุบันไม่ถูกต้อง', { fieldErrors: { currentPassword: ['รหัสผ่านปัจจุบันไม่ถูกต้อง'] }, formErrors: [] });
        if (b.newPassword === b.currentPassword) {
          throw badRequest('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม', { fieldErrors: { newPassword: ['รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม'] }, formErrors: [] });
        }
        await c.query('update users set password_hash = $2 where id = $1', [a.userId, hashPassword(b.newPassword)]);
        const before = await revokeTokens(k, c, a.userId, 'password_changed');
        const perms = await permissionsOf(c, a.userId);
        const plan = await entitlement(c);
        requireOpen(plan);
        return { before, life: tokenTtl(ttl, plan), token: signToken(secret, { tenantId: a.tenantId, userId: a.userId, perms, userName: u.name, ...(plan ? { modules: plan.modules } : {}) }, tokenTtl(ttl, plan), { iat: before }) };
      });
      await clearAttempts(k.db.pool, key);
      reply.header('x-erp-session-token', out.token);
      return { ok: true, message: 'เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะต้องเข้าสู่ระบบใหม่', token: out.token, expiresIn: out.life, revokedBefore: out.before };
    });

    /** Seller details for letterheads and tax invoices. Any signed-in user may read them (they print documents). */
    app.get('/company', async (req) => {
      const a = auth(req);
      return k.db.tx(a.tenantId, async (c) => {
        const row = (await c.query(`select ${companyCols} from company_profiles`)).rows[0];
        if (row) return companyView(row);
        // not set up yet: the company name from provisioning, everything else empty
        const t = (await c.query<{ name: string }>('select name from tenants where id = $1', [a.tenantId])).rows[0];
        return {
          configured: false, legal_name: t?.name ?? '', name_en: null, branch_code: '00000', branch_label: null, branch_text: branchText('00000'),
          address: null, tax_id: null, tax_id_text: null, phone: null, email: null, website: null, logo: null, footer_note: null, signature_labels: [], updated_at: null,
        };
      });
    });

    app.put('/company', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.company.write');
      const b = parse(CompanyInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const row = (await c.query(
          `insert into company_profiles (legal_name, name_en, branch_code, branch_label, address, tax_id, phone, email, website, logo, footer_note, signature_labels, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           on conflict (tenant_id) do update set legal_name = excluded.legal_name, name_en = excluded.name_en, branch_code = excluded.branch_code,
             branch_label = excluded.branch_label, address = excluded.address, tax_id = excluded.tax_id, phone = excluded.phone, email = excluded.email,
             website = excluded.website, logo = excluded.logo, footer_note = excluded.footer_note, signature_labels = excluded.signature_labels,
             updated_by = excluded.updated_by, updated_at = now()
           returning ${companyCols}`,
          [b.legalName, b.nameEn ?? null, b.branchCode, b.branchLabel ?? null, b.address, b.taxId ?? null, b.phone ?? null, b.email ?? null,
            b.website ?? null, b.logo ?? null, b.footerNote ?? null, b.signatureLabels ?? [], a.userId],
        )).rows[0];
        return companyView(row);
      });
    });

    /**
     * People picker for every signed-in user (approver → delegate, contract technician, ticket assignee, asset custodian…):
     * active users' id, name and work e-mail only — no roles, no admin data. `/users` stays behind identity.user.read (bugs-0.4 ID-04).
     */
    app.get('/users/directory', async (req) => {
      const a = auth(req);
      const q = parse(z.object({ q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
      const like = q.q ? `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select id, name, email from users where active and ($1::text is null or name ilike $1 or email ilike $1) order by name limit $2`, [like, q.limit])).rows);
    });

    app.get('/users', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.read');
      return k.db.tx(a.tenantId, async (c) =>
        (await c.query(`select ${publicUser.split(', ').map((f) => 'u.' + f).join(', ')},
          coalesce(array_agg(r.name order by r.name) filter (where r.id is not null), '{}') as roles
          from users u left join user_roles ur on ur.user_id = u.id left join roles r on r.id = ur.role_id
          group by u.id order by u.email`)).rows);
    });

    /** One user (detail screen): roles by name + id, and when their sessions were last revoked. */
    app.get('/users/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.read');
      const { id } = parse(z.object({ id: s.uuid }), req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const u = await one(c, `select ${publicUser} from users where id = $1`, [id], 'User');
        const roles = (await c.query<{ id: string; name: string }>(
          'select r.id, r.name from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1 order by r.name', [id])).rows;
        const rev = (await c.query('select before, reason, updated_at from _revoked_tokens where user_id = $1', [id])).rows[0];
        return {
          ...u, roles: roles.map((r) => r.name), roleIds: roles.map((r) => r.id), permissions: await permissionsOf(c, id),
          sessions_revoked_at: rev ? rev.updated_at : null, sessions_revoked_reason: rev ? REVOKE_REASON_TH[rev.reason as RevokeReason] ?? rev.reason : null,
        };
      });
    });

    app.post('/users', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.write');
      const body = parse(UserInput, req.body);
      await requireEmailFree(k, body.email);
      const user = await k.db.tx(a.tenantId, async (c) => {
        await requireUserSeat(c);
        requireGrantable(a, await permissionsOfRoles(c, body.roleIds), 'กำหนดบทบาทไม่ได้');
        const u = (await c.query(`insert into users (email, name, password_hash) values ($1, $2, $3) returning ${publicUser}`, [body.email, body.name, hashPassword(body.password)])).rows[0];
        for (const roleId of body.roleIds) await c.query('insert into user_roles (user_id, role_id) values ($1, $2)', [u.id, roleId]);
        return u;
      }).catch(emailTakenOnRace);
      reply.code(201);
      return user;
    });

    app.put('/users/:id/roles', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.write');
      const { id } = parse(z.object({ id: s.uuid }), req.params);
      const { roleIds } = parse(z.object({ roleIds: z.array(s.uuid) }), req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from users where id = $1', [id], 'User');
        requireGrantable(a, await permissionsOf(c, id), 'แก้บทบาทของผู้ใช้ที่มีสิทธิ์มากกว่าคุณไม่ได้');
        requireGrantable(a, await permissionsOfRoles(c, roleIds), 'กำหนดบทบาทไม่ได้');
        await c.query('delete from user_roles where user_id = $1', [id]);
        for (const roleId of roleIds) await c.query('insert into user_roles (user_id, role_id) values ($1, $2)', [id, roleId]);
        // old tokens still carry the old permissions: refuse them so the change applies now, not at the next login (SEC-07)
        await revokeTokens(k, c, id, 'roles_changed');
        return { userId: id, permissions: await permissionsOf(c, id), message: 'บันทึกบทบาทแล้ว ผู้ใช้ต้องเข้าสู่ระบบใหม่เพื่อใช้สิทธิ์ใหม่' };
      });
    });

    app.post('/users/:id/deactivate', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.write');
      const { id } = parse(z.object({ id: s.uuid }), req.params);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from users where id = $1', [id], 'User');
        requireGrantable(a, await permissionsOf(c, id), 'ปิดบัญชีผู้ใช้ที่มีสิทธิ์มากกว่าคุณไม่ได้');
        const u = await one(c, `update users set active = false where id = $1 returning ${publicUser}`, [id], 'User');
        await revokeTokens(k, c, id, 'user_disabled');
        return u;
      });
    });

    /** Admin "บังคับออกจากระบบ": every token of that user stops working now (they can log in again). */
    app.post('/users/:id/revoke-sessions', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.write');
      const { id } = parse(z.object({ id: s.uuid }), req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const u = await one(c, `select ${publicUser} from users where id = $1`, [id], 'User');
        requireGrantable(a, await permissionsOf(c, id), 'บังคับออกจากระบบผู้ใช้ที่มีสิทธิ์มากกว่าคุณไม่ได้');
        const before = await revokeTokens(k, c, id, 'admin');
        return { ...u, revokedBefore: before, message: `บังคับให้ ${u.name} ออกจากระบบทุกอุปกรณ์แล้ว` };
      });
    });

    app.get('/roles', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from roles order by name')).rows);
    });

    app.post('/roles', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'identity.role.write');
      const body = parse(RoleInput, req.body);
      requireGrantable(a, body.permissions, 'สร้างบทบาทไม่ได้');
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query('insert into roles (name, permissions) values ($1, $2) returning *', [body.name, body.permissions])).rows[0]);
    });

    /* ----- role templates (suggested Thai roles; see role-templates.ts) ----- */

    /** Installed module ids: `modules` from the client (web has /api/_catalog), else an `x-erp-modules` header a gateway may add; undefined = unknown. */
    const installed = (req: { headers: Record<string, unknown> }, fromBody?: string[]): string[] | undefined => {
      if (fromBody?.length) return fromBody;
      const h = req.headers['x-erp-modules'];
      return typeof h === 'string' && h.trim() ? h.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
    };
    const ModuleList = z.array(z.string().trim().regex(/^[a-z][a-z0-9-]*$/)).max(100);

    /** `?modules=a,b` limits each template's permissions to installed modules; `?q=` filters by name (lookup). */
    app.get('/role-templates', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.read');
      const q = parse(z.object({ q: z.string().trim().optional(), modules: z.string().optional() }), req.query);
      const mods = installed(req, q.modules ? parse(ModuleList, q.modules.split(',')) : undefined);
      const needle = q.q?.toLowerCase();
      return ROLE_TEMPLATES
        .filter((tpl) => !needle || tpl.name.toLowerCase().includes(needle) || tpl.id.includes(needle))
        .map((tpl) => {
          const { permissions, skipped } = applyTemplate(tpl, mods);
          return { id: tpl.id, name: tpl.name, description: tpl.description, permissions, permission_count: permissions.length, skipped };
        });
    });

    /** Create a role from a template, keeping only the permissions of installed modules. Name defaults to the template's (409 if taken). */
    app.post('/roles/from-template', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'identity.role.write');
      const ids = ROLE_TEMPLATES.map((tpl) => tpl.id) as [string, ...string[]];
      const body = parse(z.object({ template: z.enum(ids), name: s.name.optional(), modules: ModuleList.optional() }), req.body);
      const tpl = ROLE_TEMPLATES.find((x) => x.id === body.template)!;
      const { permissions, skipped } = applyTemplate(tpl, installed(req, body.modules));
      const name = body.name ?? tpl.name;
      requireGrantable(a, permissions, 'สร้างบทบาทไม่ได้');
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const role = (await c.query('insert into roles (name, permissions) values ($1, $2) returning *', [name, permissions])).rows[0];
        return { ...role, template: tpl.id, skipped, message: `สร้างบทบาท "${name}" แล้ว (${permissions.length} สิทธิ์)` };
      });
    });

    /* ----- "ตั้งค่าเริ่มต้น" wizard (onboarding.ts) and inviting the team ----- */

    app.get('/onboarding', async (req) => {
      const a = auth(req);
      return { onboarding: await k.db.tx(a.tenantId, onboardingOf) };
    });

    /** a step saved or skipped (`/onboarding/steps/company`) */
    app.post('/onboarding/steps/:step', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.company.write');
      const { step } = parse(z.object({ step: z.enum(ONBOARDING_STEP_IDS) }), req.params);
      return k.db.tx(a.tenantId, async (c) => {
        await markStep(c, step);
        return { onboarding: await onboardingOf(c) };
      });
    });

    app.post('/onboarding/complete', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.company.write');
      return k.db.tx(a.tenantId, async (c) => {
        await c.query('update tenant_onboarding set completed_at = coalesce(completed_at, now())');
        return { onboarding: await onboardingOf(c) };
      });
    });

    /**
     * Invite a colleague: `{ email, name, template }` → a user with the role of that template (the company's role of the same name,
     * created from the template the first time) and an e-mail with a link to set their own password (INVITE_LINK_HOURS). The admin
     * never chooses or sees the password. Counts against the plan's users; nothing is created when the mail cannot be sent.
     */
    app.post('/users/invite', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.write');
      const ids = ROLE_TEMPLATES.map((tpl) => tpl.id) as [string, ...string[]];
      const b = parse(z.object({ email, name: s.name, template: z.enum(ids), modules: ModuleList.optional() }), req.body);
      const tpl = ROLE_TEMPLATES.find((x) => x.id === b.template)!;
      await requireEmailFree(k, b.email);
      const base = appUrl(k.env, req.headers);
      const link = newLinkToken();
      const result = await k.db.tx(a.tenantId, async (c) => {
        await requireUserSeat(c);
        let role = (await c.query<{ id: string; permissions: string[] }>('select id, permissions from roles where name = $1', [tpl.name])).rows[0];
        if (!role) {
          requirePerm(a, 'identity.role.write');
          const { permissions } = applyTemplate(tpl, installed(req, b.modules));
          requireGrantable(a, permissions, 'สร้างบทบาทไม่ได้');
          role = (await c.query('insert into roles (name, permissions) values ($1, $2) returning id, permissions', [tpl.name, permissions])).rows[0];
        }
        requireGrantable(a, role!.permissions, 'ชวนด้วยบทบาทนี้ไม่ได้');
        // an unusable random password until the colleague sets their own through the link
        const u = (await c.query(`insert into users (email, name, password_hash) values ($1, $2, $3) returning ${publicUser}`, [b.email, b.name, hashPassword(randomBytes(24).toString('base64url'))])).rows[0];
        await c.query('insert into user_roles (user_id, role_id) values ($1, $2)', [u.id, role!.id]);
        await c.query(`insert into password_resets (tenant_id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + make_interval(hours => $4))`,
          [a.tenantId, u.id, link.hash, INVITE_LINK_HOURS]);
        const company = (await c.query<{ name: string }>('select name from tenants where id = $1', [a.tenantId])).rows[0]?.name ?? '';
        try {
          await mailer(buttonMail(b.email, `${a.userName ?? 'ผู้ดูแลระบบ'} ชวนคุณใช้งาน GO Along (${company})`, [
            `สวัสดีคุณ${b.name}`,
            `${a.userName ?? 'ผู้ดูแลระบบ'} เพิ่มคุณเป็นผู้ใช้ของ ${company} ในบทบาท "${tpl.name}"`,
            'กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านของคุณเอง แล้วเข้าสู่ระบบด้วยอีเมลนี้',
          ], { label: 'ตั้งรหัสผ่านและเริ่มใช้งาน', url: `${base}/reset-password?invite=1&token=${link.token}` }, `ลิงก์ใช้ได้ ${INVITE_LINK_HOURS} ชั่วโมงและครั้งเดียว`));
        } catch (e) {
          req.log.error(e);
          throw new HttpError(503, 'mail_failed', 'ส่งอีเมลเชิญไม่สำเร็จ จึงยังไม่ได้เพิ่มผู้ใช้ — ลองใหม่อีกครั้งในอีกสักครู่');
        }
        return { user: u, role: tpl.name };
      }).catch(emailTakenOnRace);
      reply.code(201);
      return { ...result, message: `ส่งอีเมลเชิญไปที่ ${b.email} แล้ว (บทบาท ${result.role}) — ลิงก์ใช้ได้ ${INVITE_LINK_HOURS} ชั่วโมง` };
    });
  },
};
