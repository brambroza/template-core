/**
 * Demo stack: every module + gateway on this machine with realistic Thai factory data.
 *
 *   pnpm demo                      # needs Postgres (pnpm db:dev); prints URLs + login
 *   DEMO_RESET=1 pnpm demo         # drop and recreate the demo databases
 *
 * Login: company `demo`, admin@demo.co.th / demo1234
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createService, type Service, type ServiceDefinition } from '@erp/kernel';

const ADMIN_URL = process.env.DATABASE_ADMIN_URL ?? process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const APP_USER = process.env.DATABASE_APP_USER ?? 'erp_app';
const APP_PASSWORD = process.env.DATABASE_APP_PASSWORD ?? 'erp_app';

export interface DemoStack {
  gatewayUrl: string;
  services: Record<string, Service>;
  internalToken: string;
  urls: Record<string, string>;
  stop(): Promise<void>;
}

const dbName = (prefix: string, id: string) => `${prefix}_${id.replace(/-/g, '_')}`;

export async function ensureDatabases(prefix: string, ids: string[], reset: boolean): Promise<Record<string, string>> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`do $$ begin if not exists (select from pg_roles where rolname = '${APP_USER}') then create role ${APP_USER} login password '${APP_PASSWORD}'; end if; end $$;`);
  const urls: Record<string, string> = {};
  for (const id of ids) {
    const name = dbName(prefix, id);
    if (reset) await admin.query(`drop database if exists ${name} with (force)`);
    const exists = (await admin.query('select 1 from pg_database where datname = $1', [name])).rowCount;
    if (!exists) await admin.query(`create database ${name} owner ${APP_USER}`);
    const u = new URL(ADMIN_URL);
    u.username = APP_USER;
    u.password = APP_PASSWORD;
    u.pathname = `/${name}`;
    urls[id] = u.toString();
  }
  await admin.end();
  return urls;
}

/** Start the given modules and the gateway in this process (each module on its own port and database). */
export async function startStack(defs: ServiceDefinition[], opts: { prefix?: string; reset?: boolean; gatewayPort?: number; basePort?: number; env?: Record<string, string> } = {}): Promise<DemoStack> {
  const { createGateway } = await import('@erp/gateway');
  const internalToken = process.env.INTERNAL_TOKEN ?? 'demo-internal-token';
  const jwtSecret = process.env.JWT_SECRET ?? 'demo-jwt-secret-change-me';
  const gatewayPort = opts.gatewayPort ?? 8080;
  // Every module runs in this one process with its own pool. 18 pools x the kernel default (10) can open 180 connections and Postgres
  // allows 100 by default: while the seed fans out (CRM activities, timesheets, attendance, assets …) the server ran out of connections
  // and random POSTs answered 500 "too many clients already". A few connections per module is plenty for a demo.
  process.env.DB_POOL_MAX ??= String(Math.max(2, Math.min(10, Math.floor(60 / Math.max(defs.length, 1)))));
  const dbs = await ensureDatabases(opts.prefix ?? 'demo', defs.map((d) => d.manifest.id), !!opts.reset);
  const services: Record<string, Service> = {};
  const urls: Record<string, string> = {};
  let port = opts.basePort ?? 4100;
  for (const def of defs) {
    const env = {
      DATABASE_URL: dbs[def.manifest.id], JWT_SECRET: jwtSecret, INTERNAL_TOKEN: internalToken, NODE_ENV: 'development',
      EVENT_ROUTER_URL: `http://127.0.0.1:${gatewayPort}/_events/publish`, EVENT_DISPATCH_MS: '400', PROMPTPAY_ID: '0105536000313',
      // sign-up / reset e-mails (printed to this log) link to the demo web app
      APP_URL: `http://localhost:${process.env.WEB_PORT ?? '3000'}`, ...opts.env,
    };
    const svc = createService(def, env);
    urls[def.manifest.id] = await svc.start({ port: port++, host: '127.0.0.1' });
    services[def.manifest.id] = svc;
  }
  const gw = createGateway({ modules: urls, internalToken });
  await gw.discover();
  const gatewayUrl = await gw.app.listen({ port: gatewayPort, host: '0.0.0.0' });
  return {
    gatewayUrl, services, internalToken, urls,
    async stop() {
      await gw.app.close();
      for (const s of Object.values(services)) await s.close();
    },
  };
}

