import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mapImportRows, readXlsx, xlsxTemplate, type ListScreen } from '@erp/ui-schema';
import { definition as identity } from '@erp/svc-identity';
import { definition as masterData } from '@erp/svc-master-data';
import { definition as crm } from '@erp/svc-crm';
import { definition as sales } from '@erp/svc-sales';
import { definition as estimating } from '@erp/svc-estimating';
import estimatingUi from '@erp/svc-estimating/ui';
import { install, type Installation } from './helpers.ts';

/**
 * A printing house's path through a real installation: paper prices from the customer's Excel sheet → estimate with several print
 * quantities → confirmed price → CRM drafts the quotation → the customer accepts → Sales drafts the order. Every hop is an event.
 */
let erp: Installation;
let token: string;
const api = (m: string, p: string, b?: unknown) => erp.call(m, p, b, token);

beforeAll(async () => {
  erp = await install([identity, masterData, crm, sales, estimating]);
  ({ token } = await erp.provision('print-co'));
});
afterAll(async () => { await erp?.close(); });

describe('print estimating → quotation → sales order', () => {
  it('imports the paper price list from an .xlsx file the way the web app does', async () => {
    const spec = (estimatingUi.screens.papers as ListScreen).import!;
    const file = xlsxTemplate(
      ['รหัส', 'ชื่อกระดาษ', 'แกรม', 'กว้าง (นิ้ว)', 'ยาว (นิ้ว)', 'หน่วยราคา', 'ราคาต่อหน่วย'],
      [['ART-120', 'อาร์ตมัน 120 แกรม', '120', '31', '43', 'รีม', '1,650.00'], ['PB-350', 'กล่องแป้งหลังขาว 350 แกรม', '350', '31', '43', 'กิโลกรัม', '32']],
    );
    const { rows, missing } = mapImportRows(spec.columns, await readXlsx(file));
    expect(missing).toEqual([]);
    expect((await api('POST', `/api/estimating${spec.endpoint}`, { rows, dryRun: true })).body).toMatchObject({ created: 2, updated: 0, errors: [] });
    expect((await api('POST', `/api/estimating${spec.endpoint}`, { rows })).body).toMatchObject({ dryRun: false, created: 2 });
    expect((await api('GET', '/api/estimating/papers')).body.map((p: any) => [p.code, p.price_unit, p.price])).toEqual([['ART-120', 'ream', 1650], ['PB-350', 'kg', 32]]);
  });

  it('carries a confirmed estimate to a draft quotation and, once accepted, to a draft sales order', async () => {
    const customer = (await api('POST', '/api/master-data/partners', { code: 'C-001', name: 'บริษัท คูลแอร์ แมนูแฟคเจอริ่ง จำกัด', kind: 'customer', taxId: '0205555011227', branch: '00000', address: 'ชลบุรี' })).body;
    const paper = (await api('GET', '/api/estimating/papers?q=ART-120')).body[0];
    const press = (await api('POST', '/api/estimating/presses', {
      code: 'OFF-4C-4', name: 'ออฟเซ็ต 4 สี ตัด 4', maxWidthIn: 20.5, maxLengthIn: 29, plateCost: 350, makereadyCost: 300, runCostPerThousand: 250, minImpressions: 1000, makereadyWaste: 50, runWastePct: 3,
    })).body;
    const laminate = (await api('POST', '/api/estimating/finishings', { code: 'LAM-PVC', name: 'เคลือบ PVC ด้าน', chargeBy: 'per_sqin', rate: 0.006, minCharge: 500 })).body;

    const est = await api('POST', '/api/estimating/estimates', {
      jobName: 'โบรชัวร์สินค้า A4', partnerId: customer.id, customerName: customer.name, customerTaxId: customer.tax_id, customerBranch: customer.branch, customerAddress: customer.address,
      finishedW: 8.27, finishedL: 11.69, paperId: paper.id, pressId: press.id, pressSheetW: 15.5, pressSheetL: 21.5, colorsFront: 4, colorsBack: 4,
      quantities: '1000, 5000', marginPct: 30, finishings: [{ finishingId: laminate.id }],
    });
    expect(est.status, JSON.stringify(est.body)).toBe(201);
    expect(est.body.breaks.map((b: any) => [b.qty, b.unit_price, b.price])).toEqual([[1000, 12.73, 12730], [5000, 5.09, 25450]]);

    expect((await api('POST', `/api/estimating/estimates/${est.body.id}/confirm`, { qty: 5000 })).body.status).toBe('confirmed');
    await erp.settle();

    const quotes = (await api('GET', '/api/crm/quotations')).body;
    expect(quotes).toHaveLength(1);
    const quote = (await api('GET', `/api/crm/quotations/${quotes[0].id}`)).body;
    expect(quote).toMatchObject({ status: 'draft', partner_id: customer.id, customer_tax_id: '0205555011227', net: 25450, vat: 1781.5, gross: 27231.5 });
    expect(quote.note).toContain(est.body.no);
    expect(quote.lines).toMatchObject([{ qty: 5000, unit_price: 5.09, amount: 25450 }]);
    expect(quote.lines[0].description).toContain('โบรชัวร์สินค้า A4');

    await api('POST', `/api/crm/quotations/${quote.id}/send`);
    await api('POST', `/api/crm/quotations/${quote.id}/accept`);
    await erp.settle();
    const orders = (await api('GET', `/api/sales/orders?q=${quote.no}`)).body;
    expect(orders).toMatchObject([{ status: 'draft', ref: quote.no, customer_name: customer.name, gross: 27231.5 }]);
  });
});

describe('print estimating sold on its own', () => {
  let solo: Installation;
  beforeAll(async () => { solo = await install([identity, masterData, estimating]); });
  afterAll(async () => { await solo?.close(); });

  it('confirms a price with no CRM installed (the event simply has no subscriber)', async () => {
    const { token: tk } = await solo.provision('print-solo');
    const call = (m: string, p: string, b?: unknown) => solo.call(m, p, b, tk);
    expect((await solo.call('GET', '/api/_catalog', undefined, tk)).body.modules.map((m: any) => m.id).sort()).toEqual(['estimating', 'identity', 'master-data']);
    const paper = (await call('POST', '/api/estimating/papers', { code: 'PP-80', name: 'ปอนด์ 80 แกรม', gsm: 80, widthIn: 24, lengthIn: 35, price: 680 })).body;
    const press = (await call('POST', '/api/estimating/presses', { code: 'GTO-1', name: 'ออฟเซ็ต 1 สี ตัด 4', plateCost: 180, makereadyCost: 150, runCostPerThousand: 120, minImpressions: 1000, makereadyWaste: 30, runWastePct: 2 })).body;
    const est = await call('POST', '/api/estimating/estimates', {
      jobName: 'ใบเสร็จเล่ม A5', customerName: 'ร้านรุ่งเรืองการค้า', finishedW: 5.83, finishedL: 8.27, bleed: 0, paperId: paper.id, pressId: press.id,
      pressSheetW: 12, pressSheetL: 17.5, colorsFront: 1, quantities: [10000],
    });
    expect(est.status, JSON.stringify(est.body)).toBe(201);
    expect(est.body).toMatchObject({ ups: 4, cuts: 4, partner_id: null });
    expect((await call('POST', `/api/estimating/estimates/${est.body.id}/confirm`, {})).body.status).toBe('confirmed');
    await solo.settle();
  });
});
