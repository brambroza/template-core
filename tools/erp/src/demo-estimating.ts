/**
 * Demo data for the print-estimating module: a small printing house's rate tables and three draft estimates.
 * Rates are illustrative, not market prices. Estimates stay drafts so the presenter confirms one live (CRM then drafts the quotation).
 *
 * `pnpm demo` seeds this with the rest of a NEW demo company. For a demo company that already existed before the module was added,
 * run it once against the running stack (it does nothing when the rate tables already have rows):
 *
 *   node --import tsx tools/erp/src/demo-estimating.ts            # gateway http://127.0.0.1:8080 (DEMO_GATEWAY_PORT), admin@demo.co.th
 */
import { pathToFileURL } from 'node:url';
import type { Call } from './demo-business.ts';

/** Paper price list as a customer would keep it in Excel — goes in through the same import route as the "นำเข้าจาก Excel" button. */
const PAPERS = [
  { code: 'ARTG-105', name: 'อาร์ตมัน 105 แกรม', gsm: '105', widthIn: '31', lengthIn: '43', priceUnit: 'รีม', price: '1,450' },
  { code: 'ARTG-130', name: 'อาร์ตมัน 130 แกรม', gsm: '130', widthIn: '31', lengthIn: '43', priceUnit: 'รีม', price: '1,790' },
  { code: 'ARTC-260', name: 'อาร์ตการ์ด 260 แกรม', gsm: '260', widthIn: '31', lengthIn: '43', priceUnit: 'รีม', price: '3,650' },
  { code: 'PP-80', name: 'ปอนด์ 80 แกรม', gsm: '80', widthIn: '24', lengthIn: '35', priceUnit: 'รีม', price: '680' },
  { code: 'PB-350', name: 'กล่องแป้งหลังขาว 350 แกรม', gsm: '350', widthIn: '31', lengthIn: '43', priceUnit: 'กิโลกรัม', price: '32' },
  { code: 'STK-PVC', name: 'สติ๊กเกอร์ PVC ขาวเงา', gsm: '180', widthIn: '21', lengthIn: '31', priceUnit: 'แผ่น', price: '14.50' },
];

const PRESSES = [
  { code: 'OFF-4C-2', name: 'ออฟเซ็ต 4 สี ตัด 2', maxWidthIn: 25, maxLengthIn: 36, maxColors: 4, plateCost: 550, makereadyCost: 400, runCostPerThousand: 350, minImpressions: 1000, makereadyWaste: 80, runWastePct: 3 },
  { code: 'OFF-4C-4', name: 'ออฟเซ็ต 4 สี ตัด 4', maxWidthIn: 20.5, maxLengthIn: 29, maxColors: 4, plateCost: 350, makereadyCost: 300, runCostPerThousand: 250, minImpressions: 1000, makereadyWaste: 50, runWastePct: 3 },
  { code: 'DIGI-A3', name: 'ดิจิทัล A3+ (ไม่มีเพลท)', maxWidthIn: 13, maxLengthIn: 19, maxColors: 4, plateCost: 0, makereadyCost: 0, runCostPerThousand: 900, minImpressions: 0, makereadyWaste: 2, runWastePct: 1 },
];

const FINISHINGS = [
  { code: 'LAM-PVC-M', name: 'เคลือบ PVC ด้าน', chargeBy: 'per_sqin', rate: 0.006, minCharge: 500 },
  { code: 'LAM-UV', name: 'เคลือบยูวี', chargeBy: 'per_sqin', rate: 0.0035, minCharge: 400 },
  { code: 'DIECUT', name: 'ไดคัท (รวมค่าบล็อก)', chargeBy: 'per_sheet', rate: 0.5, setupCost: 1500 },
  { code: 'FOLD', name: 'พับ', chargeBy: 'per_piece', rate: 0.15, minCharge: 300 },
  { code: 'GLUE', name: 'ปะกาวกล่อง', chargeBy: 'per_piece', rate: 0.35, minCharge: 500 },
  { code: 'SADDLE', name: 'เย็บมุงหลังคา', chargeBy: 'per_piece', rate: 0.8, minCharge: 500 },
  { code: 'PACK', name: 'ห่อและแพ็คกล่อง', chargeBy: 'per_job', rate: 250 },
];

