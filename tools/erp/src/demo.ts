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
  const dbs = await ensureDatabases(opts.prefix ?? 'demo', defs.map((d) => d.manifest.id), !!opts.reset);
  const services: Record<string, Service> = {};
  const urls: Record<string, string> = {};
  let port = opts.basePort ?? 4100;
  for (const def of defs) {
    const env = {
      DATABASE_URL: dbs[def.manifest.id], JWT_SECRET: jwtSecret, INTERNAL_TOKEN: internalToken, NODE_ENV: 'development',
      EVENT_ROUTER_URL: `http://127.0.0.1:${gatewayPort}/_events/publish`, EVENT_DISPATCH_MS: '400', PROMPTPAY_ID: '0105536000313', ...opts.env,
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

const monthsAgo = (n: number, day = 12) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  d.setDate(Math.min(day, 28));
  return d.toISOString().slice(0, 10);
};

export interface SeedResult { tenant: string; email: string; password: string; created: boolean }

/** Create company `demo` with a believable month of factory activity. Idempotent: does nothing if it exists. */
export async function seedDemo(stack: DemoStack, opts: { tenant?: string; installed?: string[] } = {}): Promise<SeedResult> {
  const tenant = opts.tenant ?? 'demo';
  const email = 'admin@demo.co.th', password = 'demo1234';
  const has = (m: string) => (opts.installed ?? Object.keys(stack.services)).includes(m);
  const prov = await fetch(`${stack.urls.identity}/tenants`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': stack.internalToken },
    body: JSON.stringify({ code: tenant, name: 'บริษัท สยามพาร์ท เมทัลเวิร์ค จำกัด', admin: { email, name: 'คุณสมศักดิ์ (ผู้จัดการโรงงาน)', password } }),
  });
  if (prov.status === 409) return { tenant, email, password, created: false };
  if (!prov.ok) throw new Error(`provision failed: ${await prov.text()}`);
  const login = await (await fetch(`${stack.gatewayUrl}/api/identity/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenant, email, password }),
  })).json();
  const call = client(stack.gatewayUrl, login.token);
  const settle = () => new Promise((r) => setTimeout(r, 1500));

  // rules first, so they fire on everything below (the bell then shows real notifications)
  if (has('automation')) {
    const { seedAutomation } = await import('./demo-automation.ts');
    await seedAutomation(call);
  }

  // ---------------- people & roles ----------------
  const roles: Record<string, string> = {};
  for (const [name, permissions] of [
    ['พนักงานคลัง', ['inventory.*', 'master.item.read']],
    ['จัดซื้อ', ['purchasing.*', 'master.*', 'inventory.stock.read']],
    ['ฝ่ายขาย', ['sales.*', 'master.*', 'inventory.stock.read']],
    ['ช่างซ่อมบำรุง', ['maintenance.*', 'master.item.read', 'inventory.stock.read']],
    ['วางแผนการผลิต', ['production.*', 'master.item.read', 'inventory.stock.read', 'costing.cost.read']],
  ] as const) roles[name] = (await call('POST', '/api/identity/roles', { name, permissions })).id;
  for (const [mail, name, role] of [
    ['store@demo.co.th', 'สมชาย คลังดี', 'พนักงานคลัง'], ['buyer@demo.co.th', 'วิไลวรรณ จัดซื้อ', 'จัดซื้อ'],
    ['sales@demo.co.th', 'ปิยะพงษ์ ขายเก่ง', 'ฝ่ายขาย'], ['tech@demo.co.th', 'ประเสริฐ ช่างใหญ่', 'ช่างซ่อมบำรุง'],
    ['plan@demo.co.th', 'กมลชนก วางแผน', 'วางแผนการผลิต'],
  ] as const) await call('POST', '/api/identity/users', { email: mail, name, password: 'demo1234', roleIds: [roles[role]] });

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
  for (const [code, name, kind, taxId, address] of [
    ['S-001', 'บริษัท สยามเหล็กกล้า จำกัด', 'supplier', '0105536000313', 'นิคมอุตสาหกรรมบางปู สมุทรปราการ'],
    ['S-002', 'บริษัท ไทยสแตนเลส ซัพพลาย จำกัด', 'supplier', null, 'บางนา กรุงเทพฯ'],
    ['S-003', 'หจก. ช่างไทยอะไหล่', 'supplier', null, 'พระประแดง สมุทรปราการ'],
    ['C-001', 'บริษัท คูลแอร์ แมนูแฟคเจอริ่ง จำกัด', 'customer', null, 'อมตะนคร ชลบุรี'],
    ['C-002', 'บริษัท อีสเทิร์น อิเล็คทริค จำกัด', 'customer', null, 'ปลวกแดง ระยอง'],
    ['C-003', 'บริษัท โฮมสโตร์ เรนเจอร์ จำกัด', 'customer', null, 'ลาดกระบัง กรุงเทพฯ'],
  ] as const) partners[code] = await call('POST', '/api/master-data/partners', { code, name, kind, taxId: taxId ?? undefined, address });

  // ---------------- inventory set-up ----------------
  if (has('inventory')) {
    for (const [code, name] of [['MAIN', 'คลังวัตถุดิบหลัก'], ['FG', 'คลังสินค้าสำเร็จรูป'], ['SPARE', 'คลังอะไหล่ซ่อมบำรุง']]) await call('POST', '/api/inventory/warehouses', { code, name });
    for (const [code, wh, min] of [['RM-SPCC-12', 'MAIN', 800], ['RM-SPCC-20', 'MAIN', 500], ['RM-SUS304', 'MAIN', 200], ['RM-PAINT-GR', 'MAIN', 60], ['SP-BOLT-M8', 'MAIN', 3000], ['SP-SEAL-HYD', 'SPARE', 4], ['SP-OIL-68', 'SPARE', 40], ['FG-BRK-100', 'FG', 300]] as const) {
      await call('PUT', '/api/inventory/reorder-points', { ...items[code], warehouseCode: wh, minQty: min });
    }
  }

  // ---------------- purchasing: 6 months of buying ----------------
  if (has('purchasing')) {
    const buy = async (when: string, supplier: string, wh: string, lines: [string, number, number][], receive: boolean, approve = true) => {
      const po = await call('POST', '/api/purchasing/purchase-orders', {
        supplierId: partners[supplier].id, supplierName: partners[supplier].name, warehouseCode: wh, orderDate: when,
        lines: lines.map(([c, qty, unitPrice]) => ({ ...items[c], qty, unitPrice })),
      });
      if (approve) await call('POST', `/api/purchasing/purchase-orders/${po.id}/approve`);
      if (receive) await call('POST', `/api/purchasing/purchase-orders/${po.id}/receive`, {});
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
    const sell = async (when: string, customer: string, lines: [string, number, number][], stage: 'draft' | 'confirmed' | 'delivered' | 'invoiced') => {
      const so = await call('POST', '/api/sales/orders', {
        customerId: partners[customer].id, customerName: partners[customer].name, customerAddress: partners[customer].address, orderDate: when, warehouseCode: 'MAIN',
        lines: lines.map(([c, qty, unitPrice]) => ({ ...items[c], qty, unitPrice })),
      });
      if (stage === 'draft') return;
      await call('POST', `/api/sales/orders/${so.id}/confirm`);
      if (stage === 'confirmed') return;
      await call('POST', `/api/sales/orders/${so.id}/deliver`);
      if (stage === 'invoiced') await call('POST', `/api/sales/orders/${so.id}/invoice`, { issueDate: when });
    };
    const base = [182000, 205000, 198000, 236000, 251000];
    for (let m = 5; m >= 1; m--) {
      const target = base[5 - m];
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

  await settle();
  return { tenant, email, password, created: true };
}

export const demoId = () => randomUUID();
