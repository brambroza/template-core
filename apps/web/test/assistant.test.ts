import { describe, expect, it } from 'vitest';
import { defineUi } from '@erp/ui-schema';
import { matchesTemplate, readableEndpoints, runAssistant } from '../src/lib/assistant.ts';

const ui = defineUi({
  module: 'purchasing', label: 'จัดซื้อ', glyph: 'ซ', menu: [],
  screens: {
    poList: { kind: 'list', title: 'ใบสั่งซื้อ', endpoint: '/purchase-orders', perm: 'purchasing.po.read', columns: [{ key: 'no', label: 'เลขที่' }] },
    poDetail: { kind: 'detail', title: 'ใบสั่งซื้อ', endpoint: '/purchase-orders/:id', perm: 'purchasing.po.read', heading: 'no', fields: [] },
    poNew: { kind: 'form', title: 'สร้างใบสั่งซื้อ', method: 'POST', endpoint: '/purchase-orders', perm: 'purchasing.po.write', submitLabel: 'บันทึก', fields: [
      { name: 'supplierId', label: 'ผู้ขาย', type: 'lookup', lookup: { module: 'master-data', path: '/partners', label: ['code'], assign: { supplierId: 'id' } } },
    ] },
  },
  widgets: [{ id: 'po', kind: 'kpi', title: 'จัดซื้อ', endpoint: '/summary', items: [] }],
});

/** A scripted model + gateway: each model call returns the next canned message. */
function fakes(script: any[]) {
  const calls: { url: string; init: any }[] = [];
  let i = 0;
  const fetch = (async (url: string, init: any = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/messages')) return new Response(JSON.stringify(script[i++]), { status: 200 });
    if (url.includes('/api/purchasing/summary')) return new Response(JSON.stringify({ toApprove: 3 }), { status: 200 });
    return new Response('{"error":"nope"}', { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const base = { authorization: 'Bearer user-token', apiKey: 'sk-test', gatewayUrl: 'http://gw', modules: [ui], permissions: ['purchasing.po.read', 'purchasing.po.write'], baseUrl: 'http://ai' };

describe('assistant', () => {
  it('only allows GET endpoints declared by the screens', () => {
    const r = readableEndpoints([ui]).get('purchasing')!;
    expect(r).toContain('/purchase-orders/:id');
    expect(r).toContain('/summary');
    expect(matchesTemplate('/purchase-orders/abc', '/purchase-orders/:id')).toBe(true);
    expect(matchesTemplate('/purchase-orders/abc/approve', '/purchase-orders/:id')).toBe(false);
  });

  it('reads data with the user token and answers from it', async () => {
    const { fetch, calls } = fakes([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'read_data', input: { module: 'purchasing', path: '/summary' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'มี 3 ใบรออนุมัติครับ' }] },
    ]);
    const r = await runAssistant({ ...base, fetch, messages: [{ role: 'user', content: 'มี PO รออนุมัติกี่ใบ' }] });
    expect(r.reply).toBe('มี 3 ใบรออนุมัติครับ');
    expect(r.reads).toEqual(['purchasing/summary']);
    const gw = calls.find((c) => c.url === 'http://gw/api/purchasing/summary')!;
    expect(gw.init.headers.authorization).toBe('Bearer user-token');
    const ai = calls.filter((c) => c.url === 'http://ai/v1/messages');
    expect(ai[0].init.headers['x-api-key']).toBe('sk-test');
    expect(ai[0].init.body).not.toContain('user-token'); // the ERP token never goes to the model
    expect(JSON.parse(ai[1].init.body).messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1', content: '{"toApprove":3}' });
  });

  it('refuses undeclared or write paths and only offers prefilled screens', async () => {
    const { fetch, calls } = fakes([
      { stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 'a', name: 'read_data', input: { module: 'identity', path: '/users' } },
        { type: 'tool_use', id: 'b', name: 'read_data', input: { module: 'purchasing', path: '/purchase-orders/x/approve' } },
        { type: 'tool_use', id: 'c', name: 'open_screen', input: { module: 'purchasing', screen: 'poNew', values: { supplierId: 'S1' }, lookupLabels: { supplierId: 'SUP-001 เหล็กไทย' }, label: 'สร้าง PO' } },
      ] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'เปิดฟอร์มให้แล้ว' }] },
    ]);
    const r = await runAssistant({ ...base, fetch, messages: [{ role: 'user', content: 'สั่งซื้อจากเหล็กไทย' }] });
    expect(calls.some((c) => c.url.startsWith('http://gw'))).toBe(false);
    const results = JSON.parse(calls.at(-1)!.init.body).messages.at(-1).content;
    expect(results[0].content).toMatch(/^ไม่อนุญาต/);
    expect(results[1].content).toMatch(/^ไม่อนุญาต/);
    expect(r.actions).toEqual([{ label: 'สร้าง PO', href: '/m/purchasing/poNew?f.supplierId=S1&l.supplierId=SUP-001+%E0%B9%80%E0%B8%AB%E0%B8%A5%E0%B9%87%E0%B8%81%E0%B9%84%E0%B8%97%E0%B8%A2' }]);
  });

  it('does not open screens the user may not use', async () => {
    const { fetch } = fakes([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'c', name: 'open_screen', input: { module: 'purchasing', screen: 'poNew', label: 'x' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
    ]);
    const r = await runAssistant({ ...base, permissions: ['purchasing.po.read'], fetch, messages: [{ role: 'user', content: 'x' }] });
    expect(r.actions).toEqual([]);
  });
});
