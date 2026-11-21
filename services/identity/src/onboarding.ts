/**
 * "ตั้งค่าเริ่มต้น" — the 5-step wizard a new cloud company sees after sign-up (web /setup). Identity only remembers which steps
 * are done; each step saves through the module that owns the setting (company profile here, purchasing's approval rule,
 * users and roles here, imports in master-data).
 */
import type { Client } from '@erp/kernel';

export const ONBOARDING_STEPS = [
  { id: 'company', title: 'ข้อมูลบริษัท', hint: 'ชื่อนิติบุคคล เลขผู้เสียภาษี ที่อยู่ และโลโก้ ที่จะพิมพ์บนเอกสาร' },
  { id: 'approvals', title: 'วิธีอนุมัติ', hint: 'ทำงานคนเดียว หรือมีคนอนุมัติแยกจากคนสร้างเอกสาร' },
  { id: 'team', title: 'ชวนทีมงาน', hint: 'ส่งอีเมลเชิญ พร้อมบทบาทตามหน้าที่' },
  { id: 'data', title: 'ข้อมูลตั้งต้น', hint: 'นำเข้าสินค้าและคู่ค้าจากไฟล์ หรือเริ่มจากข้อมูลตัวอย่าง' },
  { id: 'start', title: 'เริ่มใช้งาน', hint: 'สรุปสิ่งที่ตั้งไว้ และเรื่องแรกที่ควรลอง' },
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]['id'];
export const ONBOARDING_STEP_IDS = ONBOARDING_STEPS.map((s) => s.id) as [OnboardingStep, ...OnboardingStep[]];

/** The wizard's state for the apps, or null when this company has no wizard (self-hosted, provisioned without a plan). */
export async function onboardingOf(c: Client) {
  const row = (await c.query<{ done: string[]; completed_at: string | null }>('select done, completed_at from tenant_onboarding')).rows[0];
  if (!row) return null;
  const steps = ONBOARDING_STEPS.map((s) => ({ ...s, done: row.done.includes(s.id) }));
  return { steps, doneCount: steps.filter((s) => s.done).length, completed: !!row.completed_at };
}

/** Mark a step done (idempotent). */
export async function markStep(c: Client, step: OnboardingStep): Promise<void> {
  await c.query(`update tenant_onboarding set done = array_append(done, $1) where not ($1 = any(done))`, [step]);
}
