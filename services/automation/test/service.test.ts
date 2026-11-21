import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { DECISION_RESULTS, definition } from '../src/service.ts';
import { isPrivateAddress, describe as sentence, matches, render, resolvesPrivate, webhookProblem } from '../src/engine.ts';
import { EVENTS, TEMPLATES } from '../src/catalog.ts';
import { events, isKnownEvent, parseEvent, type EventType } from '@erp/contracts';
import manifestJson from '../module.json' with { type: 'json' };

let t: TestService;
let server: Server;
const received: { path: string; headers: Record<string, unknown>; body: any }[] = [];
let base = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { received.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(raw || '{}') }); res.writeHead(req.url?.includes('fail') ? 500 : 200).end('{}'); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t = await bootTestService(definition, { LINE_CHANNEL_ACCESS_TOKEN: 'line-token', LINE_API_URL: base, AUTOMATION_ALLOW_PRIVATE_WEBHOOKS: '1', WEBHOOK_SECRET: 'shh' });
});
afterAll(async () => { await t?.close(); server?.close(); });

const lowStock = (onHand: number) => ({ itemId: randomUUID(), itemCode: 'RM-STEEL', itemName: 'เหล็ก', warehouseCode: 'MAIN', onHand, minQty: 100 });

describe('engine', () => {
  it('matches conditions, renders Thai messages, describes rules as sentences', () => {
    expect(matches([{ field: 'gross', op: 'gt', value: 50000 }], { gross: 60000 })).toBe(true);
    expect(matches([{ field: 'gross', op: 'gt', value: 50000 }], { gross: 100 })).toBe(false);
    expect(matches([{ field: 'title', op: 'contains', value: 'น้ำมัน' }], { title: 'น้ำมันรั่ว' })).toBe(true);
    expect(render('{{itemCode}} เหลือ {{onHand}} ({{nope}})', { itemCode: 'A', onHand: 1234.5 })).toBe('A เหลือ 1,234.5 (-)');
    expect(sentence({ event_type: 'purchasing.po_created', conditions: [{ field: 'gross', op: 'gt', value: 50000 }], actions: [{ type: 'notify' }, { type: 'line' }] }))
      .toBe('เมื่อสร้างใบสั่งซื้อใหม่ ถ้า ยอดรวม > 50,000 ให้แจ้งเตือนในแอป + ส่ง LINE');
  });

  it('refuses webhooks into private networks unless allowed', () => {
    expect(webhookProblem('https://hooks.example.com/x', {})).toBeNull();
    expect(webhookProblem('http://hooks.example.com/x', {})).toMatch(/https/);
    for (const u of ['https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.10/x', 'https://172.20.0.1/x', 'https://169.254.169.254/latest', 'https://db.internal/x']) {
      expect(webhookProblem(u, {}), u).toMatch(/ภายในเครือข่าย/);
    }
  });

  it('SEC-06 (security review 0.3): blocks encoded / IPv6 / CGNAT addresses and names that resolve inside the network', async () => {
    for (const u of ['https://[::ffff:127.0.0.1]/x', 'https://[::ffff:7f00:1]/x', 'https://[::]/x', 'https://[fe80::1]/x', 'https://2130706433/x', 'https://0x7f.1/x',
      'https://100.64.1.1/x', 'https://gateway/x', 'https://router.lan/x', 'https://user:pw@hooks.example.com/x']) {
      expect(webhookProblem(u, {}), u).not.toBeNull();
    }
    expect(webhookProblem('https://[2606:4700::1111]/x', {})).toBeNull();
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('172.31.255.1')).toBe(true);
    const dns = (ips: string[]) => async () => ips.map((address) => ({ address }));
    expect(await resolvesPrivate('hooks.example.com', dns(['93.184.216.34']))).toBeNull();
    expect(await resolvesPrivate('evil.example.com', dns(['93.184.216.34', '10.0.0.5']))).toMatch(/ภายใน/);
    expect(await resolvesPrivate('rebind.example.com', dns(['::ffff:169.254.169.254']))).toMatch(/ภายใน/);
    expect(await resolvesPrivate('nx.example.com', async () => { throw new Error('ENOTFOUND'); })).toMatch(/DNS/);
  });
});

