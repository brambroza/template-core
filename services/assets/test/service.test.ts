import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';
import { bookValueAt, schedule } from '../src/depreciation.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const isoIn = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('depreciation math', () => {
  const pc = { cost: 36000, salvage_value: 0, useful_life_years: 3, method: 'straight_line', purchase_date: '2026-01-15' };

  it('spreads cost − salvage evenly from the purchase month, recognised at month end', () => {
    const rows = schedule(pc);
    expect(rows).toHaveLength(36);
    expect(rows[0]).toEqual({ period: '2026-01', depreciation: 1000, accumulated: 1000, book_value: 35000 });
    expect(rows[35]).toMatchObject({ period: '2028-12', accumulated: 36000, book_value: 0 });
    expect(bookValueAt(pc, '2026-06-30')).toEqual({ accumulated: 6000, book_value: 30000 });
    expect(bookValueAt(pc, '2026-06-15')).toEqual({ accumulated: 5000, book_value: 31000 });
    expect(bookValueAt(pc, '2025-12-31')).toEqual({ accumulated: 0, book_value: 36000 });
    expect(bookValueAt(pc, '2030-01-01').book_value).toBe(0);
  });

  it('puts the rounding difference in the last month and respects salvage value and method none', () => {
    const rows = schedule({ ...pc, cost: 10000 });
    expect(rows[0].depreciation).toBe(277.78);
    expect(rows[35].depreciation).toBe(277.7);
    expect(rows[35].accumulated).toBe(10000);
    expect(schedule({ ...pc, salvage_value: 6000 }).at(-1)).toMatchObject({ accumulated: 30000, book_value: 6000 });
    expect(schedule({ ...pc, method: 'none' })).toEqual([]);
    expect(schedule({ ...pc, disposed_on: '2026-03-02' })).toHaveLength(3);
  });
});