/** Rate tables first, then three draft estimates for the demo customers (leaflet, carton, labels). */
export async function seedEstimating(call: Call, partners: Record<string, any>): Promise<void> {
  await call('POST', '/api/estimating/papers/import', { rows: PAPERS });
  for (const p of PRESSES) await call('POST', '/api/estimating/presses', p);
  for (const f of FINISHINGS) await call('POST', '/api/estimating/finishings', f);
  const id = async (table: string) => Object.fromEntries((await call<any[]>('GET', `/api/estimating/${table}`)).map((r) => [r.code, r.id])) as Record<string, string>;
  const [paper, press, finishing] = [await id('papers'), await id('presses'), await id('finishings')];
  const customer = (code: string) => {
    const p = partners[code];
    return { partnerId: p.id, customerName: p.name, customerTaxId: p.tax_id ?? undefined, customerBranch: p.branch ?? undefined, customerAddress: p.address ?? undefined };
  };
  await call('POST', '/api/estimating/estimates', {
    jobName: 'แผ่นพับคู่มือติดตั้งแอร์ A4', ...customer('C-001'), finishedW: 8.27, finishedL: 11.69, paperId: paper['ARTG-130'], pressId: press['OFF-4C-4'],
    pressSheetW: 15.5, pressSheetL: 21.5, colorsFront: 4, colorsBack: 4, quantities: [1000, 3000, 5000], marginPct: 30,
    finishings: [{ finishingId: finishing.FOLD, times: 2 }], note: 'พับ 3 ตอน ส่งพร้อมสินค้าล็อตเดือนหน้า',
  });
  await call('POST', '/api/estimating/estimates', {
    jobName: 'กล่องบรรจุเบรกเกอร์ พิมพ์ 4 สี', ...customer('C-002'), finishedW: 12, finishedL: 16, bleed: 0.125, paperId: paper['PB-350'], pressId: press['OFF-4C-4'],
    pressSheetW: 15.5, pressSheetL: 21.5, colorsFront: 4, colorsBack: 0, quantities: [2000, 5000], marginPct: 25,
    finishings: [{ finishingId: finishing['LAM-UV'] }, { finishingId: finishing.DIECUT }, { finishingId: finishing.GLUE }],
  });
  await call('POST', '/api/estimating/estimates', {
    jobName: 'สติ๊กเกอร์ฉลากสินค้า 3 × 4 นิ้ว', ...customer('C-003'), finishedW: 3, finishedL: 4, paperId: paper['STK-PVC'], pressId: press['OFF-4C-4'],
    pressSheetW: 10.5, pressSheetL: 15.5, colorsFront: 4, colorsBack: 0, quantities: [5000, 10000, 20000], marginPct: 35,
    finishings: [{ finishingId: finishing.DIECUT }, { finishingId: finishing.PACK }],
  });
}

/** Seed a demo company that is already running: log in as its admin, find the demo customers, add the estimating data once. */
async function seedRunningDemo(): Promise<void> {
  const gateway = `http://127.0.0.1:${process.env.DEMO_GATEWAY_PORT ?? 8080}`;
  const login = await fetch(`${gateway}/api/identity/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.DEMO_EMAIL ?? 'admin@demo.co.th', password: process.env.DEMO_PASSWORD ?? 'demo1234' }),
  }).catch(() => { throw new Error(`no demo answering on ${gateway} — start it with pnpm demo first`); });
  if (!login.ok) throw new Error(`login failed (${login.status}) — is the demo running on ${gateway}?`);
  const { token } = (await login.json()) as { token: string };
  const call: Call = async (method, path, body) => {
    const res = await fetch(`${gateway}${path}`, {
      method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
    return (text ? JSON.parse(text) : undefined) as any;
  };
  const customers = await call<any[]>('GET', '/api/master-data/partners?kind=customer');
  const partners = Object.fromEntries(customers.map((p) => [p.code, p]));
  const missing = ['C-001', 'C-002', 'C-003'].filter((code) => !partners[code]);
  if (missing.length) throw new Error(`demo customers ${missing.join(', ')} not found — this is not the demo company`);
  if ((await call<any[]>('GET', '/api/estimating/papers')).length) {
    console.log('Estimating already has rate tables — nothing to do.');
    return;
  }
  await seedEstimating(call, partners);
  console.log('Estimating demo data created: 6 papers, 3 presses, 7 finishings, 3 draft estimates.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seedRunningDemo().catch((e) => {
    console.error(`error: ${(e as Error).message}`);
    process.exitCode = 1;
  });
}
