import { describe, expect, it } from 'vitest';
import { initials, kanbanLanes, brokenLinks, type KanbanSpec, type ModuleUi } from '../src/index.ts';

const spec: KanbanSpec = {
  field: 'stage',
  lanes: [{ value: 'prospect', label: 'สนใจ' }, { value: 'proposal', label: 'เสนอราคา' }, { value: 'won', label: 'ปิดการขายได้', closed: true }],
  title: 'name', amount: { key: 'value', label: 'มูลค่า', format: 'money' },
};

describe('kanban lanes', () => {
  it('groups rows by the field in lane order, keeping list order and summing the amount', () => {
    const rows = [
      { id: 1, stage: 'proposal', value: '120000.50' },
      { id: 2, stage: 'prospect', value: 50000 },
      { id: 3, stage: 'proposal', value: 30000 },
      { id: 4, stage: 'archived', value: 999 }, // no lane: left out of the board
      { id: 5, stage: 'won', value: null }, // not a number: counts as 0
    ];
    const lanes = kanbanLanes(spec, rows);
    expect(lanes.map((l) => [l.value, l.rows.map((r) => r.id), l.total, l.closed])).toEqual([
      ['prospect', [2], 50000, false],
      ['proposal', [1, 3], 150000.5, false],
      ['won', [5], 0, true],
    ]);
  });

  it('has no totals without an amount and keeps empty lanes', () => {
    const lanes = kanbanLanes({ ...spec, amount: undefined }, []);
    expect(lanes.map((l) => [l.rows.length, l.total])).toEqual([[0, null], [0, null], [0, null]]);
  });

  it('makes initials for Thai and English names', () => {
    expect(initials('สมศักดิ์ ศรีสวัสดิ์')).toBe('สศ');
    expect(initials('เอกชัย ใจดี')).toBe('อจ'); // leading vowels skipped
    expect(initials('jane doe smith')).toBe('JD');
    expect(initials('  ')).toBe('');
    expect(initials(null)).toBe('');
  });

  it('flags a board with duplicate or no lanes', () => {
    const ui = (lanes: KanbanSpec['lanes']) => ({
      module: 'x', label: 'X', icon: 'box', menu: [{ label: 'L', screen: 'l' }],
      screens: { l: { kind: 'list', title: 'L', endpoint: '/l', columns: [{ key: 'no', label: 'เลขที่' }], kanban: { ...spec, lanes } } },
    }) as unknown as ModuleUi;
    expect(brokenLinks(ui([{ value: 'a', label: 'A' }, { value: 'a', label: 'A2' }])).join()).toMatch(/two lanes with the same value/);
    expect(brokenLinks(ui([])).join()).toMatch(/has no lanes/);
    expect(brokenLinks(ui([{ value: 'a', label: 'A' }])).filter((p) => p.includes('kanban'))).toEqual([]);
  });
});
