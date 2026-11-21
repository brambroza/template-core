import { describe, expect, it } from 'vitest';
import { buildTodo, dueText, todoActions, todoSources, waitingText, type ModuleUi, type TodoSpec } from '../src/index.ts';

// 20 Nov 2026 10:00 Bangkok
const NOW = new Date('2026-11-20T03:00:00Z');

describe('home "ต้องตัดสินใจวันนี้"', () => {
  it('says how long something has waited', () => {
    expect(waitingText('2026-11-20T02:58:00Z', NOW)).toBe('เพิ่งส่ง');
    expect(waitingText('2026-11-20T02:30:00Z', NOW)).toBe('รอ 30 นาที');
    expect(waitingText('2026-11-19T22:00:00Z', NOW)).toBe('รอ 5 ชม.');
    expect(waitingText('2026-11-17', NOW)).toBe('รอ 3 วัน');
    expect(waitingText('nope', NOW)).toBeUndefined();
  });

  it('counts deadlines in Bangkok days', () => {
    expect(dueText('2026-11-18', NOW)).toEqual({ text: 'เกินกำหนด 2 วัน', overdue: true });
    expect(dueText('2026-11-20', NOW)).toEqual({ text: 'ครบกำหนดวันนี้', overdue: false });
    expect(dueText('2026-11-21', NOW)).toEqual({ text: 'ครบกำหนดพรุ่งนี้', overdue: false });
    expect(dueText('2026-11-25', NOW)).toEqual({ text: 'อีก 5 วัน', overdue: false });
    // 23:30 Bangkok on the 20th is still "today" although it is the 20th 16:30 UTC
    expect(dueText('2026-11-20T16:30:00Z', NOW)?.text).toBe('ครบกำหนดวันนี้');
  });

  it('puts overdue, then urgent, then due today, then the longest waiting first — and lists a record once', () => {
    const po: TodoSpec = { id: 'po', label: 'ใบสั่งซื้อรออนุมัติ', screen: 'poList', title: 'no', subtitle: ['supplier_name', 'note'], amount: 'gross', since: 'created_at' };
    const leave: TodoSpec = { id: 'leave', label: 'ใบลา', screen: 'x', title: 'employee_name', due: 'from_date', since: 'created_at', urgent: { field: 'leave_type_code', in: ['sick'] } };
    const items = buildTodo([
      { module: 'purchasing', spec: po, rows: [
        { id: 'p1', no: 'PO-1', supplier_name: 'สยามเหล็ก', note: '', gross: 21699.6, created_at: '2026-11-10T03:00:00Z' },
        { id: 'p2', no: 'PO-2', supplier_name: 'ไทยน็อต', gross: 0, created_at: '2026-11-19T03:00:00Z' },
      ] },
      { module: 'hr', spec: leave, rows: [
        { id: 'l1', employee_name: 'สมชาย', from_date: '2026-11-18', created_at: '2026-11-17T03:00:00Z' },
        { id: 'l2', employee_name: 'มาลี', from_date: '2026-11-25', leave_type_code: 'sick', created_at: '2026-11-20T02:00:00Z' },
        { id: 'l3', employee_name: 'วิชัย', from_date: '2026-11-20', created_at: '2026-11-20T02:59:00Z' },
      ] },
      // HR's queue lists l1 again
      { module: 'hr', spec: { ...leave, id: 'hr-leave' }, rows: [{ id: 'l1', employee_name: 'สมชาย', from_date: '2026-11-18' }] },
    ], NOW);
    expect(items.map((i) => i.row.id)).toEqual(['l1', 'l2', 'l3', 'p1', 'p2']);
    expect(items[0]).toMatchObject({ overdue: true, dueText: 'เกินกำหนด 2 วัน', waiting: 'รอ 3 วัน' });
    expect(items[1].urgent).toBe(true);
    const p1 = items.find((i) => i.row.id === 'p1')!;
    expect(p1).toMatchObject({ title: 'PO-1', subtitle: 'สยามเหล็ก', amount: 21699.6, waiting: 'รอ 10 วัน', key: 'purchasing:p1' });
    expect(items.find((i) => i.row.id === 'p2')!.amount).toBeUndefined(); // 0 is not shown
  });
});

describe('who sees which decisions', () => {
  const ui: ModuleUi = {
    module: 'purchasing', label: 'จัดซื้อ', glyph: 'P', menu: [],
    screens: {
      poList: { kind: 'list', title: 'PO', endpoint: '/purchase-orders', perm: 'purchasing.po.read', columns: [], rowLink: { screen: 'poDetail' } },
      poDetail: { kind: 'detail', title: 'PO', endpoint: '/purchase-orders/:id', heading: 'no', fields: [] },
    },
    todo: [
      { id: 'approve', label: 'PO รออนุมัติ', screen: 'poList', title: 'no',
        actions: [{ id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/purchase-orders/:id/approve', perm: 'purchasing.po.approve', when: { field: 'status', in: ['draft'] } }] },
      { id: 'broken', label: 'x', screen: 'poDetail', title: 'no' },
    ],
  };

  it('shows a group only to people who may press its first button and open the list', () => {
    expect(todoSources([ui], ['purchasing.po.read', 'purchasing.po.approve']).map((x) => x.spec.id)).toEqual(['approve']);
    expect(todoSources([ui], ['purchasing.po.read'])).toEqual([]);
    expect(todoSources([ui], ['purchasing.po.approve'])).toEqual([]);
    expect(todoSources([ui], ['*']).map((x) => x.spec.id)).toEqual(['approve']); // a detail screen never feeds the inbox
  });

  it('offers a button only when the row allows it', () => {
    const [src] = todoSources([ui], ['*']);
    const [draft, approved] = buildTodo([{ module: 'purchasing', spec: src.spec, rows: [{ id: '1', no: 'PO-1', status: 'draft' }, { id: '2', no: 'PO-2', status: 'approved' }] }]);
    expect(todoActions(draft, src.screen, ['*']).map((a) => a.id)).toEqual(['approve']);
    expect(todoActions(approved, src.screen, ['*'])).toEqual([]);
    expect(todoActions(draft, src.screen, ['purchasing.po.read'])).toEqual([]);
  });
});
