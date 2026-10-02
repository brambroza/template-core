import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

describe('maintenance', () => {
  let press: any;

  it('registers machines and looks them up by QR code', async () => {
    press = (await t.api('POST', '/machines', { code: 'PRESS-01', name: 'เครื่องปั๊ม 80 ตัน', location: 'Line 1' })).body;
    expect(press.status).toBe('running');
    const scan = await t.api('GET', '/machines/by-code/PRESS-01');
    expect(scan.body).toMatchObject({ id: press.id, openWorkOrders: [] });
  });

  it('runs a breakdown: machine down -> repaired with parts -> running', async () => {
    const operator = t.token(['maintenance.wo.report']);
    const wo = await t.api('POST', '/work-orders', { machineId: press.id, title: 'น้ำมันรั่ว' }, { token: operator });
    expect(wo.status).toBe(201);
    expect((await t.api('GET', '/machines?status=down')).body).toHaveLength(1);
    expect((await t.api('POST', `/work-orders/${wo.body.id}/start`, undefined, { token: operator })).status).toBe(403);
    await t.api('POST', `/work-orders/${wo.body.id}/start`);
    const bolt = { itemId: randomUUID(), itemCode: 'SP-SEAL', qty: 2 };
    const done = await t.api('POST', `/work-orders/${wo.body.id}/complete`, { resolution: 'เปลี่ยนซีล', downtimeMinutes: 90, warehouseCode: 'SPARE', parts: [bolt] });
    expect(done.body).toMatchObject({ status: 'done', downtime_minutes: 90, parts: [{ item_code: 'SP-SEAL', qty: 2 }] });
    expect((await t.api('GET', '/machines/by-code/PRESS-01')).body.status).toBe('running');
    const ev = await t.published('maintenance.parts_used');
    expect(ev[0].data).toMatchObject({ machineCode: 'PRESS-01', warehouseCode: 'SPARE', parts: [{ itemCode: 'SP-SEAL', qty: 2 }] });
    expect((await t.published('maintenance.breakdown_reported'))[0].data).toMatchObject({ machineCode: 'PRESS-01', title: 'น้ำมันรั่ว' });
    expect((await t.published('maintenance.work_completed'))[0].data).toMatchObject({ kind: 'breakdown', downtimeMinutes: 90 });
    const hist = await t.api('GET', `/machines/${press.id}/history`);
    expect(hist.body).toMatchObject({ totalDowntimeMinutes: 90, breakdowns: 1 });
  });

  it('generates PM work orders once per due date and reschedules on completion', async () => {
    const plan = (await t.api('POST', '/pm-plans', { machineId: press.id, title: 'เปลี่ยนน้ำมันไฮดรอลิก', intervalDays: 30, firstDueOn: '2026-10-01' })).body;
    expect((await t.api('POST', '/pm-plans/generate', { asOf: '2026-09-30' })).body.created).toHaveLength(0);
    const gen = await t.api('POST', '/pm-plans/generate', { asOf: '2026-10-02' });
    expect(gen.body.created).toHaveLength(1);
    expect((await t.api('POST', '/pm-plans/generate', { asOf: '2026-10-02' })).body.created).toHaveLength(0);
    await t.api('POST', `/work-orders/${gen.body.created[0].id}/complete`, { resolution: 'ทำแล้ว', doneOn: '2026-10-03' });
    const plans = await t.api('GET', '/pm-plans');
    expect(plans.body.find((p: any) => p.id === plan.id)).toMatchObject({ last_done_on: '2026-10-03', next_due_on: '2026-11-02' });
    expect((await t.published('maintenance.parts_used'))).toHaveLength(1); // PM without parts publishes nothing
    const sum = await t.api('GET', '/summary');
    expect(sum.body).toMatchObject({ running: 1, down: 0, openWorkOrders: 0, downtimeMonth: 90 });
    expect(sum.body.machines[0]).toMatchObject({ code: 'PRESS-01', status: 'running', open_work_orders: 0 });
  });
});
