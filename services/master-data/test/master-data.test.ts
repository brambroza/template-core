import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

describe('master-data', () => {
  it('creates, lists, filters and updates items and publishes upserts', async () => {
    const steel = await t.api('POST', '/items', { code: 'RM-STEEL', name: 'เหล็กแผ่น 2mm', type: 'raw', uom: 'kg' });
    expect(steel.status).toBe(201);
    await t.api('POST', '/items', { code: 'FG-BRACKET', name: 'ขายึด', type: 'finished', stdPrice: 45 });
    expect((await t.api('GET', '/items?type=raw')).body.map((i: any) => i.code)).toEqual(['RM-STEEL']);
    expect((await t.api('GET', '/items?q=ขา')).body.map((i: any) => i.code)).toEqual(['FG-BRACKET']);
    const upd = await t.api('PATCH', `/items/${steel.body.id}`, { name: 'เหล็กแผ่น 3mm' });
    expect(upd.body.name).toBe('เหล็กแผ่น 3mm');
    const events = await t.published('master.item_upserted');
    expect(events).toHaveLength(3);
    expect(events[2].data).toMatchObject({ itemId: steel.body.id, code: 'RM-STEEL', name: 'เหล็กแผ่น 3mm' });
  });

  it('rejects duplicate codes, bad types and invalid tax IDs', async () => {
    expect((await t.api('POST', '/items', { code: 'RM-STEEL', name: 'dup', type: 'raw' })).status).toBe(409);
    expect((await t.api('POST', '/items', { code: 'X', name: 'x', type: 'weird' })).status).toBe(400);
    expect((await t.api('POST', '/partners', { code: 'C1', name: 'ACME', kind: 'customer', taxId: '0105536000315' })).status).toBe(400);
    const ok = await t.api('POST', '/partners', { code: 'C1', name: 'ACME', kind: 'customer', taxId: '0105536000313' });
    expect(ok.status).toBe(201);
    expect(ok.body.branch).toBe('00000');
    expect((await t.published('master.partner_upserted'))[0].data.taxId).toBe('0105536000313');
  });

  it('enforces permissions and tenant isolation', async () => {
    const readOnly = t.token(['master.item.read']);
    expect((await t.api('GET', '/items', undefined, { token: readOnly })).status).toBe(200);
    expect((await t.api('POST', '/items', { code: 'Y', name: 'y', type: 'raw' }, { token: readOnly })).status).toBe(403);
    const other = t.token(['*'], t.otherTenantId);
    expect((await t.api('GET', '/items', undefined, { token: other })).body).toEqual([]);
    expect((await t.api('POST', '/items', { code: 'RM-STEEL', name: 'same code, other company', type: 'raw' }, { token: other })).status).toBe(201);
  });
});

