import { describe, expect, it } from 'vitest';
import { planNotice } from '../src/index.ts';

/** Plan banner text (web Shell and mobile home): trial countdown and payment reminder only. */
describe('planNotice', () => {
  const p = (status: 'trial' | 'active' | 'suspended' | 'cancelled', daysLeft: number | null) => ({ planName: 'Factory', status, daysLeft, blocked: null });

  it('counts down the trial, urgent in the last 3 days', () => {
    expect(planNotice(p('trial', 10))).toEqual({ text: 'ทดลองใช้แพ็กเกจ Factory เหลือ 10 วัน', urgent: false });
    expect(planNotice(p('trial', 2))?.urgent).toBe(true);
    expect(planNotice(p('trial', 0))?.text).toBe('ทดลองใช้แพ็กเกจ Factory วันสุดท้าย');
  });

  it('reminds paid companies only in the last week', () => {
    expect(planNotice(p('active', 20))).toBeNull();
    expect(planNotice(p('active', 5))).toEqual({ text: 'ใกล้ครบกำหนดชำระค่าบริการ — ใช้งานได้อีก 5 วัน', urgent: false });
  });

  it('nothing for self-hosted or open-ended plans', () => {
    expect(planNotice(null)).toBeNull();
    expect(planNotice(p('active', null))).toBeNull();
  });
});
