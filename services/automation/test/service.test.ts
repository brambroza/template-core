import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';
import { describe as sentence, matches, render, webhookProblem } from '../src/engine.ts';

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
