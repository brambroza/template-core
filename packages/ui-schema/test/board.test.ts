import { describe, expect, it } from 'vitest';
import { boardLanes, boardMoves, boardProblems, brokenLinks, defineUi, pickMove, type ListScreen, type ModuleUi } from '../src/index.ts';

const ui: ModuleUi = defineUi({
  module: 'helpdesk', label: 'แจ้งปัญหา', glyph: 'ช',
  menu: [{ label: 'เรื่องแจ้ง', screen: 'tickets' }],
  screens: {
    tickets: {
      kind: 'list', title: 'เรื่องแจ้ง', endpoint: '/tickets', display: 'board', rowLink: { screen: 'ticket' },
      columns: [{ key: 'no', label: 'เลขที่' }, { key: 'subject', label: 'เรื่อง' }, { key: 'status', label: 'สถานะ', format: 'status' }],
      board: {
        field: 'status',
        lanes: [{ value: 'open', label: 'รอรับเรื่อง' }, { value: 'in_progress', label: 'กำลังทำ' }, { value: 'resolved', label: 'แก้แล้ว' }],
        moves: { in_progress: ['start'], resolved: ['resolve'] },
        sum: { key: 'hours' },
        collapsed: ['resolved'],
      },
    },
    ticket: {
      kind: 'detail', title: 'เรื่องแจ้ง', endpoint: '/tickets/:id', heading: 'no', fields: [],
      actions: [
        { id: 'start', label: 'เริ่ม', method: 'POST', endpoint: '/tickets/:id/start', perm: 'helpdesk.ticket.work', when: { field: 'status', in: ['open'] } },
        { id: 'resolve', label: 'แก้แล้ว', method: 'POST', endpoint: '/tickets/:id/resolve', perm: 'helpdesk.ticket.work', when: { field: 'status', in: ['open', 'in_progress'] },
          fields: [{ name: 'resolution', label: 'วิธีแก้', type: 'textarea', required: true }] },
        { id: 'note', label: 'โน้ต', method: 'POST', endpoint: '/tickets/:id/note' },
      ],
    },
  },
});
const list = ui.screens.tickets as ListScreen;
const rows = [
  { id: '1', no: 'T-1', status: 'open', hours: 2 },
  { id: '2', no: 'T-2', status: 'in_progress', hours: 3 },
  { id: '3', no: 'T-3', status: 'open', hours: 1.5 },
  { id: '4', no: 'T-4', status: 'closed', hours: 9 },
];

describe('kanban board', () => {
  it('groups rows into lanes in lane order and sums the lane field', () => {
    const lanes = boardLanes(list.board!, rows);
    expect(lanes.map((l) => [l.value, l.rows.map((r) => r.no), l.sum])).toEqual([
      ['open', ['T-1', 'T-3'], 3.5], ['in_progress', ['T-2'], 3], ['resolved', [], 0],
    ]);
  });

  it('moves run the detail screen’s own actions, only when allowed for that card and user', () => {
    const moves = boardMoves(ui, list);
    expect(moves.in_progress.map((m) => m.action.endpoint)).toEqual(['/tickets/:id/start']);
    const perms = ['helpdesk.ticket.work'];
    expect(pickMove(moves, rows[0], 'in_progress', perms, 'status')?.id).toBe('start');
    expect(pickMove(moves, rows[1], 'in_progress', perms, 'status')).toBeNull(); // already there
    expect(pickMove(moves, rows[1], 'resolved', perms, 'status')?.id).toBe('resolve');
    expect(pickMove(moves, rows[0], 'open', perms, 'status')).toBeNull(); // no move into "open"
    expect(pickMove(moves, rows[0], 'in_progress', ['helpdesk.ticket.read'], 'status')).toBeNull(); // no permission
  });

  it('a step action only lands in a lane from the lanes given in `from`', () => {
    const step = boardMoves(ui, { ...list, board: { ...list.board!, moves: { resolved: [{ action: 'resolve', from: ['in_progress'] }] } } });
    const perms = ['*'];
    expect(pickMove(step, rows[1], 'resolved', perms, 'status')?.id).toBe('resolve');
    expect(pickMove(step, rows[0], 'resolved', perms, 'status')).toBeNull(); // open -> resolved is not this move
    expect(boardProblems(ui, 'tickets', { ...list, board: { ...list.board!, moves: { resolved: [{ action: 'resolve', from: ['nope'] }] } } }))
      .toEqual(['helpdesk: tickets.board.moves.resolved: from "nope" is not a lane']);
  });

  it('reports board mistakes through brokenLinks', () => {
    expect(brokenLinks(ui)).toEqual([]);
    const bad = (board: ListScreen['board'], extra: Partial<ListScreen> = {}) => boardProblems(ui, 'tickets', { ...list, ...extra, board });
    expect(bad({ ...list.board!, moves: { done: ['start'] } })).toEqual(['helpdesk: tickets.board.moves "done" is not a lane']);
    expect(bad({ ...list.board!, moves: { resolved: ['gone'] } })).toEqual(['helpdesk: tickets.board.moves.resolved: no action "gone" on ticket']);
    expect(bad({ ...list.board!, moves: { resolved: ['note'] } })[0]).toContain('must have when.field "status"');
    expect(bad({ ...list.board!, lanes: [...list.board!.lanes, { value: 'open', label: 'x' }] })).toContain('helpdesk: tickets.board declares a lane twice');
    expect(bad(undefined)).toEqual(["helpdesk: tickets has display 'board' but no board"]);
    expect(bad(list.board, { display: 'table' })).toEqual(["helpdesk: tickets.board is set but display is not 'board'"]);
    expect(bad(list.board, { rowLink: undefined })[0]).toContain('need rowLink to a detail screen');
  });
});