describe('master-data CSV import', () => {
  const count = async (path: string, q: string, token?: string) => (await t.api('GET', `${path}?q=${encodeURIComponent(q)}`, undefined, token ? { token } : undefined)).body.length;

  it('reports per-row validation errors with row numbers and Thai messages', async () => {
    const res = await t.api('POST', '/items/import', { dryRun: true, rows: [
      { code: 'IMP-OK', name: 'ดี', type: 'raw' },
      { code: 'IMP-BAD', name: '', type: 'weird' },
      { code: 'IMP-PRICE', name: 'ราคา', type: 'raw', stdPrice: 'abc' },
      { code: 'IMP-OK', name: 'ซ้ำ', type: 'raw' },
    ] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, total: 4, created: 1, updated: 0 });
    expect(res.body.errors).toEqual([
      { row: 2, field: 'name', message: 'ต้องกรอก' },
      { row: 2, field: 'type', message: 'ต้องเป็นหนึ่งใน raw, semi, finished, spare, service' },
      { row: 3, field: 'stdPrice', message: 'รูปแบบไม่ถูกต้อง' },
      { row: 4, field: 'code', message: 'รหัสซ้ำกับแถวที่ 1' },
    ]);
  });

  it('a dry run writes nothing; a run with errors writes nothing either', async () => {
    const before = (await t.published('master.item_upserted')).length;
    const dry = await t.api('POST', '/items/import', { dryRun: true, rows: [{ code: 'IMP-DRY', name: 'ลองดู', type: 'raw' }] });
    expect(dry.body).toMatchObject({ dryRun: true, created: 1, errors: [] });
    expect(await count('/items', 'IMP-DRY')).toBe(0);
    const bad = await t.api('POST', '/items/import', { rows: [{ code: 'IMP-DRY', name: 'ลองดู', type: 'raw' }, { code: 'IMP-X', name: 'x', type: 'nope' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.errors).toHaveLength(1);
    expect(await count('/items', 'IMP-DRY')).toBe(0);
    expect((await t.published('master.item_upserted')).length).toBe(before);
  });

  it('upserts by code in one go, coercing spreadsheet text and keeping unfilled columns', async () => {
    await t.api('POST', '/items', { code: 'IMP-EXIST', name: 'เดิม', type: 'raw', uom: 'kg', stdPrice: 10 });
    const before = (await t.published('master.item_upserted')).length;
    const rows = [
      { code: 'IMP-EXIST', name: 'ชื่อใหม่', type: 'raw' },
      { code: 'IMP-NEW', name: 'ของใหม่', type: 'สินค้าสำเร็จรูป', stdPrice: '1,250.50', active: 'ไม่ใช่' },
    ];
    expect((await t.api('POST', '/items/import', { dryRun: true, rows })).body).toMatchObject({ created: 1, updated: 1, errors: [] });
    const res = await t.api('POST', '/items/import', { rows });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ dryRun: false, total: 2, created: 1, updated: 1, errors: [] });
    const list = (await t.api('GET', '/items?q=IMP-')).body;
    const exist = list.find((i: any) => i.code === 'IMP-EXIST');
    expect(exist).toMatchObject({ name: 'ชื่อใหม่', uom: 'kg', std_price: 10 });
    expect(list.find((i: any) => i.code === 'IMP-NEW')).toMatchObject({ name: 'ของใหม่', type: 'finished', uom: 'pcs', std_price: 1250.5, active: false });
    const events = await t.published('master.item_upserted');
    expect(events.length).toBe(before + 2);
    expect(events.find((e) => e.data.itemId === exist.id && e.data.name === 'ชื่อใหม่')).toBeTruthy();
  });

  it('imports partners, repairing tax IDs and branches Excel mangled', async () => {
    const res = await t.api('POST', '/partners/import', { rows: [
      { code: 'IMP-C1', name: 'บจก. นำเข้า', kind: 'customer', taxId: '105536000313', branch: '1' },
      { code: 'IMP-S1', name: 'ผู้ขายนำเข้า', kind: 'ผู้ขาย', taxId: '0-1055-36000-31-3' },
      { code: 'IMP-B1', name: 'ทั้งสองแบบ', kind: 'BOTH' },
    ] });
    expect(res.body).toMatchObject({ created: 3, errors: [] });
    expect((await t.api('GET', '/partners?q=IMP-S1')).body[0].kind).toBe('supplier');
    const c1 = (await t.api('GET', '/partners?q=IMP-C1')).body[0];
    expect(c1).toMatchObject({ tax_id: '0105536000313', branch: '00001' });
    const bad = await t.api('POST', '/partners/import', { dryRun: true, rows: [{ code: 'IMP-C2', name: 'x', kind: 'customer', taxId: '0105536000315', email: 'nope' }] });
    expect(bad.body.errors).toEqual([
      { row: 1, field: 'taxId', message: 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง' },
      { row: 1, field: 'email', message: 'อีเมลไม่ถูกต้อง' },
    ]);
  });

  it('limits the batch size and validates the envelope', async () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({ code: `M${i}`, name: 'x', type: 'raw' }));
    expect((await t.api('POST', '/items/import', { rows: many, dryRun: true })).status).toBe(400);
    expect((await t.api('POST', '/items/import', { rows: [] })).status).toBe(400);
    expect((await t.api('POST', '/items/import', { dryRun: true })).status).toBe(400);
  });

  it('requires write permission per entity', async () => {
    const rows = [{ code: 'IMP-PERM', name: 'x', type: 'raw' }];
    expect((await t.api('POST', '/items/import', { rows }, { token: t.token(['master.item.read', 'master.partner.write']) })).status).toBe(403);
    expect((await t.api('POST', '/partners/import', { rows: [{ code: 'P', name: 'x', kind: 'customer' }] }, { token: t.token(['master.item.write']) })).status).toBe(403);
    expect((await t.api('POST', '/items/import', { rows, dryRun: true }, { token: t.token(['master.item.write']) })).status).toBe(200);
  });

  it('keeps each company to its own records', async () => {
    const other = t.token(['*'], t.otherTenantId);
    // IMP-EXIST belongs to the first company: for the other company it is a new record
    const dry = await t.api('POST', '/items/import', { dryRun: true, rows: [{ code: 'IMP-EXIST', name: 'บริษัทอื่น', type: 'raw' }] }, { token: other });
    expect(dry.body).toMatchObject({ created: 1, updated: 0 });
    expect((await t.api('POST', '/items/import', { rows: [{ code: 'IMP-EXIST', name: 'บริษัทอื่น', type: 'raw' }] }, { token: other })).body.created).toBe(1);
    expect((await t.api('GET', '/items?q=IMP-EXIST')).body[0].name).toBe('ชื่อใหม่');
    expect((await t.api('GET', '/items?q=IMP-EXIST', undefined, { token: other })).body.map((i: any) => i.name)).toEqual(['บริษัทอื่น']);
    expect(await count('/items', 'IMP-NEW', other)).toBe(0);
  });
});