describe('automation service', () => {
  it('lists templates and applies one with a click', async () => {
    const list = await t.api('GET', '/templates');
    expect(list.body.length).toBeGreaterThanOrEqual(6);
    expect(list.body.find((x: any) => x.id === 'low-stock-alert')).toMatchObject({ module: 'inventory', applied: false, summary: 'เมื่อสต็อกต่ำกว่าจุดสั่งซื้อ ให้แจ้งเตือนในแอป' });
    const r = await t.api('POST', '/templates/low-stock-alert/apply', {});
    expect(r.status).toBe(201);
    expect((await t.api('GET', '/templates')).body.find((x: any) => x.id === 'low-stock-alert').applied).toBe(true);
  });

  it('turns an event into an in-app notification with a link', async () => {
    expect((await t.deliver('inventory.low_stock', lowStock(40))).body.status).toBe('handled');
    const n = await t.api('GET', '/notifications?unread=true');
    expect(n.body.unread).toBe(1);
    expect(n.body.items[0]).toMatchObject({ title: 'เตือนของใกล้หมด', level: 'warn', body: 'RM-STEEL เหล็ก ที่คลัง MAIN เหลือ 40 ต่ำกว่าจุดสั่งซื้อ 100' });
    expect(n.body.items[0].link).toMatch(/^\/m\/inventory\/stockCard\//);
    await t.api('POST', `/notifications/${n.body.items[0].id}/read`);
    expect((await t.api('GET', '/notifications?unread=true')).body.unread).toBe(0);
  });

  it('checks conditions before acting', async () => {
    const rule = await t.api('POST', '/rules/simple', { name: 'PO ใหญ่', eventType: 'purchasing.po_created', conditionField: 'gross', conditionOp: 'gt', conditionValue: '50000', actionType: 'notify', message: 'PO {{poNo}} {{gross}} บาท' });
    expect(rule.status).toBe(201);
    expect(rule.body.summary).toBe('เมื่อสร้างใบสั่งซื้อใหม่ ถ้า ยอดรวม > 50,000 ให้แจ้งเตือนในแอป');
    await t.deliver('purchasing.po_created', { poId: randomUUID(), poNo: 'PO-1', supplierName: 'S', gross: 1200 });
    await t.deliver('purchasing.po_created', { poId: randomUUID(), poNo: 'PO-2', supplierName: 'S', gross: 75000 });
    const items = (await t.api('GET', '/notifications')).body.items.filter((x: any) => x.title === 'PO ใหญ่');
    expect(items.map((x: any) => x.body)).toEqual(['PO PO-2 75,000 บาท']);
    const test = await t.api('POST', `/rules/${rule.body.id}/test`, { data: { poNo: 'X', gross: 10 } });
    expect(test.body).toMatchObject({ matched: false, messages: [{ type: 'notify', text: 'PO X 10 บาท' }] });
  });

  it('pushes to LINE and signed webhooks, and records failures without retry storms', async () => {
    await t.api('POST', '/rules', { name: 'เครื่องเสีย', eventType: 'maintenance.breakdown_reported', actions: [{ type: 'line', target: 'Cgroup123' }, { type: 'webhook', target: `${base}/hook` }] });
    await t.api('POST', '/rules', { name: 'webhook พัง', eventType: 'maintenance.breakdown_reported', actions: [{ type: 'webhook', target: `${base}/fail` }] });
    const r = await t.deliver('maintenance.breakdown_reported', { workOrderId: randomUUID(), workOrderNo: 'WO-1', machineId: randomUUID(), machineCode: 'PRESS-01', machineName: 'ปั๊ม', title: 'น้ำมันรั่ว', description: null });
    expect(r.status).toBe(200); // a failed delivery never makes the event fail
    const line = received.find((x) => x.path === '/v2/bot/message/push')!;
    expect(line.headers.authorization).toBe('Bearer line-token');
    expect(line.body).toMatchObject({ to: 'Cgroup123', messages: [{ type: 'text', text: expect.stringContaining('เครื่อง PRESS-01 ปั๊ม เสีย: น้ำมันรั่ว (WO-1)') }] });
    const hook = received.find((x) => x.path === '/hook')!;
    expect(hook.body).toMatchObject({ rule: 'เครื่องเสีย', event: 'maintenance.breakdown_reported' });
    expect(hook.headers['x-erp-signature']).toMatch(/^[0-9a-f]{64}$/);
    const runs = (await t.api('GET', '/runs')).body;
    expect(runs.find((x: any) => x.rule_name === 'webhook พัง')).toMatchObject({ status: 'failed', detail: expect.stringContaining('HTTP 500') });
    expect(runs.find((x: any) => x.rule_name === 'เครื่องเสีย')).toMatchObject({ status: 'done' });
  });

  it('validates rules', async () => {
    expect((await t.api('POST', '/rules/simple', { name: 'x', eventType: 'nope.event' })).status).toBe(400);
    expect((await t.api('POST', '/rules/simple', { name: 'x', eventType: 'inventory.low_stock', conditionField: 'price', conditionOp: 'gt', conditionValue: 1 })).body.error.message).toMatch(/ไม่ใช่ข้อมูลของเหตุการณ์/);
    expect((await t.api('POST', '/rules/simple', { name: 'x', eventType: 'inventory.low_stock', conditionField: 'itemCode', conditionOp: 'gt', conditionValue: 1 })).body.error.message).toMatch(/ไม่ใช่ตัวเลข/);
    expect((await t.api('POST', '/rules/simple', { name: 'x', eventType: 'inventory.low_stock', actionType: 'line' })).status).toBe(400);
  });

  it('can pause a rule, and respects permissions and tenants', async () => {
    const rules = (await t.api('GET', '/rules')).body;
    const low = rules.find((r: any) => r.template_id === 'low-stock-alert');
    await t.api('POST', `/rules/${low.id}/disable`);
    await t.api('POST', '/notifications/read-all');
    await t.deliver('inventory.low_stock', lowStock(10));
    expect((await t.api('GET', '/notifications?unread=true')).body.unread).toBe(0);
    expect((await t.api('POST', '/templates/big-sale/apply', {}, { token: t.token(['automation.rule.read']) })).status).toBe(403);
    expect((await t.api('GET', '/rules', undefined, { token: t.token(['*'], t.otherTenantId) })).body).toEqual([]);
    const sum = await t.api('GET', '/summary');
    expect(sum.body.activeRules).toBe(3);
    expect((await t.api('DELETE', `/rules/${low.id}`)).body.deleted).toBe(low.id);
  });
});

describe('notification links', () => {
  it('encodes event values so they cannot redirect elsewhere', async () => {
    const { renderLink } = await import('../src/engine.ts');
    expect(renderLink('/m/inventory/stockCard/{{itemId}}', { itemId: 'abc' })).toBe('/m/inventory/stockCard/abc');
    expect(renderLink('/m/inventory/stockCard/{{itemId}}', { itemId: '../../x?y=//evil.com' })).toBe('/m/inventory/stockCard/..%2F..%2Fx%3Fy%3D%2F%2Fevil.com');
    expect(renderLink('{{u}}', { u: '//evil.com' })).toBeNull();
    expect(renderLink('/m/x/{{missing}}', {})).toBeNull();
  });
});

/** One valid payload per office/service event (checked against @erp/contracts). */
const uuid = () => randomUUID();
const SAMPLES: Partial<Record<EventType, Record<string, unknown>>> = {
  'approvals.request_submitted': { requestId: uuid(), no: 'APV-2569-0007', title: 'ซื้อโน้ตบุ๊ก', typeName: 'ขอซื้อ', requesterName: 'สมชาย', amount: 32000, nextApproverId: uuid(), nextApproverName: 'คุณวิภา', step: 1, stepCount: 2, requesterId: uuid() },
  'approvals.request_decided': { requestId: uuid(), no: 'APV-2569-0007', title: 'ซื้อโน้ตบุ๊ก', decision: 'rejected', requesterId: uuid(), requesterName: 'สมชาย', byName: 'คุณวิภา', note: 'งบหมด' },
  'expense.claim_submitted': { claimId: uuid(), no: 'EXP-2569-0003', claimantName: 'มาลี', total: 4200, overLimit: true, claimantId: uuid() },
  'expense.claim_paid': { claimId: uuid(), no: 'EXP-2569-0003', claimantName: 'มาลี', total: 4200, claimantId: uuid() },
  'hr.leave_requested': { leaveId: uuid(), no: 'LV-2569-0004', employeeName: 'นายสมชาย ใจดี', typeName: 'ลาพักร้อน', from: '2026-10-12', to: '2026-10-14', days: 3,
    employeeUserId: uuid(), approverUserId: uuid(), approverName: 'คุณวิชัย' },
  'hr.leave_decided': { leaveId: uuid(), no: 'LV-2569-0004', employeeName: 'นายสมชาย ใจดี', typeName: 'ลาพักร้อน', decision: 'approved', employeeUserId: uuid(), byName: 'คุณวิชัย', note: 'เที่ยวให้สนุก' },
  'helpdesk.ticket_created': { ticketId: uuid(), no: 'TK-2569-0010', title: 'อินเทอร์เน็ตล่มทั้งชั้น', priority: 'urgent', categoryName: 'ไอที', requesterName: 'คุณบี', assigneeName: 'ช่างเอก' },
  'helpdesk.ticket_resolved': { ticketId: uuid(), no: 'TK-2569-0010', title: 'อินเทอร์เน็ตล่มทั้งชั้น', requesterName: 'คุณบี', resolution: 'รีสตาร์ทสวิตช์', requesterUserId: uuid() },
  'crm.lead_created': { leadId: uuid(), no: 'LD-2569-0021', company: 'บริษัท สยามพาร์ท จำกัด', contactName: 'คุณเอ', source: 'line' },
  'crm.quotation_accepted': { quotationId: uuid(), no: 'QT-2569-0005', customerName: 'บริษัท สยามพาร์ท จำกัด', total: 107000 },
  'quality.inspection_completed': { inspectionId: uuid(), no: 'QC-2569-0009', stage: 'incoming', itemCode: 'RM-STEEL', itemName: 'เหล็กแผ่น', lotNo: 'L-01', result: 'fail', rejectedQty: 55 },
  'quality.ncr_raised': { ncrId: uuid(), no: 'NCR-2569-0002', severity: 'critical', itemCode: 'FG-BRACKET', description: 'ลูกค้าร้องเรียนขายึดบิดงอ' },
  'booking.requested': { bookingId: uuid(), no: 'BK-2569-0011', resourceName: 'รถตู้', startAt: '2026-10-05T01:00:00.000Z', endAt: '2026-10-05T09:00:00.000Z', requesterName: 'อลิส', needsApproval: true, period: 'จ. 5 ต.ค. 08:00–16:00', purpose: 'ไปพบลูกค้าระยอง', requesterId: uuid() },
  'assets.repair_reported': { assetId: uuid(), code: 'AS-2569-0003', name: 'โน้ตบุ๊ก Dell', description: 'จอไม่ติด' },
  'contracts.visit_due': { visitId: uuid(), no: 'PMV-2569-0004', contractId: uuid(), contractNo: 'MA-2569-0002', customerId: uuid(), customerName: 'บริษัท สยามพาร์ท จำกัด',
    dueDate: '2026-10-20', scheduledDate: '2026-10-21', technicianId: uuid(), technicianName: 'ช่างเอก', itemsText: 'CCTV 32 จุด (อาคาร A)', coverage: '8x5' },
  'contracts.contract_expiring': { contractId: uuid(), no: 'MA-2569-0001', customerId: null, customerName: 'บริษัท ไทยแพ็ค จำกัด', title: 'MA ระบบเครือข่าย', endDate: '2026-11-30', daysLeft: 45, value: 120000 },
  'sales.payment_received': { receiptId: uuid(), receiptNo: 'RC-2569-0007', kind: 'payment', customerId: null, customerName: 'บริษัท สยามพาร์ท จำกัด', method: 'transfer',
    total: 10700, whtAmount: 300, depositApplied: 0, received: 10400, invoices: [{ invoiceId: uuid(), invoiceNo: 'INV-2569-0003', amount: 10700, outstanding: 0 }] },
  'payroll.run_paid': { runId: uuid(), no: 'PR-2569-10', period: '2026-10', payDate: '2026-10-31', paidDate: '2026-10-30', headcount: 12,
    totals: { gross: 300000, salary: 290000, overtime: 10000, allowances: 0, bonus: 0, otherIncome: 0, unpaidLeave: 0, ssoEmployee: 9000, ssoEmployer: 9000, pvdEmployee: 0, pvdEmployer: 0,
      wht: 6000, otherDeductions: 0, totalDeductions: 15000, net: 285000 },
    postings: [{ category: 'salary_expense', side: 'debit', amount: 290000 }, { category: 'overtime_expense', side: 'debit', amount: 10000 },
      { category: 'sso_employer_expense', side: 'debit', amount: 9000 }, { category: 'sso_payable', side: 'credit', amount: 18000 },
      { category: 'wht_payable', side: 'credit', amount: 6000 }, { category: 'net_pay_payable', side: 'credit', amount: 285000 }] },
  'hr.employee_upserted': { employeeId: uuid(), code: 'EMP-014', name: 'นางสาวมาลี ใจงาม', departmentName: 'บัญชี', positionName: 'เจ้าหน้าที่บัญชี', status: 'active',
    startDate: '2026-10-01', resignedDate: null, userId: uuid() },
};

describe('event catalogue and templates', () => {
  it('lists exactly the subscribed events, all known to @erp/contracts, with fields that exist in the payload', () => {
    // + the answers to LINE decisions, which are not rule triggers
    expect([...EVENTS.map((e) => e.type), ...DECISION_RESULTS].sort()).toEqual([...manifestJson.subscribes].sort());
    for (const e of EVENTS) {
      expect(isKnownEvent(e.type), e.type).toBe(true);
      expect(manifestJson.enhancedBy, e.type).toContain(e.module);
      expect(e.link, e.type).toMatch(new RegExp(`^/m/${e.module}/\\w+/\\{\\{\\w+\\}\\}$`));
    }
    for (const [type, data] of Object.entries(SAMPLES)) {
      const ev = EVENTS.find((e) => e.type === type)!;
      expect(ev, type).toBeTruthy();
      expect(() => parseEvent(type as EventType, data), type).not.toThrow();
      for (const f of ev.fields) expect(Object.keys(data), `${type}.${f.key}`).toContain(f.key);
      for (const f of ev.fields.filter((x) => x.numeric)) expect(typeof data[f.key], `${type}.${f.key}`).toBe('number');
      expect(render(ev.message, data), type).not.toMatch(/\{\{|(^| )-( |$)/);
    }
  });

  it('ships 28 templates, every one valid and appliable with a click', async () => {
    expect(TEMPLATES).toHaveLength(28);
    expect(new Set(TEMPLATES.map((x) => x.id)).size).toBe(TEMPLATES.length);
    const other = t.token(['*'], t.otherTenantId);
    for (const tpl of TEMPLATES) {
      const ev = EVENTS.find((e) => e.type === tpl.eventType)!;
      for (const c of tpl.conditions) expect(ev.fields.map((f) => f.key), `${tpl.id}: ${c.field}`).toContain(c.field);
      // personal recipients point at user-id fields the event declares and the contract carries
      for (const a of tpl.actions.filter((x) => x.to?.startsWith('field:'))) {
        for (const f of a.to!.slice(6).split(',')) {
          expect(ev.userFields?.map((x) => x.key), `${tpl.id}: ${f}`).toContain(f);
          expect(Object.keys((events as any)[tpl.eventType].shape), `${tpl.id}: ${f}`).toContain(f);
        }
      }
      const r = await t.api('POST', `/templates/${tpl.id}/apply`, {}, { token: other });
      expect(r.status, tpl.id).toBe(201);
    }
    const list = (await t.api('GET', '/templates', undefined, { token: other })).body;
    expect(list.find((x: any) => x.id === 'urgent-ticket')).toMatchObject({ module: 'helpdesk', applied: true, summary: 'เมื่อมีเรื่องแจ้งปัญหาใหม่ ถ้า ความเร่งด่วน (low / normal / high / urgent) = urgent ให้แจ้งเตือนในแอป + ส่ง LINE' });
  });

  it('turns office events into Thai alerts with links, and respects template conditions', async () => {
    const tenantId = t.otherTenantId;
    const other = t.token(['*'], tenantId);
    for (const [type, data] of Object.entries(SAMPLES)) expect((await t.deliver(type, data, { tenantId })).body.status, type).toBe('handled');
    // an ordinary ticket, a passed inspection and a booking without approval do not trip the conditional templates
    await t.deliver('helpdesk.ticket_created', { ...SAMPLES['helpdesk.ticket_created'], ticketId: uuid(), no: 'TK-2569-0011', title: 'เมาส์เสีย', priority: 'normal' }, { tenantId });
    await t.deliver('quality.inspection_completed', { ...SAMPLES['quality.inspection_completed'], inspectionId: uuid(), result: 'pass', rejectedQty: 0 }, { tenantId });
    await t.deliver('booking.requested', { ...SAMPLES['booking.requested'], bookingId: uuid(), needsApproval: false }, { tenantId });
    const items = (await t.api('GET', '/notifications', undefined, { token: other })).body.items as any[];
    const by = (title: string) => items.filter((x) => x.title === title);
    const s = SAMPLES as any;
    /** what one person sees in their bell */
    const bell = async (userId: string) => (await t.api('GET', '/notifications', undefined, { token: t.token(['automation.notify.read'], tenantId, { userId }) })).body.items as any[];

    // personal alerts are not broadcast
    for (const title of ['มีคำขออนุมัติใหม่ แจ้งผู้อนุมัติ', 'คำขอไม่อนุมัติ/ส่งกลับแก้ไข แจ้งผู้ขอ', 'มีคนขอลา แจ้งหัวหน้า', 'ใบลามีผลแล้ว แจ้งพนักงาน', 'จ่ายเงินใบเบิกแล้ว แจ้งผู้เบิก', 'แก้ปัญหาเสร็จ แจ้งผู้แจ้ง']) {
      expect(by(title), title).toHaveLength(0);
    }
    expect((await bell(s['approvals.request_submitted'].nextApproverId)).filter((x) => x.title === 'มีคำขออนุมัติใหม่ แจ้งผู้อนุมัติ')).toEqual([expect.objectContaining({
      level: 'warn', personal: true, body: 'คำขอ APV-2569-0007 "ซื้อโน้ตบุ๊ก" (ขอซื้อ) จาก สมชาย รอคุณอนุมัติ (ขั้นที่ 1/2)', link: `/m/approvals/requestDetail/${s['approvals.request_submitted'].requestId}` })]);
    expect((await bell(s['approvals.request_submitted'].requesterId)).filter((x) => x.title === 'มีคำขออนุมัติใหม่ แจ้งผู้อนุมัติ')).toHaveLength(0);
    const requester = await bell(s['approvals.request_decided'].requesterId);
    expect(requester.filter((x) => x.title === 'คำขอได้รับการอนุมัติ แจ้งผู้ขอ')).toHaveLength(0);
    expect(requester.find((x) => x.title === 'คำขอไม่อนุมัติ/ส่งกลับแก้ไข แจ้งผู้ขอ').body).toBe('คำขอ APV-2569-0007 "ซื้อโน้ตบุ๊ก" ของคุณไม่ผ่านหรือถูกส่งกลับแก้ไข โดย คุณวิภา เหตุผล: งบหมด');
    expect(by('เบิกเกินวงเงิน แจ้งบัญชี')[0]).toMatchObject({ body: '⚠️ ใบเบิก EXP-2569-0003 ของ มาลี ยอด 4,200 บาท เกินวงเงินรายเดือน ตรวจสอบก่อนอนุมัติ', link: `/m/expense/claimDetail/${s['expense.claim_submitted'].claimId}` });
    expect((await bell(s['hr.leave_requested'].approverUserId)).find((x) => x.title === 'มีคนขอลา แจ้งหัวหน้า')).toMatchObject({
      body: 'นายสมชาย ใจดี ขอลาพักร้อน 2026-10-12 ถึง 2026-10-14 (3 วัน) ใบลา LV-2569-0004 รอคุณอนุมัติ', link: `/m/hr/leaveDetail/${s['hr.leave_requested'].leaveId}` });
    expect((await bell(s['hr.leave_decided'].employeeUserId)).find((x) => x.title === 'ใบลามีผลแล้ว แจ้งพนักงาน').body)
      .toBe('ใบลา LV-2569-0004 (ลาพักร้อน) ของคุณ: อนุมัติแล้ว โดย คุณวิชัย หมายเหตุ: เที่ยวให้สนุก');
    expect((await bell(s['expense.claim_paid'].claimantId)).find((x) => x.title === 'จ่ายเงินใบเบิกแล้ว แจ้งผู้เบิก').body).toBe('💸 ใบเบิก EXP-2569-0003 ของคุณ ยอด 4,200 บาท จ่ายเงินแล้ว');
    expect((await bell(s['helpdesk.ticket_resolved'].requesterUserId)).find((x) => x.title === 'แก้ปัญหาเสร็จ แจ้งผู้แจ้ง').body).toBe('✅ เรื่อง TK-2569-0010 "อินเทอร์เน็ตล่มทั้งชั้น" ที่คุณแจ้งแก้ไขแล้ว: รีสตาร์ทสวิตช์');
    expect(by('ตั๋วด่วนมาก แจ้งทีม IT').map((x) => x.body)).toEqual(['🚨 ด่วนมาก TK-2569-0010: อินเทอร์เน็ตล่มทั้งชั้น ผู้แจ้ง คุณบี (หมวด ไอที)']);
    expect(by('ลีดใหม่ แจ้งเซลส์')[0]).toMatchObject({ body: 'ลีดใหม่ LD-2569-0021: บริษัท สยามพาร์ท จำกัด ผู้ติดต่อ คุณเอ (ช่องทาง line)', link: `/m/crm/lead/${s['crm.lead_created'].leadId}` });
    expect(by('ลูกค้าตอบรับใบเสนอราคา')[0]).toMatchObject({ level: 'ok', body: '🎉 บริษัท สยามพาร์ท จำกัด ตอบรับใบเสนอราคา QT-2569-0005 ยอด 107,000 บาท', link: `/m/crm/quote/${s['crm.quotation_accepted'].quotationId}` });
    expect(by('QC ไม่ผ่าน แจ้งผู้จัดการคุณภาพ')).toHaveLength(1);
    expect(by('QC ไม่ผ่าน แจ้งผู้จัดการคุณภาพ')[0].link).toBe(`/m/quality/inspDetail/${s['quality.inspection_completed'].inspectionId}`);
    expect(by('NCR ร้ายแรง')[0]).toMatchObject({ level: 'stop', body: '🛑 NCR วิกฤต NCR-2569-0002 FG-BRACKET: ลูกค้าร้องเรียนขายึดบิดงอ', link: `/m/quality/ncrDetail/${s['quality.ncr_raised'].ncrId}` });
    expect(by('มีการจองห้อง/รถที่ต้องอนุมัติ').map((x) => x.body)).toEqual(['อลิส ขอจอง รถตู้ จ. 5 ต.ค. 08:00–16:00 (ไปพบลูกค้าระยอง) รออนุมัติ เลขที่ BK-2569-0011']);
    // wave 5: PM visit → the technician personally; expiring contract, payment and payroll → broadcast
    expect(by('มีนัด PM แจ้งช่าง')).toHaveLength(0);
    expect((await bell(s['contracts.visit_due'].technicianId)).find((x) => x.title === 'มีนัด PM แจ้งช่าง')).toMatchObject({
      personal: true, body: '🛠️ นัด PM PMV-2569-0004 บริษัท สยามพาร์ท จำกัด วันที่ 2026-10-21 (สัญญา MA-2569-0002) อุปกรณ์: CCTV 32 จุด (อาคาร A)',
      link: `/m/contracts/visit/${s['contracts.visit_due'].visitId}` });
    expect(by('สัญญา MA ใกล้หมด แจ้งเซลส์')[0]).toMatchObject({ level: 'warn',
      body: '⏳ สัญญา MA-2569-0001 ของ บริษัท ไทยแพ็ค จำกัด (MA ระบบเครือข่าย) หมดวันที่ 2026-11-30 อีก 45 วัน มูลค่า 120,000 บาท — เสนอต่อสัญญา' });
    expect(by('ลูกค้าชำระเงินแล้ว แจ้งเซลส์/บัญชี')[0]).toMatchObject({ level: 'ok',
      body: '💰 บริษัท สยามพาร์ท จำกัด ชำระเงินแล้ว 10,400 บาท (ใบเสร็จ RC-2569-0007) ภาษีหัก ณ ที่จ่าย 300 บาท', link: `/m/sales/receipt/${s['sales.payment_received'].receiptId}` });
    expect(by('จ่ายเงินเดือนแล้ว')[0]).toMatchObject({ level: 'ok', link: `/m/payroll/runDetail/${s['payroll.run_paid'].runId}`,
      body: '✅ จ่ายเงินเดือน PR-2569-10 งวด 2026-10 แล้ว 12 คน ยอดสุทธิ 285,000 บาท — นำส่ง ภ.ง.ด.1 ภายในวันที่ 7 และเงินสมทบประกันสังคมภายในวันที่ 15 ของเดือนถัดไป' });
    // the main tenant saw none of it
    expect((await t.api('GET', '/notifications')).body.items.filter((x: any) => x.title === 'ลีดใหม่ แจ้งเซลส์')).toHaveLength(0);
  });

  it('builds custom rules on the new events from the simple form', async () => {
    const rule = await t.api('POST', '/rules/simple', { name: 'เบิกเกิน 5,000', eventType: 'expense.claim_submitted', conditionField: 'total', conditionOp: 'gt', conditionValue: '5000', actionType: 'notify' });
    expect(rule.status).toBe(201);
    expect(rule.body.summary).toBe('เมื่อมีใบเบิกค่าใช้จ่ายรออนุมัติ ถ้า ยอดเบิก > 5,000 ให้แจ้งเตือนในแอป');
    expect((await t.api('POST', '/rules/simple', { name: 'x', eventType: 'helpdesk.ticket_created', conditionField: 'priority', conditionOp: 'gt', conditionValue: 1 })).status).toBe(400);
    const test = await t.api('POST', `/rules/${rule.body.id}/test`, { data: SAMPLES['expense.claim_submitted'] });
    expect(test.body).toMatchObject({ matched: false, messages: [{ type: 'notify', text: 'ใบเบิก EXP-2569-0003 ของ มาลี ยอด 4,200 บาท รออนุมัติ' }] });
  });
});

describe('per-user notifications (wave 4)', () => {
  const NOTE = ['automation.notify.read'];
  const tenant = () => t.otherTenantId;
  const tok = (userId: string, tid = t.tenantId) => t.token(NOTE, tid, { userId });

  it('validates recipients against the event', async () => {
    const bad = (to: string, eventType = 'approvals.request_decided', type = 'notify') =>
      t.api('POST', '/rules', { name: 'x', eventType, actions: [{ type, to, target: 'U1' }] });
    expect((await bad('field:nextApproverId')).status).toBe(400); // not a user field of request_decided
    expect((await bad('field:requesterName')).status).toBe(400);
    expect((await bad('user:not-a-uuid')).status).toBe(400);
    expect((await bad('boss')).status).toBe(400);
    expect((await bad('field:requesterId', 'approvals.request_decided', 'line')).status).toBe(400);
    expect((await bad('field:itemCode', 'inventory.low_stock')).status).toBe(400);
    const ok = await t.api('POST', '/rules', { name: 'ถึงผู้ขอ', eventType: 'approvals.request_decided', actions: [{ type: 'notify', to: 'field:requesterId' }] });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ recipients: 'ผู้ขอ', summary: 'เมื่อคำขออนุมัติมีผลแล้ว ให้แจ้งเตือนในแอป (ถึงผู้ขอ)' });
    await t.api('DELETE', `/rules/${ok.body.id}`);
  });

  it('addresses alerts to people: approver + delegate, a picked user, nobody → no broadcast', async () => {
    const tid = randomUUID(); // isolated tenant for clean counts
    const admin = t.token(['*'], tid);
    await t.api('POST', '/templates/approval-to-approver/apply', {}, { token: admin });
    const boss = randomUUID(); const deputy = randomUUID(); const staff = randomUUID();
    const data = { ...SAMPLES['approvals.request_submitted'], requestId: randomUUID(), nextApproverId: boss, delegateId: deputy, delegateName: 'รอง' };
    expect((await t.deliver('approvals.request_submitted', data, { tenantId: tid })).body.status).toBe('handled');
    const bossBell = (await t.api('GET', '/notifications', undefined, { token: tok(boss, tid) })).body;
    expect(bossBell).toMatchObject({ unread: 1 });
    expect(bossBell.items[0]).toMatchObject({ personal: true, recipient_user_id: boss, read_at: null });
    expect((await t.api('GET', '/notifications', undefined, { token: tok(deputy, tid) })).body.unread).toBe(1);
    expect((await t.api('GET', '/notifications', undefined, { token: tok(staff, tid) })).body).toEqual({ unread: 0, items: [] });
    const runs = (await t.api('GET', '/runs', undefined, { token: admin })).body;
    expect(runs[0].detail).toContain('แจ้งในแอปแล้ว (ถึงผู้อนุมัติขั้นนี้ / ผู้อนุมัติแทน (ช่วงผู้อนุมัติไม่อยู่) 2 คน)');

    // an event without the user id → nothing in anyone's bell, and the run says why
    const { nextApproverId: _drop, ...noApprover } = data as any;
    await t.deliver('approvals.request_submitted', { ...noApprover, nextApproverId: '00000000-0000-0000-0000-000000000000', delegateId: undefined }, { tenantId: tid });
    expect((await t.api('GET', '/notifications', undefined, { token: tok(staff, tid) })).body.unread).toBe(0);

    // the simple form can pick one user
    const picked = await t.api('POST', '/rules/simple', { name: 'แจ้งคุณเอ', eventType: 'crm.lead_created', actionType: 'notify', toUserId: staff }, { token: admin });
    expect(picked.body).toMatchObject({ recipients: 'ผู้ใช้ที่เลือก' });
    // the form's default 'all' does not break a LINE rule
    expect((await t.api('POST', '/rules/simple', { name: 'LINE', eventType: 'crm.lead_created', actionType: 'line', target: 'G1', to: 'all' }, { token: admin })).status).toBe(201);
    expect((await t.api('POST', '/rules/simple', { name: 'ผู้ขอ', eventType: 'approvals.request_decided', actionType: 'notify', to: 'field:requesterId' }, { token: admin })).body.recipients).toBe('ผู้ขอ');
    await t.deliver('crm.lead_created', { leadId: randomUUID(), no: 'LD-1', company: 'A', contactName: null, source: 'line' }, { tenantId: tid });
    expect((await t.api('GET', '/notifications', undefined, { token: tok(staff, tid) })).body.items.map((x: any) => x.title)).toEqual(['แจ้งคุณเอ']);
    expect((await t.api('GET', '/notifications', undefined, { token: tok(boss, tid) })).body.items.map((x: any) => x.title)).not.toContain('แจ้งคุณเอ');
  });

  it('keeps read state per person: broadcast read by one stays unread for others; personal ones are private', async () => {
    const tid = randomUUID();
    const admin = t.token(['*'], tid);
    await t.api('POST', '/templates/low-stock-alert/apply', {}, { token: admin });
    await t.api('POST', '/templates/approval-approved/apply', {}, { token: admin });
    const a = randomUUID(); const b = randomUUID();
    await t.deliver('inventory.low_stock', lowStock(1), { tenantId: tid });
    await t.deliver('inventory.low_stock', lowStock(2), { tenantId: tid });
    await t.deliver('approvals.request_decided', { ...SAMPLES['approvals.request_decided'], requestId: randomUUID(), decision: 'approved', requesterId: a }, { tenantId: tid });

    const aBell = (await t.api('GET', '/notifications', undefined, { token: tok(a, tid) })).body;
    expect(aBell.unread).toBe(3);
    expect((await t.api('GET', '/notifications', undefined, { token: tok(b, tid) })).body.unread).toBe(2);
    const broadcast = aBell.items.find((x: any) => !x.personal);
    const personal = aBell.items.find((x: any) => x.personal);
    expect(personal.body).toContain('ของคุณได้รับการอนุมัติแล้ว');

    // b cannot read (or even see) a's personal alert
    expect((await t.api('POST', `/notifications/${personal.id}/read`, {}, { token: tok(b, tid) })).status).toBe(404);
    // a reads one broadcast → only a's count drops
    const r = await t.api('POST', `/notifications/${broadcast.id}/read`, {}, { token: tok(a, tid) });
    expect(r.body.read_at).toBeTruthy();
    expect((await t.api('GET', '/notifications', undefined, { token: tok(a, tid) })).body.unread).toBe(2);
    expect((await t.api('GET', '/notifications?unread=1', undefined, { token: tok(b, tid) })).body.items).toHaveLength(2);
    // read-all for b clears b's broadcasts, leaves a untouched
    expect((await t.api('POST', '/notifications/read-all', {}, { token: tok(b, tid) })).body.updated).toBe(2);
    expect((await t.api('GET', '/notifications', undefined, { token: tok(b, tid) })).body.unread).toBe(0);
    expect((await t.api('GET', '/notifications', undefined, { token: tok(a, tid) })).body.unread).toBe(2);
    expect((await t.api('POST', '/notifications/read-all', {}, { token: tok(a, tid) })).body.updated).toBe(2);
    expect((await t.api('GET', '/notifications', undefined, { token: tok(a, tid) })).body.unread).toBe(0);
    // the unread KPI is per user too
    expect((await t.api('GET', '/summary', undefined, { token: t.token(['automation.rule.read'], tid, { userId: a }) })).body.unread).toBe(0);
    // another tenant sees none of it and cannot mark it
    expect((await t.api('POST', `/notifications/${broadcast.id}/read`, {}, { token: tok(a, tenant()) })).status).toBe(404);
    expect((await t.api('GET', '/notifications', undefined, { token: t.token([]) })).status).toBe(403);
  });

  it('rules applied from a template before recipients existed follow the template (no more broadcast of personal news)', async () => {
    const tid = randomUUID();
    const admin = t.token(['*'], tid);
    const rule = (await t.api('POST', '/templates/approval-approved/apply', {}, { token: admin })).body;
    // simulate a pre-wave-4 rule: the stored notify action has no `to`
    await t.svc.db.tx(tid, (c) => c.query(`update rules set actions = '[{"type":"notify","message":"เก่า {{no}}"}]' where id = $1`, [rule.id]));
    const requester = randomUUID();
    await t.deliver('approvals.request_decided', { ...SAMPLES['approvals.request_decided'], requestId: randomUUID(), decision: 'approved', requesterId: requester }, { tenantId: tid });
    const stored = (await t.api('GET', `/rules/${rule.id}`, undefined, { token: admin })).body;
    expect(stored.actions[0]).toMatchObject({ to: 'field:requesterId', message: 'เก่า {{no}}' });
    expect((await t.api('GET', '/notifications', undefined, { token: tok(randomUUID(), tid) })).body.unread).toBe(0);
    expect((await t.api('GET', '/notifications', undefined, { token: tok(requester, tid) })).body.items.map((x: any) => x.body)).toEqual(['เก่า APV-2569-0007']);
  });
});
