import { describe, expect, it } from 'vitest';
import { initials, kanbanLanes, kanbanMove, brokenLinks, type Action, type KanbanSpec, type ModuleUi } from '../src/index.ts';

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

describe('kanban moves', () => {
  const advance: Action = { id: 'advance', label: 'ไปขั้นถัดไป', method: 'POST', endpoint: '/o/:id/advance', perm: 'crm.lead.write', when: { field: 'stage', in: ['prospect', 'proposal'] } };
  const win: Action = { id: 'win', label: 'ปิดการขายได้', method: 'POST', endpoint: '/o/:id/win', perm: 'crm.lead.write', when: { field: 'stage', in: ['prospect', 'proposal'] }, confirm: 'ยืนยัน' };
  const board: KanbanSpec = { ...spec, moves: [{ to: 'proposal', from: ['prospect'], action: advance }, { to: 'won', action: win }] };
  const writer = ['crm.lead.write'];

  it('finds the move for a drop, honouring from, when and the permission', () => {
    expect(kanbanMove(board, { stage: 'prospect' }, 'proposal', writer)?.action.id).toBe('advance');
    expect(kanbanMove(board, { stage: 'prospect' }, 'won', writer)?.action.id).toBe('win');
    expect(kanbanMove(board, { stage: 'proposal' }, 'proposal', writer)).toBeUndefined(); // same lane
    expect(kanbanMove(board, { stage: 'won' }, 'proposal', writer)).toBeUndefined(); // not from won
    expect(kanbanMove({ ...board, moves: [{ to: 'won', action: win }] }, { stage: 'won-ish' }, 'won', writer)).toBeUndefined(); // when fails
    expect(kanbanMove(board, { stage: 'prospect' }, 'won', ['crm.lead.read'])).toBeUndefined(); // no permission
    expect(kanbanMove({ ...board, moves: undefined }, { stage: 'prospect' }, 'proposal', writer)).toBeUndefined(); // no moves = read-only
  });

  it('flags moves to or from a lane the board does not have', () => {
    const ui = {
      module: 'x', label: 'X', icon: 'box', menu: [{ label: 'L', screen: 'l' }],
      screens: { l: { kind: 'list', title: 'L', endpoint: '/l', columns: [{ key: 'no', label: 'เลขที่' }], kanban: { ...board, moves: [{ to: 'nowhere', from: ['prospect'], action: { ...advance, then: { screen: 'missing' } } }] } } },
    } as unknown as ModuleUi;
    const problems = brokenLinks(ui).join('\n');
    expect(problems).toMatch(/move "advance" uses unknown lane "nowhere"/);
    expect(problems).toMatch(/kanban.advance.then points to unknown screen "missing"/);
  });
});
