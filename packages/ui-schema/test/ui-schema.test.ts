import { describe, expect, it } from 'vitest';
import { commandTarget, matchCommand, pickRecord, prefillFromQuery, fillPath, formatValue, get, hasPerm, matches, missingRequired, statusTone, toBody, type Screen } from '../src/index.ts';

describe('ui-schema helpers', () => {
  it('fills endpoint templates from several sources', () => {
    expect(fillPath('/orders/:id/approve', { id: 'a b' })).toBe('/orders/a%20b/approve');
    expect(fillPath('/item-costs/:itemId', {}, { itemId: 'x' })).toBe('/item-costs/x');
    expect(() => fillPath('/orders/:id', {})).toThrow(/Missing value for :id/);
  });

  it('reads dotted paths and checks conditions and permissions', () => {
    expect(get({ customer: { name: 'A' } }, 'customer.name')).toBe('A');
    expect(matches({ status: 'draft' }, { field: 'status', in: ['draft'] })).toBe(true);
    expect(matches({ status: 'approved' }, { field: 'status', in: ['draft'] })).toBe(false);
    expect(hasPerm(['sales.*'], 'sales.order.write')).toBe(true);
    expect(hasPerm(['sales.order.read'], 'sales.order.write')).toBe(false);
    expect(hasPerm([], undefined)).toBe(true);
  });

  it('formats Thai values', () => {
    expect(formatValue(1070, 'money')).toBe('1,070.00');
    expect(formatValue('draft', 'status')).toBe('ร่าง');
    expect(formatValue('2026-10-02', 'date')).toBe('2 ต.ค. 2569');
    expect(formatValue(null, 'money')).toBe('—');
    expect(statusTone('received')).toBe('ok');
  });

  it('builds request bodies and checks required fields', () => {
    const fields = [{ name: 'qty', label: 'จำนวน', type: 'number' as const, required: true }, { name: 'note', label: 'หมายเหตุ', type: 'text' as const }];
    expect(toBody(fields, { qty: '5', note: '' })).toEqual({ qty: 5 });
    expect(toBody([], {}, { name: 'lines', label: 'x', fields }, [{ qty: '2' }, {}])).toEqual({ lines: [{ qty: 2 }] });
    expect(missingRequired(fields, { qty: '' })).toEqual({ qty: 'กรอกจำนวน' });
  });
});

describe('commands', () => {
  const cmds = [
    { id: 'wo', label: 'แจ้งซ่อม', example: 'แจ้งซ่อม PRESS-01 น้ำมันรั่ว', keywords: ['แจ้งซ่อม', 'ซ่อม'], screen: 'woNew', arg: { lookup: { path: '/machines', label: ['code'], assign: { machineId: 'id' } } }, restField: 'title' },
    { id: 'items', label: 'ค้นหาสินค้า', example: 'สินค้า เหล็ก', keywords: ['สินค้า'], screen: 'items', restField: 'q' },
  ];
  it('picks the longest keyword and splits the argument from the rest', () => {
    expect(matchCommand(cmds, 'แจ้งซ่อม PRESS-01 น้ำมันรั่ว ที่กระบอกสูบ')).toMatchObject({ command: { id: 'wo' }, argText: 'PRESS-01', rest: 'น้ำมันรั่ว ที่กระบอกสูบ' });
    expect(matchCommand(cmds, 'สินค้า เหล็กแผ่น 2 มม.')).toMatchObject({ command: { id: 'items' }, argText: '', rest: 'เหล็กแผ่น 2 มม.' });
    expect(matchCommand(cmds, 'อะไรก็ไม่รู้')).toBeNull();
  });
});

describe('command targets', () => {
  const lookup = { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code' } };
  const rows = [{ id: '1', code: 'RM-STEEL-2', name: 'เหล็ก 2' }, { id: '2', code: 'RM-STEEL', name: 'เหล็กแผ่น' }];
  it('prefers an exact code match', () => {
    expect(pickRecord(lookup, rows, 'rm-steel')?.id).toBe('2');
    expect(pickRecord(lookup, rows, 'เหล็ก 2')?.id).toBe('1');
    expect(pickRecord(lookup, rows, 'nothing')).toBeNull();
  });
  it('prefills forms, filters lists and opens records', () => {
    const cmd = { id: 'mo', label: 'ผลิต', example: '', keywords: ['ผลิต'], screen: 'moNew', arg: { lookup }, restField: 'qty' };
    const form: Screen = { kind: 'form', title: '', method: 'POST', endpoint: '/orders', fields: [], submitLabel: '' };
    const t = commandTarget(cmd, form, rows[1], '500');
    expect(t.query).toEqual({ 'f.itemId': '2', 'f.itemCode': 'RM-STEEL', 'l.itemId': 'RM-STEEL  เหล็กแผ่น', 'f.qty': '500' });
    expect(prefillFromQuery(Object.entries(t.query))).toEqual({ itemId: '2', itemCode: 'RM-STEEL', '__label.itemId': 'RM-STEEL  เหล็กแผ่น', qty: '500' });
    const list: Screen = { kind: 'list', title: '', endpoint: '/x', columns: [] };
    expect(commandTarget({ ...cmd, restField: undefined }, list, rows[1], '').query).toEqual({ itemId: '2', itemCode: 'RM-STEEL' });
    expect(commandTarget({ ...cmd, arg: { lookup, openId: 'id' } }, list, rows[1], '')).toEqual({ screen: 'moNew', id: '2', query: {} });
  });
  it('never sends helper values to the server', () => {
    expect(toBody([], { a: 1, '__label.a': 'x' })).toEqual({ a: 1 });
  });
});

import { AREAS, areaLabel, groupByArea, moduleArea } from '../src/index.ts';

describe('areas', () => {
  it('maps every GO Along module to an area, honours an explicit area and defaults add-ons to operations', () => {
    expect(moduleArea({ module: 'sales' })).toBe('commercial');
    expect(moduleArea({ module: 'identity' })).toBe('settings');
    expect(moduleArea({ module: 'sales', area: 'office' })).toBe('office');
    expect(moduleArea({ module: 'customer-x' })).toBe('operations');
    expect(areaLabel('service')).toBe('บริการ & โครงการ');
    expect(AREAS.map((a) => a.id)).toEqual(['operations', 'commercial', 'finance', 'office', 'service', 'settings']);
  });

  it('groups items by area in area order, keeping item order and dropping empty areas', () => {
    const mods = ['identity', 'crm', 'maintenance', 'sales', 'inventory'].map((module) => ({ module }));
    expect(groupByArea(mods, (m) => m).map((g) => [g.area, g.items.map((m) => m.module)])).toEqual([
      ['operations', ['maintenance', 'inventory']],
      ['commercial', ['crm', 'sales']],
      ['settings', ['identity']],
    ]);
  });
});
