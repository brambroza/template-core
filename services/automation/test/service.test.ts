import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';
import { describe as sentence, matches, render, webhookProblem } from '../src/engine.ts';
import { EVENTS, TEMPLATES } from '../src/catalog.ts';
import { isKnownEvent, parseEvent, type EventType } from '@erp/contracts';
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
  'approvals.request_submitted': { requestId: uuid(), no: 'APV-2569-0007', title: 'ซื้อโน้ตบุ๊ก', typeName: 'ขอซื้อ', requesterName: 'สมชาย', amount: 32000, nextApproverId: uuid(), nextApproverName: 'คุณวิภา', step: 1, stepCount: 2 },
  'approvals.request_decided': { requestId: uuid(), no: 'APV-2569-0007', title: 'ซื้อโน้ตบุ๊ก', decision: 'rejected', requesterId: uuid(), requesterName: 'สมชาย', byName: 'คุณวิภา', note: 'งบหมด' },
  'expense.claim_submitted': { claimId: uuid(), no: 'EXP-2569-0003', claimantName: 'มาลี', total: 4200, overLimit: true },
  'expense.claim_paid': { claimId: uuid(), no: 'EXP-2569-0003', claimantName: 'มาลี', total: 4200 },
  'hr.leave_requested': { leaveId: uuid(), no: 'LV-2569-0004', employeeName: 'นายสมชาย ใจดี', typeName: 'ลาพักร้อน', from: '2026-10-12', to: '2026-10-14', days: 3 },
  'hr.leave_decided': { leaveId: uuid(), no: 'LV-2569-0004', employeeName: 'นายสมชาย ใจดี', typeName: 'ลาพักร้อน', decision: 'approved' },
  'helpdesk.ticket_created': { ticketId: uuid(), no: 'TK-2569-0010', title: 'อินเทอร์เน็ตล่มทั้งชั้น', priority: 'urgent', categoryName: 'ไอที', requesterName: 'คุณบี', assigneeName: 'ช่างเอก' },
  'helpdesk.ticket_resolved': { ticketId: uuid(), no: 'TK-2569-0010', title: 'อินเทอร์เน็ตล่มทั้งชั้น', requesterName: 'คุณบี', resolution: 'รีสตาร์ทสวิตช์' },
  'crm.lead_created': { leadId: uuid(), no: 'LD-2569-0021', company: 'บริษัท สยามพาร์ท จำกัด', contactName: 'คุณเอ', source: 'line' },
  'crm.quotation_accepted': { quotationId: uuid(), no: 'QT-2569-0005', customerName: 'บริษัท สยามพาร์ท จำกัด', total: 107000 },
  'quality.inspection_completed': { inspectionId: uuid(), no: 'QC-2569-0009', stage: 'incoming', itemCode: 'RM-STEEL', itemName: 'เหล็กแผ่น', lotNo: 'L-01', result: 'fail', rejectedQty: 55 },
  'quality.ncr_raised': { ncrId: uuid(), no: 'NCR-2569-0002', severity: 'critical', itemCode: 'FG-BRACKET', description: 'ลูกค้าร้องเรียนขายึดบิดงอ' },
  'booking.requested': { bookingId: uuid(), no: 'BK-2569-0011', resourceName: 'รถตู้', startAt: '2026-10-05T01:00:00.000Z', endAt: '2026-10-05T09:00:00.000Z', requesterName: 'อลิส', needsApproval: true, period: 'จ. 5 ต.ค. 08:00–16:00', purpose: 'ไปพบลูกค้าระยอง' },
  'assets.repair_reported': { assetId: uuid(), code: 'AS-2569-0003', name: 'โน้ตบุ๊ก Dell', description: 'จอไม่ติด' },
};