/* ------------------------------------------------------------------ seed ------------------------------------------------------------------ */

type Call = <T = any>(method: string, path: string, body?: unknown) => Promise<T>;

function client(gatewayUrl: string, token: string): Call {
  return async (method, path, body) => {
    const res = await fetch(`${gatewayUrl}${path}`, {
      method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
    return (text ? JSON.parse(text) : undefined) as any;
  };
}

const bkkToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const monthsAgo = (n: number, day = 12) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  d.setDate(Math.min(day, 28));
  return d.toISOString().slice(0, 10);
};
/** document dates never lie in the future (early in a month "this month's 8th" has not happened yet) */
const notAfterToday = (date: string) => (date > bkkToday() ? bkkToday() : date);

/** A small monogram logo (SVG) so printed documents show a real letterhead. */
const DEMO_LOGO = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">'
  + '<rect width="96" height="96" rx="18" fill="#141C22"/><path d="M14 70 L48 18 L82 70 Z" fill="#F5C518"/>'
  + '<text x="48" y="66" font-family="Arial, sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="#141C22">SP</text></svg>',
).toString('base64');

/**
 * The demo company's profile. 0105559012342 is a made-up tax ID that passes the mod-11 check digit
 * (first 12 digits 010555901234 -> check digit 2); it does not belong to a real company.
 */
export const DEMO_COMPANY = {
  legalName: 'บริษัท สยามพาร์ท เมทัลเวิร์ค จำกัด',
  nameEn: 'Siam Part Metalwork Co., Ltd.',
  taxId: '0105559012342',
  branchCode: '00000',
  address: '88/8 หมู่ 4 ถนนสุขุมวิท ตำบลแพรกษา อำเภอเมืองสมุทรปราการ จังหวัดสมุทรปราการ 10280',
  phone: '02-123-4567',
  email: 'account@siampart.example.co.th',
  website: 'www.siampart.example.co.th',
  logo: DEMO_LOGO,
  footerNote: 'โปรดชำระเงินภายใน 30 วันนับจากวันที่ในเอกสาร · โอนเข้าบัญชี บจก. สยามพาร์ท เมทัลเวิร์ค เท่านั้น',
  signatureLabels: ['ผู้จัดทำ', 'ผู้อนุมัติ'],
};

/** Monthly sales targets (THB) of the 5 months before this one — drives the seeded deliveries and the opening stock that covers them. */
const SALES_BASE = [182000, 205000, 198000, 236000, 251000];

export interface SeedResult { tenant: string; email: string; password: string; created: boolean }