describe('assets', () => {
  let comp: any;
  let land: any;
  let laptop: any;

  it('creates categories (code unique) and validates input', async () => {
    const r = await t.api('POST', '/categories', { code: 'COMP', name: 'คอมพิวเตอร์', usefulLifeYears: 3 });
    expect(r.status).toBe(201);
    comp = r.body;
    expect(comp).toMatchObject({ method: 'straight_line', salvage_pct: 0 });
    land = (await t.api('POST', '/categories', { code: 'LAND', name: 'ที่ดิน', usefulLifeYears: 0, method: 'none' })).body;
    expect((await t.api('POST', '/categories', { code: 'COMP', name: 'ซ้ำ' })).status).toBe(409);
    expect((await t.api('POST', '/categories', { code: 'X', name: 'x', method: 'double' })).status).toBe(400);
    expect((await t.api('PATCH', `/categories/${comp.id}`, { salvagePct: 10 })).body.salvage_pct).toBe(10);
    expect((await t.api('POST', '/assets', { name: 'x', categoryId: comp.id, purchaseDate: '2026-01-01', cost: -5 })).status).toBe(400);
    expect((await t.api('POST', '/assets', { name: 'x', categoryId: comp.id, purchaseDate: '01/01/2026', cost: 5 })).status).toBe(400);
    expect((await t.api('POST', '/assets', { name: 'x', categoryId: comp.id, purchaseDate: '2026-01-01', cost: 5, salvageValue: 9 })).status).toBe(400);
  });

  it('registers assets with AS numbers, salvage from category %, custodian and QR lookup', async () => {
    const custodianId = randomUUID();
    const r = await t.api('POST', '/assets', {
      name: 'Notebook Dell Latitude', categoryId: comp.id, serialNo: 'SN-123', brand: 'Dell', model: 'Latitude 5440', location: 'สำนักงาน ชั้น 2',
      purchaseDate: '2026-01-15', cost: 40000, supplierName: 'IT City', warrantyUntil: isoIn(10), custodianId, custodianName: 'สมชาย',
    });
    expect(r.status).toBe(201);
    laptop = r.body;
    expect(laptop.code).toMatch(/^AS-2569-\d{4}$/);
    expect(laptop).toMatchObject({ status: 'in_use', salvage_value: 4000, useful_life_years: 3, monthly_depreciation: 1000, custodian_name: 'สมชาย', warranty_active: true });
    expect(laptop.assignments).toHaveLength(1);
    const scan = await t.api('GET', `/assets/by-code/${laptop.code}`);
    expect(scan.body).toMatchObject({ id: laptop.id, category_code: 'COMP' });
    const plot = (await t.api('POST', '/assets', { code: 'LAND-01', name: 'ที่ดินโรงงาน', categoryId: land.id, location: 'โรงงาน', purchaseDate: '2020-05-01', cost: 5000000 })).body;
    expect(plot).toMatchObject({ code: 'LAND-01', status: 'in_storage', book_value: 5000000, monthly_depreciation: 0 });
    expect((await t.api('POST', '/assets', { code: 'LAND-01', name: 'dup', categoryId: land.id, purchaseDate: '2020-05-01', cost: 1 })).status).toBe(409);
    expect((await t.api('GET', '/assets?q=latitude')).body).toHaveLength(1);
    expect((await t.api('GET', '/assets?warrantyExpiring=true')).body.map((a: any) => a.id)).toEqual([laptop.id]);
  });

  it('gives a monthly schedule and a monthly depreciation report by category', async () => {
    const sch = await t.api('GET', `/assets/${laptop.id}/schedule?asOf=2026-06-30`);
    expect(sch.body).toMatchObject({ monthly_depreciation: 1000, accumulated: 6000, book_value: 34000 });
    expect(sch.body.rows).toHaveLength(36);
    const rep = await t.api('GET', '/depreciation?month=2026-03');
    expect(rep.body.rows.find((r: any) => r.id === laptop.id)).toMatchObject({ depreciation: 1000, accumulated: 3000, book_value: 37000 });
    expect(rep.body.byCategory.find((c: any) => c.category_code === 'COMP')).toMatchObject({ count: 1, depreciation: 1000 });
    expect(rep.body.totals).toMatchObject({ depreciation: 1000, cost: 5040000 });
    expect((await t.api('GET', '/depreciation?month=2025-12')).body.rows.map((r: any) => r.code)).toEqual(['LAND-01']);
    expect((await t.api('GET', '/depreciation?month=2026-13')).status).toBe(400);
  });

  it('transfers custodian/location and keeps the history', async () => {
    const r = await t.api('POST', `/assets/${laptop.id}/assign`, { custodianId: randomUUID(), custodianName: 'สมหญิง', location: 'ฝ่ายบัญชี', assignedOn: '2026-05-01', note: 'ย้ายแผนก' });
    expect(r.body).toMatchObject({ custodian_name: 'สมหญิง', location: 'ฝ่ายบัญชี', status: 'in_use' });
    expect(r.body.assignments).toHaveLength(2);
    const back = await t.api('POST', `/assets/${laptop.id}/assign`, { note: 'คืนของ' });
    expect(back.body).toMatchObject({ custodian_name: null, location: 'ฝ่ายบัญชี', status: 'in_storage' });
    expect((await t.api('GET', '/locations')).body).toEqual(expect.arrayContaining([{ location: 'ฝ่ายบัญชี', asset_count: 1 }]));
  });

  it('logs repairs: open repair puts the asset in repair, completing restores it', async () => {
    const repairer = t.token(['assets.asset.read', 'assets.repair.report']);
    const r = await t.api('POST', '/repairs', { assetId: laptop.id, description: 'จอไม่ติด', vendor: 'Dell Service' }, { token: repairer });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'in_repair', open_repairs: 1 });
    expect((await t.api('GET', '/summary')).body.inRepair).toBe(1);
    const open = (await t.api('GET', '/repairs?status=open')).body;
    expect(open).toHaveLength(1);
    const done = await t.api('POST', `/repairs/${open[0].id}/complete`, { cost: 2500, completedOn: '2026-07-01' }, { token: repairer });
    expect(done.body).toMatchObject({ status: 'done', cost: 2500, asset_status: 'in_storage' });
    expect((await t.api('POST', `/repairs/${open[0].id}/complete`, {}, { token: repairer })).status).toBe(409);
    const logged = await t.api('POST', `/assets/${laptop.id}/repairs`, { description: 'เปลี่ยนแบต', cost: 1800, completed: true, repairDate: '2026-08-01' }, { token: repairer });
    expect(logged.body).toMatchObject({ status: 'in_storage', repair_cost_total: 4300, open_repairs: 0 });
    expect((await t.api('POST', `/assets/${laptop.id}/dispose`, { disposedOn: '2026-06-10', method: 'sold' }, { token: repairer })).status).toBe(403);
  });

  it('disposes with gain/loss against book value; disposed assets refuse actions (409)', async () => {
    expect((await t.api('POST', `/assets/${laptop.id}/dispose`, { disposedOn: '2025-01-01', method: 'sold' })).status).toBe(400);
    const d = await t.api('POST', `/assets/${laptop.id}/dispose`, { disposedOn: '2026-06-10', method: 'sold', price: 36000 });
    // monthly (40,000 − 4,000) / 36 = 1,000; Jan–Jun = 6,000 -> book 34,000 -> gain 2,000
    expect(d.body).toMatchObject({ status: 'disposed', disposal_book_value: 34000, disposal_gain_loss: 2000, book_value: 0, disposal_method: 'sold' });
    expect((await t.api('POST', `/assets/${laptop.id}/dispose`, { disposedOn: '2026-06-10', method: 'sold' })).status).toBe(409);
    expect((await t.api('POST', `/assets/${laptop.id}/assign`, { location: 'x' })).status).toBe(409);
    expect((await t.api('POST', `/assets/${laptop.id}/repairs`, { description: 'x' })).status).toBe(409);
    expect((await t.api('PATCH', `/assets/${laptop.id}`, { name: 'x' })).status).toBe(409);
    const sch = (await t.api('GET', `/assets/${laptop.id}/schedule`)).body;
    expect(sch.rows).toHaveLength(6);
    expect((await t.api('GET', '/depreciation?month=2026-07')).body.rows.map((r: any) => r.code)).toEqual(['LAND-01']);
  });

  it('runs a physical audit: found / missing / unexpected / unknown, close, mark lost', async () => {
    const mk = async (code: string, location: string) => (await t.api('POST', '/assets', { code, name: `โต๊ะ ${code}`, categoryId: comp.id, location, purchaseDate: '2026-02-01', cost: 3600 })).body;
    const a1 = await mk('DESK-01', 'คลัง A');
    await mk('DESK-02', 'คลัง A');
    const a3 = await mk('DESK-03', 'คลัง B');
    const auditor = t.token(['assets.asset.read', 'assets.audit.run']);
    const au = await t.api('POST', '/audits', { location: 'คลัง A' }, { token: auditor });
    expect(au.status).toBe(201);
    expect(au.body.no).toMatch(/^AU-2569-\d{4}$/);
    expect(au.body).toMatchObject({ status: 'open', expected_count: 2, pending_count: 2 });

    const s1 = await t.api('POST', `/audits/${au.body.id}/scan`, { code: 'DESK-01' }, { token: auditor });
    expect(s1.body).toMatchObject({ result: 'found', found_count: 1, pending_count: 1 });
    expect(s1.body.message).toContain('DESK-01');
    expect((await t.api('POST', `/audits/${au.body.id}/scan`, { code: 'DESK-01' }, { token: auditor })).body.result).toBe('duplicate');
    expect((await t.api('POST', `/audits/${au.body.id}/scan`, { code: 'DESK-03' }, { token: auditor })).body).toMatchObject({ result: 'unexpected' });
    expect((await t.api('POST', `/audits/${au.body.id}/scan`, { code: 'NO-SUCH' }, { token: auditor })).body).toMatchObject({ result: 'unknown', message: 'ไม่พบรหัส NO-SUCH ในทะเบียน' });
    expect((await t.api('POST', `/audits/${au.body.id}/mark-lost`, undefined, { token: auditor })).status).toBe(409);

    const closed = await t.api('POST', `/audits/${au.body.id}/close`, undefined, { token: auditor });
    expect(closed.body).toMatchObject({ status: 'closed', found_count: 1, missing_count: 1, unexpected_count: 2, pending_count: 0 });
    expect((await t.api('POST', `/audits/${au.body.id}/close`, undefined, { token: auditor })).status).toBe(409);
    expect((await t.api('POST', `/audits/${au.body.id}/scan`, { code: 'DESK-02' }, { token: auditor })).status).toBe(409);

    const lost = await t.api('POST', `/audits/${au.body.id}/mark-lost`, undefined, { token: auditor });
    expect(lost.body.lost_count).toBe(1);
    expect((await t.api('GET', '/assets/by-code/DESK-02')).body).toMatchObject({ status: 'lost' });
    expect((await t.api('POST', `/audits/${au.body.id}/mark-lost`, undefined, { token: auditor })).status).toBe(409);
    expect((await t.api('GET', '/assets/by-code/DESK-01')).body.status).toBe('in_storage');
    expect(a1.id && a3.id).toBeTruthy();

    // a lost asset that turns up again can be assigned (found)
    const found = await t.api('POST', `/assets/${(await t.api('GET', '/assets/by-code/DESK-02')).body.id}/assign`, { location: 'คลัง A' });
    expect(found.body).toMatchObject({ status: 'in_storage', lost_on: null });
    expect((await t.api('GET', '/audits?status=closed')).body[0]).toMatchObject({ expected_count: 2, found_count: 1, missing_count: 1, unexpected_count: 2 });
  });

  it('summarises the register for the dashboard', async () => {
    const s = (await t.api('GET', '/summary')).body;
    expect(s).toMatchObject({ count: 4, totalCost: 5000000 + 3 * 3600, inRepair: 0, lost: 0, warrantyExpiring30d: 0 });
    const list = (await t.api('GET', '/assets?active=true')).body;
    expect(s.bookValue).toBeCloseTo(list.reduce((n: number, a: any) => n + a.book_value, 0), 2);
    expect(s.months).toHaveLength(6);
    expect(s.byCategory.map((c: any) => c.category_code)).toEqual(['LAND', 'COMP']);
  });

  it('requires permissions (403)', async () => {
    const reader = t.token(['assets.asset.read']);
    expect((await t.api('POST', '/categories', { code: 'Y', name: 'y' }, { token: reader })).status).toBe(403);
    expect((await t.api('POST', '/assets', { name: 'x', categoryId: comp.id, purchaseDate: '2026-01-01', cost: 1 }, { token: reader })).status).toBe(403);
    expect((await t.api('POST', '/audits', { location: 'คลัง A' }, { token: reader })).status).toBe(403);
    expect((await t.api('POST', '/repairs', { assetId: laptop.id, description: 'x' }, { token: reader })).status).toBe(403);
    expect((await t.api('GET', '/assets', undefined, { token: t.token([]) })).status).toBe(403);
  });

  it('isolates tenants', async () => {
    const other = t.token(['*'], t.otherTenantId);
    for (const path of ['/assets', '/categories', '/repairs', '/audits', '/locations']) {
      expect((await t.api('GET', path, undefined, { token: other })).body).toHaveLength(0);
    }
    expect((await t.api('GET', '/depreciation?month=2026-03', undefined, { token: other })).body.rows).toHaveLength(0);
    expect((await t.api('GET', `/assets/by-code/LAND-01`, undefined, { token: other })).status).toBe(404);
    expect((await t.api('GET', `/assets/${laptop.id}`, undefined, { token: other })).status).toBe(404);
    expect((await t.api('POST', '/assets', { name: 'x', categoryId: comp.id, purchaseDate: '2026-01-01', cost: 1 }, { token: other })).status).toBe(404);
    expect((await t.api('GET', '/summary', undefined, { token: other })).body).toMatchObject({ count: 0, bookValue: 0 });
  });
});

describe('assets events (for Automation alerts)', () => {
  it('publishes repair_reported for open repairs only (not for logging a finished repair)', async () => {
    const evs = (await t.published('assets.repair_reported')).map((e) => e.data);
    expect(evs).toHaveLength(1);
    const asset = (await t.api('GET', `/assets/${evs[0].assetId}`)).body;
    expect(evs[0]).toEqual({ assetId: asset.id, code: asset.code, name: asset.name, description: 'จอไม่ติด' });
  });
});