describe('event catalogue and templates', () => {
  it('lists exactly the subscribed events, all known to @erp/contracts, with fields that exist in the payload', () => {
    expect(EVENTS.map((e) => e.type).sort()).toEqual([...manifestJson.subscribes].sort());
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

  it('ships 19 templates, every one valid and appliable with a click', async () => {
    expect(TEMPLATES).toHaveLength(19);
    expect(new Set(TEMPLATES.map((x) => x.id)).size).toBe(TEMPLATES.length);
    const other = t.token(['*'], t.otherTenantId);
    for (const tpl of TEMPLATES) {
      const ev = EVENTS.find((e) => e.type === tpl.eventType)!;
      for (const c of tpl.conditions) expect(ev.fields.map((f) => f.key), `${tpl.id}: ${c.field}`).toContain(c.field);
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
    expect(by('มีคำขออนุมัติใหม่ แจ้งผู้อนุมัติ')).toEqual([expect.objectContaining({
      level: 'warn', body: 'คำขอ APV-2569-0007 "ซื้อโน้ตบุ๊ก" (ขอซื้อ) จาก สมชาย รอ คุณวิภา อนุมัติ (ขั้นที่ 1/2)', link: `/m/approvals/requestDetail/${s['approvals.request_submitted'].requestId}` })]);
    expect(by('คำขอได้รับการอนุมัติ แจ้งผู้ขอ')).toHaveLength(0);
    expect(by('คำขอไม่อนุมัติ/ส่งกลับแก้ไข แจ้งผู้ขอ')[0].body).toBe('คำขอ APV-2569-0007 "ซื้อโน้ตบุ๊ก" ของ สมชาย ไม่ผ่านหรือถูกส่งกลับแก้ไข โดย คุณวิภา เหตุผล: งบหมด');
    expect(by('เบิกเกินวงเงิน แจ้งบัญชี')[0]).toMatchObject({ body: '⚠️ ใบเบิก EXP-2569-0003 ของ มาลี ยอด 4,200 บาท เกินวงเงินรายเดือน ตรวจสอบก่อนอนุมัติ', link: `/m/expense/claimDetail/${s['expense.claim_submitted'].claimId}` });
    expect(by('มีคนขอลา แจ้งหัวหน้า')[0]).toMatchObject({ body: 'นายสมชาย ใจดี ขอลาพักร้อน 2026-10-12 ถึง 2026-10-14 (3 วัน) ใบลา LV-2569-0004 รออนุมัติ', link: `/m/hr/leaveDetail/${s['hr.leave_requested'].leaveId}` });
    expect(by('ตั๋วด่วนมาก แจ้งทีม IT').map((x) => x.body)).toEqual(['🚨 ด่วนมาก TK-2569-0010: อินเทอร์เน็ตล่มทั้งชั้น ผู้แจ้ง คุณบี (หมวด ไอที)']);
    expect(by('ลีดใหม่ แจ้งเซลส์')[0]).toMatchObject({ body: 'ลีดใหม่ LD-2569-0021: บริษัท สยามพาร์ท จำกัด ผู้ติดต่อ คุณเอ (ช่องทาง line)', link: `/m/crm/lead/${s['crm.lead_created'].leadId}` });
    expect(by('ลูกค้าตอบรับใบเสนอราคา')[0]).toMatchObject({ level: 'ok', body: '🎉 บริษัท สยามพาร์ท จำกัด ตอบรับใบเสนอราคา QT-2569-0005 ยอด 107,000 บาท', link: `/m/crm/quote/${s['crm.quotation_accepted'].quotationId}` });
    expect(by('QC ไม่ผ่าน แจ้งผู้จัดการคุณภาพ')).toHaveLength(1);
    expect(by('QC ไม่ผ่าน แจ้งผู้จัดการคุณภาพ')[0].link).toBe(`/m/quality/inspDetail/${s['quality.inspection_completed'].inspectionId}`);
    expect(by('NCR ร้ายแรง')[0]).toMatchObject({ level: 'stop', body: '🛑 NCR วิกฤต NCR-2569-0002 FG-BRACKET: ลูกค้าร้องเรียนขายึดบิดงอ', link: `/m/quality/ncrDetail/${s['quality.ncr_raised'].ncrId}` });
    expect(by('มีการจองห้อง/รถที่ต้องอนุมัติ').map((x) => x.body)).toEqual(['อลิส ขอจอง รถตู้ จ. 5 ต.ค. 08:00–16:00 (ไปพบลูกค้าระยอง) รออนุมัติ เลขที่ BK-2569-0011']);
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