/** Create company `demo` with a believable month of factory activity. Idempotent: does nothing if it exists. */
export async function seedDemo(stack: DemoStack, opts: { tenant?: string; installed?: string[] } = {}): Promise<SeedResult> {
  const tenant = opts.tenant ?? 'demo';
  const email = 'admin@demo.co.th', password = 'demo1234';
  const modules = opts.installed ?? Object.keys(stack.services);
  const has = (m: string) => modules.includes(m);
  const prov = await fetch(`${stack.urls.identity}/tenants`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': stack.internalToken },
    body: JSON.stringify({ code: tenant, name: 'บริษัท สยามพาร์ท เมทัลเวิร์ค จำกัด', admin: { email, name: 'สมศักดิ์ ศรีสวัสดิ์', password } }),
  });
  if (prov.status === 409) return { tenant, email, password, created: false };
  if (!prov.ok) throw new Error(`provision failed: ${await prov.text()}`);
  const login = await (await fetch(`${stack.gatewayUrl}/api/identity/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenant, email, password }),
  })).json();
  const call = client(stack.gatewayUrl, login.token);
  const loginAs = async (who: string) => {
    const res = await fetch(`${stack.gatewayUrl}/api/identity/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenant, email: who, password }),
    });
    if (!res.ok) throw new Error(`login ${who} failed: ${await res.text()}`);
    return client(stack.gatewayUrl, (await res.json()).token);
  };
  const settle = () => new Promise((r) => setTimeout(r, 1500));
  const business = await import('./demo-business.ts');

  // ---------------- company profile (letterhead + seller details on every printed document) ----------------
  await call('PUT', '/api/identity/company', DEMO_COMPANY);

  // chart of accounts, posting rules and category mappings before the first purchase / sale, so every event posts to the right account
  if (has('accounting')) await (await import('./demo-finance.ts')).setupAccounting(call);

  // rules first, so they fire on everything below (the bell then shows real notifications)
  if (has('automation')) {
    const { seedAutomation } = await import('./demo-automation.ts');
    await seedAutomation(call);
  }

  // ---------------- people & roles: Identity's suggested role templates, as a customer would set them up (wave 8, round-2 N3) ----------------
  const roles = await business.templateRoles(call, modules, ['staff', 'warehouse', 'purchasing', 'sales', 'technician', 'pm', 'planner']);
  for (const [mail, name] of [
    ['store@demo.co.th', 'สมชาย คลังดี'], ['buyer@demo.co.th', 'วิไลวรรณ จัดซื้อ'], ['sales@demo.co.th', 'ปิยะพงษ์ ขายเก่ง'],
    ['tech@demo.co.th', 'ประเสริฐ ช่างใหญ่'], ['plan@demo.co.th', 'กมลชนก วางแผน'],
  ] as const) await call('POST', '/api/identity/users', { email: mail, name, password: 'demo1234', roleIds: business.demoRoleIds(mail, roles) });

  // ---------------- master data ----------------
  const items: Record<string, { itemId: string; itemCode: string; itemName: string }> = {};
  for (const [code, name, type, uom, price] of [
    ['RM-SPCC-12', 'เหล็กแผ่น SPCC 1.2 มม.', 'raw', 'kg', 32.5], ['RM-SPCC-20', 'เหล็กแผ่น SPCC 2.0 มม.', 'raw', 'kg', 33.8],
    ['RM-SUS304', 'สแตนเลส SUS304 1.0 มม.', 'raw', 'kg', 118], ['RM-PAINT-GR', 'สีฝุ่นเทา (Powder coat)', 'raw', 'kg', 165],
    ['RM-ZINC', 'น้ำยาชุบซิงค์', 'raw', 'ลิตร', 89], ['SP-BOLT-M8', 'น็อต M8x20', 'spare', 'ตัว', 1.2],
    ['SP-SEAL-HYD', 'ซีลกระบอกไฮดรอลิก', 'spare', 'ชุด', 850], ['SP-BELT-B52', 'สายพาน B52', 'spare', 'เส้น', 420],
    ['SP-OIL-68', 'น้ำมันไฮดรอลิก ISO 68', 'spare', 'ลิตร', 95], ['SA-PLATE-A', 'แผ่นยึดชุบซิงค์ A', 'semi', 'ชิ้น', 0],
    ['FG-BRK-100', 'ขายึดแอร์ BRK-100', 'finished', 'ชิ้น', 48], ['FG-BRK-200', 'ขายึดแอร์ BRK-200 (สแตนเลส)', 'finished', 'ชิ้น', 135],
    ['FG-CASE-01', 'กล่องตู้ควบคุม CASE-01', 'finished', 'ชิ้น', 690], ['FG-RACK-08', 'ชั้นวางเหล็ก RACK-08', 'finished', 'ชุด', 1450],
  ] as const) {
    const r = await call('POST', '/api/master-data/items', { code, name, type, uom, stdPrice: price || undefined });
    items[code] = { itemId: r.id, itemCode: code, itemName: name };
  }
  const partners: Record<string, any> = {};
  // Tax IDs are made up (they pass the mod-11 check digit); full addresses with postcodes — tax invoices, 50 ทวิ and e-Tax need them
  for (const [code, name, kind, taxId, address, email] of [
    ['S-001', 'บริษัท สยามเหล็กกล้า จำกัด', 'supplier', '0105536000313', '555 หมู่ 2 นิคมอุตสาหกรรมบางปู ตำบลแพรกษา อำเภอเมืองสมุทรปราการ จังหวัดสมุทรปราการ 10280', null],
    ['S-002', 'บริษัท ไทยสแตนเลส ซัพพลาย จำกัด', 'supplier', '0105547023450', '1/88 ถนนบางนา-ตราด แขวงบางนาใต้ เขตบางนา กรุงเทพมหานคร 10260', null],
    ['S-003', 'หจก. ช่างไทยอะไหล่', 'supplier', '0103546007891', '45/7 ถนนสุขสวัสดิ์ ตำบลบางพึ่ง อำเภอพระประแดง จังหวัดสมุทรปราการ 10130', null],
    ['C-001', 'บริษัท คูลแอร์ แมนูแฟคเจอริ่ง จำกัด', 'customer', '0205555011227', '700/123 หมู่ 1 นิคมอุตสาหกรรมอมตะซิตี้ ชลบุรี ตำบลดอนหัวฬ่อ อำเภอเมืองชลบุรี จังหวัดชลบุรี 20000', 'ap@coolair-mfg.example.co.th'],
    ['C-002', 'บริษัท อีสเทิร์น อิเล็คทริค จำกัด', 'customer', '0215558024681', '64/12 หมู่ 4 ตำบลแม่น้ำคู้ อำเภอปลวกแดง จังหวัดระยอง 21140', 'account@eastern-electric.example.co.th'],
    ['C-003', 'บริษัท โฮมสโตร์ เรนเจอร์ จำกัด', 'customer', '0105558034563', '99 ถนนฉลองกรุง แขวงลาดกระบัง เขตลาดกระบัง กรุงเทพมหานคร 10520', 'invoice@homestore-ranger.example.co.th'],
  ] as const) partners[code] = await call('POST', '/api/master-data/partners', { code, name, kind, taxId, branch: '00000', address, email: email ?? undefined });

  // QC plans before any goods receipt / production completion, so those events raise real inspections
  if (has('quality')) await business.seedQualityPlans(call, items).catch((e) => console.error('demo seed: quality plans failed —', e.message));

  // ---------------- inventory set-up ----------------
  if (has('inventory')) {
    for (const [code, name] of [['MAIN', 'คลังวัตถุดิบหลัก'], ['FG', 'คลังสินค้าสำเร็จรูป'], ['SPARE', 'คลังอะไหล่ซ่อมบำรุง']]) await call('POST', '/api/inventory/warehouses', { code, name });
    for (const [code, wh, min] of [['RM-SPCC-12', 'MAIN', 800], ['RM-SPCC-20', 'MAIN', 500], ['RM-SUS304', 'MAIN', 200], ['RM-PAINT-GR', 'MAIN', 60], ['SP-BOLT-M8', 'MAIN', 3000], ['SP-SEAL-HYD', 'SPARE', 4], ['SP-OIL-68', 'SPARE', 40], ['FG-BRK-100', 'MAIN', 300]] as const) {
      await call('PUT', '/api/inventory/reorder-points', { ...items[code], warehouseCode: wh, minQty: min });
    }
    // Opening balances carried over from the old Excel stock sheet. Production and sales below run through MAIN, and six months of
    // deliveries ship far more finished goods than this month's production orders make — without these the demo showed
    // FG-BRK-100 at −12,763 (plant-manager review). Amounts = what the seed delivers/consumes − what it produces + a working stock,
    // so every balance stays ≥ 0 (FG-BRK-100 also covers the 500 pcs a failed final inspection moves to QC-HOLD).
    const sold = (share: number, price: number) => SALES_BASE.reduce((sum, target) => sum + Math.round(target * share / price), 0);
    const opening: [string, number, number][] = [
      ['FG-BRK-100', sold(0.55, 48) + 1100 - 620 + 500 + 780, 31.5], // delivered − produced (500 + 120) + QC hold + working stock
      ['FG-CASE-01', sold(0.45, 690) + 150 - 18 + 170, 452],
      ['FG-RACK-08', 36 + 24, 980],
      ['SA-PLATE-A', 1240 - 1200 + 260, 14.2], // FG-BRK-100 uses 2 per piece (620 pcs) — the plate order makes 1,200
      ['FG-BRK-200', 120, 88],
    ];
    if (has('sales') || has('production')) {
      await call('POST', '/api/inventory/receipts', {
        warehouseCode: 'MAIN', refType: 'opening', refId: 'OPEN-2569', note: 'ยอดยกมาจากสต็อก Excel เดิม (ตรวจนับ ณ วันเริ่มใช้ระบบ)',
        lines: opening.map(([code, qty, unitCost]) => ({ ...items[code], qty, unitCost })),
      });
    }
  }

  // ---------------- purchasing: 6 months of buying ----------------
  if (has('purchasing')) {
    // segregation of duties (wave 8): the buyer raises the PO, the MD (admin) approves it, the store receives the goods
    const buyer = await loginAs('buyer@demo.co.th');
    const store = has('inventory') ? await loginAs('store@demo.co.th') : call;
    const buy = async (when: string, supplier: string, wh: string, lines: [string, number, number][], receive: boolean, approve = true) => {
      const po = await buyer('POST', '/api/purchasing/purchase-orders', {
        supplierId: partners[supplier].id, supplierName: partners[supplier].name, warehouseCode: wh, orderDate: notAfterToday(when),
        lines: lines.map(([c, qty, unitPrice]) => ({ ...items[c], qty, unitPrice })),
      });
      if (approve) await call('POST', `/api/purchasing/purchase-orders/${po.id}/approve`);
      // C8: the supplier's tax invoice came with the goods (number/date/tax ID → the purchase VAT register)
      if (receive) {
        // dated when the goods came (not the day the seed runs), so each month's ภาษีซื้อ lands in that month's ภ.พ.30
        await store('POST', `/api/purchasing/purchase-orders/${po.id}/receive`, {
          receivedDate: notAfterToday(when),
          supplierInvoiceNo: `IV${String(po.no).slice(-7).replace('-', '')}`, supplierInvoiceDate: notAfterToday(when),
          ...(partners[supplier].tax_id ? { supplierTaxId: partners[supplier].tax_id, supplierBranch: '00000' } : {}),
        });
      }
      return po;
    };
    for (let m = 5; m >= 1; m--) {
      await buy(monthsAgo(m, 5), 'S-001', 'MAIN', [['RM-SPCC-12', 1500 + m * 120, 31.8 + m * 0.2], ['RM-SPCC-20', 900, 33.1]], true);
      await buy(monthsAgo(m, 18), 'S-002', 'MAIN', [['RM-SUS304', 300 + m * 20, 116 + m]], true);
    }
    await buy(monthsAgo(0, 3), 'S-001', 'MAIN', [['RM-SPCC-12', 1800, 32.5], ['RM-PAINT-GR', 120, 165], ['SP-BOLT-M8', 8000, 1.2], ['RM-ZINC', 60, 89]], true);
    await buy(monthsAgo(0, 4), 'S-003', 'SPARE', [['SP-SEAL-HYD', 6, 850], ['SP-OIL-68', 80, 95], ['SP-BELT-B52', 4, 420]], true);
    await buy(monthsAgo(0, 8), 'S-002', 'MAIN', [['RM-SUS304', 250, 118]], false);
    await buy(monthsAgo(0, 9), 'S-001', 'MAIN', [['RM-SPCC-20', 600, 33.8]], false, false);
    await settle();
  }

  // ---------------- production ----------------
  if (has('production')) {
    await call('PUT', '/api/production/boms', { ...items['SA-PLATE-A'], lines: [{ ...items['RM-SPCC-12'], qty: 0.42, scrapPct: 4 }, { ...items['RM-ZINC'], qty: 0.01 }] });
    await call('PUT', '/api/production/boms', { ...items['FG-BRK-100'], lines: [{ ...items['SA-PLATE-A'], qty: 2 }, { ...items['SP-BOLT-M8'], qty: 4 }, { ...items['RM-PAINT-GR'], qty: 0.03 }] });
    await call('PUT', '/api/production/boms', { ...items['FG-BRK-200'], lines: [{ ...items['RM-SUS304'], qty: 0.65, scrapPct: 5 }, { ...items['SP-BOLT-M8'], qty: 4 }] });
    await call('PUT', '/api/production/boms', { ...items['FG-CASE-01'], lines: [{ ...items['RM-SPCC-20'], qty: 6.4, scrapPct: 6 }, { ...items['RM-PAINT-GR'], qty: 0.25 }, { ...items['SP-BOLT-M8'], qty: 12 }] });
    const mo = async (code: string, qty: number, due: string, stage: 'planned' | 'released' | 'completed', partial = 0) => {
      const o = await call('POST', '/api/production/orders', { ...items[code], qty, warehouseCode: 'MAIN', dueDate: due });
      if (stage === 'planned') return;
      await call('POST', `/api/production/orders/${o.id}/release`);
      if (stage === 'completed') await call('POST', `/api/production/orders/${o.id}/complete`, {});
      else if (partial) await call('POST', `/api/production/orders/${o.id}/complete`, { qty: partial });
    };
    await mo('SA-PLATE-A', 1200, monthsAgo(0, 2), 'completed');
    await mo('FG-BRK-100', 500, monthsAgo(0, 4), 'completed');
    await mo('FG-BRK-200', 150, monthsAgo(0, 6), 'completed');
    await mo('FG-CASE-01', 40, monthsAgo(0, 10), 'released', 18);
    await mo('FG-BRK-100', 400, monthsAgo(0, 14), 'released', 120);
    await mo('FG-BRK-200', 200, monthsAgo(0, 20), 'planned');
    await mo('FG-CASE-01', 60, monthsAgo(0, 25), 'planned');
    await settle();
  }

  // ---------------- sales: 6 months of invoices ----------------
  if (has('sales')) {
    // credit terms: คูลแอร์ / โฮมสโตร์ 30 days, อีสเทิร์น อิเล็คทริค 60 days — invoices fall due over time, so receivables age into buckets
    const creditDays: Record<string, number> = { 'C-001': 30, 'C-002': 60, 'C-003': 30 };
    const sell = async (date: string, customer: string, lines: [string, number, number][], stage: 'draft' | 'confirmed' | 'delivered' | 'invoiced') => {
      const when = notAfterToday(date);
      const so = await call('POST', '/api/sales/orders', {
        customerId: partners[customer].id, customerName: partners[customer].name, customerAddress: partners[customer].address, orderDate: when, warehouseCode: 'MAIN',
        customerTaxId: partners[customer].tax_id ?? undefined, customerBranch: '00000', customerEmail: partners[customer].email ?? undefined,
        creditDays: creditDays[customer],
        lines: lines.map(([c, qty, unitPrice]) => ({ ...items[c], qty, unitPrice })),
      });
      if (stage === 'draft') return;
      await call('POST', `/api/sales/orders/${so.id}/confirm`);
      if (stage === 'confirmed') return;
      await call('POST', `/api/sales/orders/${so.id}/deliver`);
      if (stage === 'invoiced') await call('POST', `/api/sales/orders/${so.id}/invoice`, { issueDate: when });
    };
    for (let m = 5; m >= 1; m--) {
      const target = SALES_BASE[5 - m];
      await sell(monthsAgo(m, 15), 'C-001', [['FG-BRK-100', Math.round(target * 0.55 / 48), 48]], 'invoiced');
      await sell(monthsAgo(m, 24), 'C-002', [['FG-CASE-01', Math.round(target * 0.45 / 690), 690]], 'invoiced');
    }
    await sell(monthsAgo(0, 2), 'C-002', [['FG-CASE-01', 150, 690]], 'invoiced');
    await sell(monthsAgo(0, 4), 'C-003', [['FG-RACK-08', 30, 1450]], 'invoiced');
    await sell(monthsAgo(0, 6), 'C-001', [['FG-BRK-100', 1100, 48]], 'invoiced');
    await sell(monthsAgo(0, 7), 'C-003', [['FG-BRK-200', 80, 135], ['FG-RACK-08', 6, 1450]], 'delivered');
    await sell(monthsAgo(0, 8), 'C-002', [['FG-CASE-01', 12, 690]], 'confirmed');
    await sell(monthsAgo(0, 9), 'C-001', [['FG-BRK-100', 400, 47]], 'draft');
    await settle();
  }

  // ---------------- maintenance: the 3D floor ----------------
  if (has('maintenance')) {
    const machines: Record<string, any> = {};
    for (const [code, name, location] of [
      ['PRESS-01', 'เครื่องปั๊ม 80 ตัน', 'ไลน์ปั๊มขึ้นรูป'], ['PRESS-02', 'เครื่องปั๊ม 110 ตัน', 'ไลน์ปั๊มขึ้นรูป'], ['PRESS-03', 'เครื่องปั๊ม 200 ตัน', 'ไลน์ปั๊มขึ้นรูป'],
      ['BEND-01', 'เครื่องพับ CNC', 'ไลน์ปั๊มขึ้นรูป'], ['LASER-01', 'เครื่องตัดเลเซอร์ไฟเบอร์', 'ไลน์ตัด'], ['SHEAR-01', 'เครื่องตัดเฉือน', 'ไลน์ตัด'],
      ['WELD-01', 'หุ่นยนต์เชื่อม', 'ไลน์เชื่อมและพ่นสี'], ['PAINT-01', 'ตู้พ่นสีฝุ่น', 'ไลน์เชื่อมและพ่นสี'], ['OVEN-01', 'เตาอบสี', 'ไลน์เชื่อมและพ่นสี'],
    ] as const) machines[code] = await call('POST', '/api/maintenance/machines', { code, name, location });
    const wo1 = await call('POST', '/api/maintenance/work-orders', { machineId: machines['PRESS-02'].id, title: 'น้ำมันไฮดรอลิกรั่วที่กระบอกสูบ' });
    await call('POST', `/api/maintenance/work-orders/${wo1.id}/start`);
    await call('POST', '/api/maintenance/work-orders', { machineId: machines['OVEN-01'].id, title: 'อุณหภูมิไม่ถึง 180°C', description: 'ฮีตเตอร์ฝั่งซ้ายไม่ร้อน' });
    const wo3 = await call('POST', '/api/maintenance/work-orders', { machineId: machines['LASER-01'].id, title: 'เลนส์สกปรก ตัดไม่ขาด' });
    await call('POST', `/api/maintenance/work-orders/${wo3.id}/complete`, { resolution: 'ทำความสะอาดเลนส์ เปลี่ยนหัวฉีด', downtimeMinutes: 75, warehouseCode: 'SPARE', parts: [] });
    const wo4 = await call('POST', '/api/maintenance/work-orders', { machineId: machines['PRESS-01'].id, title: 'สายพานลื่น เสียงดัง' });
    await call('POST', `/api/maintenance/work-orders/${wo4.id}/complete`, { resolution: 'เปลี่ยนสายพาน B52', downtimeMinutes: 40, warehouseCode: 'SPARE', parts: [{ ...items['SP-BELT-B52'], qty: 1 }] });
    for (const [code, title, days, first] of [
      ['PRESS-01', 'เปลี่ยนน้ำมันไฮดรอลิก', 90, monthsAgo(0, 1)], ['PRESS-03', 'ตรวจเช็คคลัตช์และเบรก', 30, monthsAgo(0, 2)],
      ['LASER-01', 'ทำความสะอาดชุดออปติก', 14, monthsAgo(-1, 3)], ['PAINT-01', 'เปลี่ยนไส้กรองตู้พ่นสี', 30, monthsAgo(-1, 10)],
    ] as const) await call('POST', '/api/maintenance/pm-plans', { machineId: machines[code].id, title, intervalDays: days, firstDueOn: first });
    await call('POST', '/api/maintenance/pm-plans/generate', { asOf: new Date().toISOString().slice(0, 10) });
  }

  if (has('costing')) {
    await settle();
    await call('POST', '/api/costing/cost-sheets', {
      ...items['FG-BRK-100'], qty: 1000, laborHours: 22, laborRatePerHour: 85, overheadPct: 18,
      materials: [{ ...items['RM-SPCC-12'], qty: 870 }, { ...items['SP-BOLT-M8'], qty: 4000 }, { ...items['RM-PAINT-GR'], qty: 30 }],
    }).catch(() => undefined);
  }

  // office & service modules: HR, approvals, expense, booking, CRM, helpdesk, projects, assets, QC results
  await business.seedBusiness({ call, loginAs, has, modules, items, partners });

  await settle();
  // from now on (the visitor's own goods receipts) lots waiting for incoming QC sit in QC-HOLD until they pass
  if (has('inventory') && has('quality')) await call('PUT', '/api/inventory/settings', { receiveIntoHoldWhenInspected: true });
  if (has('maintenance') && has('inventory')) await call('PUT', '/api/maintenance/settings', { defaultPartsWarehouse: 'SPARE' });
  return { tenant, email, password, created: true };
}

export const demoId = () => randomUUID();
