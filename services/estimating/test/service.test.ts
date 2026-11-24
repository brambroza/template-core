import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { mapImportRows, readXlsx, xlsxTemplate, type ListScreen } from '@erp/ui-schema';
import { definition } from '../src/service.ts';
import ui from '../src/ui.ts';

let t: TestService;
const ids: Record<string, string> = {};

beforeAll(async () => {
  t = await bootTestService(definition);
  const post = async (path: string, body: unknown) => {
    const r = await t.api('POST', path, body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    ids[(body as { code: string }).code] = r.body.id;
  };
  await post('/papers', { code: 'ART-120', name: 'อาร์ตมัน 120 แกรม', gsm: 120, widthIn: 31, lengthIn: 43, priceUnit: 'ream', price: 1650 });
  await post('/papers', { code: 'PB-300', name: 'กล่องแป้งหลังขาว 300 แกรม', gsm: 300, widthIn: 31, lengthIn: 43, priceUnit: 'kg', price: 30 });
  await post('/presses', {
    code: 'SM74-4', name: 'ออฟเซ็ต 4 สี ตัด 4', maxWidthIn: 20.5, maxLengthIn: 29, maxColors: 4,
    plateCost: 350, makereadyCost: 300, runCostPerThousand: 250, minImpressions: 1000, makereadyWaste: 50, runWastePct: 3,
  });
  await post('/finishings', { code: 'LAM-PVC', name: 'เคลือบ PVC ด้าน', chargeBy: 'per_sqin', rate: 0.006, minCharge: 500 });
  await post('/finishings', { code: 'DIECUT', name: 'ไดคัท', chargeBy: 'per_sheet', rate: 0.5, setupCost: 1500 });
});
afterAll(async () => { await t?.close(); });

/** A4 leaflet, 4/4 colours on 31×43 art paper cut in 4, PVC laminated — the numbers are worked out by hand in calc.test.ts. */
const leaflet = (extra: Record<string, unknown> = {}) => ({
  jobName: 'โบรชัวร์สินค้า A4', customerName: 'บริษัท ชลบุรีพลาสติก จำกัด', partnerId: randomUUID(), customerTaxId: '0105536000313', customerBranch: '00000', customerAddress: 'ชลบุรี',
  finishedW: 8.27, finishedL: 11.69, paperId: ids['ART-120'], pressId: ids['SM74-4'], pressSheetW: 15.5, pressSheetL: 21.5,
  colorsFront: 4, colorsBack: 4, quantities: '1000, 5000', marginPct: 30, finishings: [{ finishingId: ids['LAM-PVC'] }],
  ...extra,
});
const formulaId = async (code: string) => (await t.api('GET', '/formulas')).body.find((f: any) => f.code === code).id as string;

describe('rate tables', () => {
  it('lists, searches and updates rates; a duplicate code is refused', async () => {
    const papers = (await t.api('GET', '/papers')).body;
    expect(papers.map((p: any) => p.code)).toEqual(['ART-120', 'PB-300']);
    expect((await t.api('GET', '/papers?q=กล่องแป้ง')).body).toMatchObject([{ code: 'PB-300', price_unit: 'kg', gsm: 300 }]);
    expect((await t.api('POST', '/papers', { code: 'ART-120', name: 'ซ้ำ', gsm: 120, widthIn: 31, lengthIn: 43, price: 1 })).status).toBe(409);
    const up = await t.api('PATCH', `/presses/${ids['SM74-4']}`, { runWastePct: 3 });
    expect(up.body).toMatchObject({ code: 'SM74-4', run_cost_per_thousand: 250, run_waste_pct: 3, makeready_waste: 50 });
    expect((await t.api('POST', '/finishings', { code: 'X', name: 'x', chargeBy: 'per_meter' })).status).toBe(400);
    expect((await t.api('POST', '/papers', { code: 'BAD', name: 'x', gsm: 0, widthIn: 31, lengthIn: 43, price: 10 })).status).toBe(400);
  });

  it('imports a paper price list from a real Excel file: dry run with per-row errors, then all rows or none', async () => {
    const spec = (ui.screens.papers as ListScreen).import!;
    /** what the web app does with the picked file */
    const rows = async (table: string[][]) => mapImportRows(spec.columns, await readXlsx(xlsxTemplate(table[0]!, table.slice(1)))).rows;
    const header = ['รหัส', 'ชื่อกระดาษ', 'แกรม', 'กว้าง (นิ้ว)', 'ยาว (นิ้ว)', 'หน่วยราคา', 'ราคาต่อหน่วย'];

    const bad = await rows([header,
      ['ART-120', 'อาร์ตมัน 120 แกรม', '120', '31', '43', 'รีม', '1,720.00'],
      ['ART-160', 'อาร์ตการ์ด 160 แกรม', 'หนา', '31', '43', 'รีม', '2,300'],
      ['PP-80', 'ปอนด์ 80 แกรม', '80', '24', '35', 'ม้วน', '620'],
      ['ART-120', 'ซ้ำ', '120', '31', '43', 'รีม', '1'],
    ]);
    const dry = await t.api('POST', spec.endpoint, { rows: bad, dryRun: true });
    expect(dry.body).toMatchObject({ dryRun: true, total: 4, created: 0, updated: 1 });
    expect(dry.body.errors).toEqual([
      { row: 2, field: 'gsm', message: 'ต้องเป็นตัวเลข' },
      { row: 3, field: 'priceUnit', message: 'ต้องเป็นหนึ่งใน ream, kg, sheet' },
      { row: 4, field: 'code', message: 'รหัสซ้ำกับแถวที่ 1' },
    ]);
    // a real run with any error writes nothing
    expect((await t.api('POST', spec.endpoint, { rows: bad })).status).toBe(400);
    expect((await t.api('GET', '/papers?q=ART-120')).body[0].price).toBe(1650);

    const good = await rows([header,
      ['ART-120', 'อาร์ตมัน 120 แกรม', '120', '31', '43', 'รีม', '1,720.00'],
      ['ART-160', 'อาร์ตการ์ด 160 แกรม', '160', '31', '43', 'รีม', '2,300'],
      ['PP-80', 'ปอนด์ 80 แกรม', '80', '24', '35', 'กก.', '38.50'],
    ]);
    expect((await t.api('POST', spec.endpoint, { rows: good })).body).toMatchObject({ dryRun: false, total: 3, created: 2, updated: 1, errors: [] });
    const after = (await t.api('GET', '/papers')).body;
    expect(after.find((p: any) => p.code === 'ART-120')).toMatchObject({ id: ids['ART-120'], price: 1720 });
    expect(after.find((p: any) => p.code === 'PP-80')).toMatchObject({ price_unit: 'kg', price: 38.5, width_in: 24, length_in: 35, active: true });
    // back to the price the estimate tests below were worked out with
    await t.api('PATCH', `/papers/${ids['ART-120']}`, { price: 1650 });
  });

  it('imports presses and finishing with Thai charge words', async () => {
    const r = await t.api('POST', '/finishings/import', { rows: [
      { code: 'FOLD', name: 'พับ 2 ตอน', chargeBy: 'ต่อชิ้น', rate: '0.15', minCharge: '300' },
      { code: 'PACK', name: 'ห่อและแพ็คกล่อง', chargeBy: 'เหมาต่องาน', rate: '250' },
    ] });
    expect(r.body).toMatchObject({ created: 2, updated: 0, errors: [] });
    expect((await t.api('GET', '/finishings?q=FOLD')).body).toMatchObject([{ charge_by: 'per_piece', rate: 0.15, min_charge: 300 }]);
    const p = await t.api('POST', '/presses/import', { rows: [{ code: 'GTO-2', name: 'ออฟเซ็ต 2 สี ตัด 8', plateCost: '180', makereadyCost: '150', runCostPerThousand: '120', minImpressions: '1,000' }] });
    expect(p.body).toMatchObject({ created: 1, errors: [] });
    expect((await t.api('GET', '/presses?q=GTO')).body).toMatchObject([{ plate_cost: 180, run_cost_per_thousand: 120, min_impressions: 1000, run_waste_pct: 0 }]);
  });
});

describe('estimates', () => {
  let estimateId: string;

  it('lays the job out, prices every print quantity and keeps the working', async () => {
    const r = await t.api('POST', '/estimates', leaflet());
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    estimateId = r.body.id;
    expect(r.body).toMatchObject({
      status: 'draft', job_name: 'โบรชัวร์สินค้า A4', paper_code: 'ART-120', press_code: 'SM74-4', bleed: 0.125,
      ups: 2, cuts: 4, qty_text: '1,000 / 5,000', size_text: '8.27 × 11.69 นิ้ว', colors_text: '4/4 สี',
    });
    expect(r.body.no).toMatch(/^EST-25\d\d-0001$/);
    expect(r.body.breaks).toEqual([
      { qty: 1000, press_sheets: 915, total_cost: 9785.24, unit_cost: 9.7852, unit_price: 12.73, price: 12730, profit: 2944.76 },
      { qty: 5000, press_sheets: 2975, total_cost: 19553.71, unit_cost: 3.9107, unit_price: 5.09, price: 25450, profit: 5896.29 },
    ]);
    expect(r.body.cost_lines.filter((l: any) => l.qty === 1000).map((l: any) => [l.code, l.value])).toEqual([
      ['netSheets', 500], ['wasteSheets', 415], ['pressSheets', 915], ['parentSheets', 229], ['paperCost', 755.7],
      ['plateTotal', 2800], ['makereadyTotal', 2400], ['printCost', 2000], ['finishing', 1829.54], ['unitPrice', 12.73],
    ]);
    expect(r.body.finishing_lines).toMatchObject([{ qty: 1000, code: 'LAM-PVC', amount: 1829.54 }, { qty: 5000, code: 'LAM-PVC', amount: 5948.51 }]);
    expect((await t.api('GET', '/estimates?q=โบรชัวร์')).body).toMatchObject([{ no: r.body.no, qty_text: '1,000 / 5,000', price_from: 12730, status: 'draft' }]);
  });

  it('prices paper bought by the kilogram, with the layout typed in by the estimator', async () => {
    // box blank 12 × 16 in, 1 colour, on 300 gsm board at 30 baht/kg: 129 kg per ream → 7.74 per parent sheet
    const r = await t.api('POST', '/estimates', leaflet({
      jobName: 'กล่องอะไหล่', paperId: ids['PB-300'], finishedW: 12, finishedL: 16, bleed: 0, pressSheetW: 15.5, pressSheetL: 21.5,
      ups: 1, cuts: 4, colorsFront: 1, colorsBack: 0, quantities: [2000], marginPct: 25, finishings: [{ finishingId: ids.DIECUT }],
    }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // sheets 2,000 + 50 + 60 = 2,110 → 528 parent sheets × 7.74 = 4,086.72; plate 350; make-ready 300; run 2,110/1,000 × 250 = 527.50; die-cut 1,500 + 1,055 = 2,555
    expect(r.body.breaks).toEqual([{ qty: 2000, press_sheets: 2110, total_cost: 7819.22, unit_cost: 3.9096, unit_price: 4.89, price: 9780, profit: 1960.78 }]);
  });

  it('refuses jobs that cannot be laid out, with the reason in Thai', async () => {
    const big = await t.api('POST', '/estimates', leaflet({ finishedW: 20, finishedL: 25 }));
    expect(big.status).toBe(400);
    expect(big.body.error.message).toBe('ขนาดงาน 20 × 25 นิ้ว รวมตัดตกแล้วใหญ่กว่าแผ่นพิมพ์ 15.5 × 21.5 นิ้ว');
    expect((await t.api('POST', '/estimates', leaflet({ pressSheetW: 25, pressSheetL: 36 }))).body.error.message).toContain('ใหญ่กว่าที่เครื่อง SM74-4 รับได้');
    expect((await t.api('POST', '/estimates', leaflet({ pressSheetW: 32, pressSheetL: 44, pressId: ids['SM74-4'] }))).body.error.message).toContain('ใหญ่กว่ากระดาษ ART-120');
    expect((await t.api('POST', '/estimates', leaflet({ quantities: '1,000' }))).body.error.message).toContain('ไม่ใส่จุลภาคคั่นหลักพัน');
    expect((await t.api('POST', '/estimates', leaflet({ quantities: 'พันใบ' }))).status).toBe(400);
    expect((await t.api('POST', '/estimates', leaflet({ colorsFront: 0, colorsBack: 0 }))).body.error.message).toBe('ต้องพิมพ์อย่างน้อย 1 สี');
    expect((await t.api('POST', '/estimates', leaflet({ paperId: randomUUID() }))).body.error.message).toBe('ไม่พบกระดาษที่เลือก');
    await t.api('PATCH', `/finishings/${ids.DIECUT}`, { active: false });
    expect((await t.api('POST', '/estimates', leaflet({ finishings: [{ finishingId: ids.DIECUT }] }))).body.error.message).toBe('งานหลังพิมพ์ DIECUT เลิกใช้แล้ว');
    await t.api('PATCH', `/finishings/${ids.DIECUT}`, { active: true });
  });

  it('formulas are data: a new cost line and a changed rate show up when the draft is worked out again', async () => {
    const formulas = (await t.api('GET', '/formulas')).body;
    expect(formulas.map((f: any) => f.code)).toEqual(['netSheets', 'wasteSheets', 'pressSheets', 'parentSheets', 'paperCost', 'plateTotal', 'makereadyTotal', 'printCost', 'finishing', 'unitPrice']);
    const added = await t.api('POST', '/formulas', { code: 'delivery', label: 'ค่าขนส่ง', expression: 'if(qty >= 5000, 800, 500)', kind: 'cost', seq: 95, unit: 'บาท' });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    // the saved estimate is a snapshot: nothing moves until someone asks
    expect((await t.api('GET', `/estimates/${estimateId}`)).body.breaks[0].total_cost).toBe(9785.24);
    const again = await t.api('POST', `/estimates/${estimateId}/recalculate`, {});
    expect(again.body.breaks.map((b: any) => [b.qty, b.total_cost, b.unit_price, b.price])).toEqual([[1000, 10285.24, 13.38, 13380], [5000, 20353.71, 5.3, 26500]]);
    expect(again.body.cost_lines.filter((l: any) => l.code === 'delivery').map((l: any) => l.value)).toEqual([500, 800]);

    // new quantities and margin on the way; the plate price went up in the rate table
    await t.api('PATCH', `/presses/${ids['SM74-4']}`, { plateCost: 400 });
    const what = await t.api('POST', `/estimates/${estimateId}/recalculate`, { quantities: '3000', marginPct: 20 });
    // sheets 1,500 + 400 + 45 = 1,945 → 487 × 3.30 = 1,607.10; plates 3,200; make-ready 2,400; run 8 × 1.945 × 250 = 3,890; laminate 3,889.03; delivery 500
    expect(what.body).toMatchObject({ qty_text: '3,000', margin_pct: 20, breaks: [{ qty: 3000, total_cost: 15486.13, unit_price: 6.2, price: 18600 }] });
    await t.api('PATCH', `/presses/${ids['SM74-4']}`, { plateCost: 350 });
    await t.api('PATCH', `/formulas/${added.body.id}`, { active: false });
  });

  it('checks a formula before saving it and tries one out without saving', async () => {
    const paperCost = await formulaId('paperCost');
    const typo = await t.api('PATCH', `/formulas/${paperCost}`, { expression: 'parentSheet * paperSheetCost' });
    expect(typo.status).toBe(400);
    expect(typo.body.error.message).toBe('สูตร "ค่ากระดาษ" (paperCost): ไม่รู้จักตัวแปร "parentSheet"');
    expect((await t.api('PATCH', `/formulas/${paperCost}`, { expression: 'parentSheets *' })).body.error.message).toContain('สูตรจบไม่สมบูรณ์');
    expect((await t.api('PATCH', `/formulas/${paperCost}`, { seq: 1 })).body.error.message).toContain('ไม่รู้จักตัวแปร "parentSheets"');
    expect((await t.api('GET', `/formulas/${paperCost}`)).body).toMatchObject({ expression: 'parentSheets * paperSheetCost', seq: 50 });

    expect((await t.api('PATCH', `/formulas/${await formulaId('pressSheets')}`, { active: false })).status).toBe(409);
    expect((await t.api('PATCH', `/formulas/${await formulaId('unitPrice')}`, { kind: 'cost' })).status).toBe(409);
    expect((await t.api('POST', '/formulas', { code: 'price2', label: 'ราคา 2', expression: 'totalCost / qty', kind: 'price' })).body.error.message).toContain('ราคาขายที่เปิดใช้งาน 1 สูตร');
    expect((await t.api('POST', '/formulas', { code: 'paperCost', label: 'ซ้ำ', expression: '1' })).body.error.message).toBe('มีสูตรรหัส paperCost อยู่แล้ว');
    expect((await t.api('POST', '/formulas', { code: 'qty', label: 'ชน', expression: '1' })).body.error.message).toContain('ซ้ำกับตัวแปรหรือฟังก์ชันของระบบ');

    const tryOut = await t.api('POST', '/formulas/test', { expression: 'parentSheets * paperSheetCost * 1.07' });
    expect(tryOut.body).toMatchObject({ value: 808.599 }); // 229 × 3.30 × 1.07 on the sample job
    expect(tryOut.body.message).toContain('808.599');
    expect((await t.api('POST', '/formulas/test', { expression: 'sheets * 2' })).body.error.message).toBe('ไม่รู้จักตัวแปร "sheets"');

    const vars = (await t.api('GET', '/formulas/variables')).body;
    expect(vars.find((v: any) => v.code === 'reamWeightKg')).toMatchObject({ unit: 'กก.', group: 'กระดาษ' });
    expect(vars.find((v: any) => v.code === 'parentSheets')).toMatchObject({ label: 'กระดาษแผ่นใหญ่ที่ใช้' });
    expect(vars.some((v: any) => v.code === 'delivery')).toBe(false); // switched off above
  });

  it('confirms the price of one quantity, tells CRM once and locks the estimate', async () => {
    const e = (await t.api('POST', '/estimates', leaflet())).body;
    const unsure = await t.api('POST', `/estimates/${e.id}/confirm`, {});
    expect(unsure.status).toBe(400);
    expect(unsure.body.error.message).toBe('เลือกยอดพิมพ์ที่ลูกค้าตกลง: 1,000 / 5,000');
    expect((await t.api('POST', `/estimates/${e.id}/confirm`, { qty: 2000 })).status).toBe(400);

    const ok = await t.api('POST', `/estimates/${e.id}/confirm`, { qty: 5000 }, { token: t.token(['estimating.estimate.confirm'], t.tenantId, { userName: 'ปิยะพงษ์ ขายเก่ง' }) });
    expect(ok.body).toMatchObject({ status: 'confirmed', confirmed_qty: 5000, confirmed_unit_price: 5.09, confirmed_price: 25450, confirmed_by_name: 'ปิยะพงษ์ ขายเก่ง' });
    const events = (await t.published('estimating.estimate_confirmed')).filter((x) => x.data.estimateId === e.id);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({
      no: e.no, jobName: 'โบรชัวร์สินค้า A4', customerName: 'บริษัท ชลบุรีพลาสติก จำกัด', partnerId: e.partner_id, customerTaxId: '0105536000313',
      qty: 5000, unitPrice: 5.09, price: 25450,
      description: 'โบรชัวร์สินค้า A4 · ขนาด 8.27 × 11.69 นิ้ว · พิมพ์ 4/4 สี · กระดาษ อาร์ตมัน 120 แกรม · เคลือบ PVC ด้าน',
    });
    for (const action of ['confirm', 'recalculate', 'cancel']) expect((await t.api('POST', `/estimates/${e.id}/${action}`, { qty: 5000 })).status, action).toBe(409);
    expect((await t.published('estimating.estimate_confirmed')).filter((x) => x.data.estimateId === e.id)).toHaveLength(1);
  });

  it('confirms a single-quantity estimate without asking, and cancels a draft', async () => {
    const one = (await t.api('POST', '/estimates', leaflet({ quantities: 1000 }))).body;
    expect((await t.api('POST', `/estimates/${one.id}/confirm`, {})).body).toMatchObject({ status: 'confirmed', confirmed_qty: 1000, confirmed_price: 12730 });
    const drop = (await t.api('POST', '/estimates', leaflet())).body;
    expect((await t.api('POST', `/estimates/${drop.id}/cancel`)).body.status).toBe('cancelled');
    expect((await t.api('POST', `/estimates/${drop.id}/confirm`, { qty: 1000 })).status).toBe(409);
    expect((await t.api('GET', '/summary')).body).toMatchObject({ confirmedThisMonth: 2, confirmedValueThisMonth: 38180 });
  });
});

describe('permissions and tenants', () => {
  it('separates estimating, confirming, rate tables and formulas', async () => {
    const estimator = t.token(['estimating.estimate.read', 'estimating.estimate.write', 'estimating.rate.read']);
    const made = await t.api('POST', '/estimates', leaflet(), { token: estimator });
    expect(made.status).toBe(201);
    expect((await t.api('POST', `/estimates/${made.body.id}/confirm`, { qty: 1000 }, { token: estimator })).status).toBe(403);
    expect((await t.api('POST', '/papers', { code: 'N', name: 'n', gsm: 80, widthIn: 24, lengthIn: 35, price: 1 }, { token: estimator })).status).toBe(403);
    expect((await t.api('POST', '/papers/import', { rows: [{ code: 'N' }] }, { token: estimator })).status).toBe(403);
    expect((await t.api('PATCH', `/formulas/${await formulaId('paperCost')}`, { expression: '0' }, { token: estimator })).status).toBe(403);
    expect((await t.api('POST', '/formulas/test', { expression: 'qty * 2' }, { token: estimator })).status).toBe(200);
    const rates = t.token(['estimating.rate.read', 'estimating.rate.write']);
    expect((await t.api('PATCH', `/formulas/${await formulaId('paperCost')}`, { expression: '0' }, { token: rates })).status).toBe(403);
    expect((await t.api('GET', '/estimates', undefined, { token: rates })).status).toBe(403);
    expect((await t.api('GET', '/papers', undefined, { token: t.token(['estimating.estimate.read']) })).status).toBe(403);
  });

  it('keeps every company to its own rates, formulas and estimates', async () => {
    const other = { token: t.token(['*'], t.otherTenantId) };
    for (const path of ['/papers', '/presses', '/finishings', '/estimates']) expect((await t.api('GET', path, undefined, other)).body, path).toEqual([]);
    expect((await t.api('GET', `/papers/${ids['ART-120']}`, undefined, other)).status).toBe(404);
    // the other company starts from its own copy of the standard formulas, and cannot price with our paper
    const theirs = (await t.api('GET', '/formulas', undefined, other)).body;
    expect(theirs).toHaveLength(10);
    expect(theirs.some((f: any) => f.code === 'delivery')).toBe(false);
    expect((await t.api('POST', '/estimates', leaflet(), other)).body.error.message).toBe('ไม่พบกระดาษที่เลือก');
    expect((await t.api('GET', '/summary', undefined, other)).body).toMatchObject({ drafts: 0, confirmedThisMonth: 0 });
  });
});
