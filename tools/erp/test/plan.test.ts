import { describe, expect, it } from 'vitest';
import { planChange, runPlan } from '../src/plan.ts';

/** `pnpm erp plan set …` builds the back-office request; bad input never reaches identity. */
describe('pnpm erp plan', () => {
  it('turns flags into the subscription change', () => {
    expect(planChange({ by: 'บัญชี', status: 'active', 'paid-through': '2026-12-31', plan: 'factory' }))
      .toEqual({ by: 'บัญชี', status: 'active', paidThrough: '2026-12-31', plan: 'factory' });
    expect(planChange({ by: 'x', 'max-users': 'default', modules: 'hr, expense' })).toEqual({ by: 'x', maxUsers: null, modules: ['hr', 'expense'] });
    expect(planChange({ by: 'x', 'trial-days': '7' })).toEqual({ by: 'x', trialDays: 7 });
  });

  it('refuses incomplete or wrong input', () => {
    expect(() => planChange({ status: 'active' })).toThrow('--by');
    expect(() => planChange({ by: 'x' })).toThrow('nothing to change');
    expect(() => planChange({ by: 'x', 'paid-through': '31/12/2569' })).toThrow('YYYY-MM-DD');
    expect(() => planChange({ by: 'x', 'max-users': '-1' })).toThrow('whole number');
  });

  it('needs the identity URL and internal token', async () => {
    await expect(runPlan(['list'], {}, {})).rejects.toThrow('IDENTITY_URL');
  });
});
