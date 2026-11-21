/**
 * `pnpm erp plan …` — GO Along back office for cloud plans, talking to identity's internal /_ops routes.
 * Needs IDENTITY_URL (e.g. http://localhost:4001 or http://identity:3000 inside the compose network) and INTERNAL_TOKEN.
 *
 *   plan list [--q text]
 *   plan set <code> --by "ชื่อผู้ทำรายการ" [--plan starter|factory|business] [--status trial|active|suspended|cancelled]
 *            [--paid-through YYYY-MM-DD] [--trial-days N] [--max-users N|default] [--modules a,b|default] [--note "…"]
 *   plan log <code>
 */

/** Request body for PUT /_ops/tenants/:code/subscription from CLI flags. Throws on unusable input (no request is sent). */
export function planChange(flags: Record<string, string>): Record<string, unknown> {
  if (!flags.by || flags.by === 'true') throw new Error('--by "ชื่อผู้ทำรายการ" is required (it goes into the plan log)');
  const body: Record<string, unknown> = { by: flags.by };
  if (flags.plan) body.plan = flags.plan;
  if (flags.status) body.status = flags.status;
  if (flags['paid-through']) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(flags['paid-through'])) throw new Error('--paid-through must be YYYY-MM-DD (ค.ศ.)');
    body.paidThrough = flags['paid-through'];
  }
  if (flags['trial-days']) body.trialDays = int(flags['trial-days'], '--trial-days');
  if (flags['max-users']) body.maxUsers = flags['max-users'] === 'default' ? null : int(flags['max-users'], '--max-users');
  if (flags.modules) body.modules = flags.modules === 'default' ? null : flags.modules.split(',').map((m) => m.trim()).filter(Boolean);
  if (flags.note) body.note = flags.note;
  if (Object.keys(body).length === 1) throw new Error('nothing to change: give --plan, --status, --paid-through, --trial-days, --max-users or --modules');
  return body;
}

function int(v: string, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number`);
  return n;
}

/** Run one `plan` sub-command against identity; prints a short Thai/English summary. */
export async function runPlan(args: string[], flags: Record<string, string>, env = process.env, log = console.log): Promise<void> {
  const base = env.IDENTITY_URL;
  const token = env.INTERNAL_TOKEN;
  if (!base || !token) throw new Error('set IDENTITY_URL and INTERNAL_TOKEN (same token the services use)');
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
      method, headers: { 'x-internal-token': token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status} ${(json as { error?: { message?: string } }).error?.message ?? res.statusText}`);
    return json as any;
  };
  const [sub, code] = args;
  if (sub === 'list') {
    const rows = await call('GET', `/_ops/tenants${flags.q ? `?q=${encodeURIComponent(flags.q)}` : ''}`);
    for (const r of rows) {
      const s = r.subscription;
      const state = s ? `${s.planName.padEnd(9)} ${s.statusTh.padEnd(14)} ${s.daysLeft === null ? '' : `เหลือ ${s.daysLeft} วัน`}${s.blocked ? ' (ปิดอยู่)' : ''}` : 'ไม่จำกัดแพ็กเกจ';
      log(`${r.code.padEnd(24)} ${String(r.activeUsers).padStart(4)} ผู้ใช้  ${state}  ${r.name}`);
    }
    log(`${rows.length} บริษัท`);
    return;
  }
  if (sub === 'set') {
    if (!code) throw new Error('plan set <company code> …');
    const r = await call('PUT', `/_ops/tenants/${encodeURIComponent(code)}/subscription`, planChange(flags));
    const s = r.subscription;
    log(`${code}: ${s.planName} · ${s.statusTh}${s.daysLeft === null ? '' : ` · เหลือ ${s.daysLeft} วัน`}${s.blocked ? ` · ปิดอยู่: ${s.blocked}` : ''}`);
    if (r.revokedUsers) log(`ผู้ใช้ ${r.revokedUsers} คนต้องเข้าสู่ระบบใหม่ (รายการโมดูลเปลี่ยน)`);
    return;
  }
  if (sub === 'log') {
    if (!code) throw new Error('plan log <company code>');
    for (const r of await call('GET', `/_ops/tenants/${encodeURIComponent(code)}/subscription-log`)) log(`${r.created_at}  ${r.by_name ?? ''}  ${JSON.stringify(r.change)}`);
    return;
  }
  throw new Error('plan list | plan set <code> … | plan log <code>');
}
