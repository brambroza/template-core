'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCorners, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { ChevronRight, GripVertical, Lock } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  boardCardColumns, boardLanes, boardMoves, formatValue, get, hasPerm, matches, pickMove, statusTone,
  type Action, type ListScreen, type ModuleUi,
} from '@erp/ui-schema';
import { SPRING } from '@/lib/motion';
import { screenHref } from '@/lib/nav';
import { loadSession } from '@/lib/session';
import { ActionButton } from './ActionButton';
import { Value } from './Value';

type Row = Record<string, unknown>;
const rowId = (row: Row, i: number) => String(row.id ?? i);

/**
 * A list as a kanban board (ListScreen `display: 'board'`). Dragging a card to another lane runs one of the detail
 * screen's own actions (BoardSpec.moves) — the server decides; the card moves at once and goes back if the server says no.
 * Works with a mouse, a finger (press and hold) and the keyboard (focus the handle, Space, arrows, Space).
 */
export function BoardView({ module, ui, screen, rows, onChanged }: {
  module: string; ui: ModuleUi | undefined; screen: ListScreen; rows: Row[]; onChanged: () => void;
}) {
  const router = useRouter();
  const board = screen.board!;
  const perms = loadSession()?.permissions ?? [];
  const moves = useMemo(() => (ui ? boardMoves(ui, screen) : {}), [ui, screen]);
  const cardCols = boardCardColumns(screen);
  const rowActions = (screen.rowActions ?? []).filter((a) => hasPerm(perms, a.perm));
  /** cards moved locally while the server works: id -> lane */
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState<Row | null>(null);
  const [pending, setPending] = useState<{ row: Row; action: Action; to: string } | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  /** the card that just landed: a short green ring says "the server agreed" */
  const [landed, setLanded] = useState<string | null>(null);

  const view = rows.map((r, i) => {
    const id = rowId(r, i);
    return moved[id] !== undefined ? { ...r, [board.field]: moved[id], __id: id } : { ...r, __id: id };
  });
  const lanes = boardLanes(board, view);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    // Space only: Enter keeps opening the card's link
    useSensor(KeyboardSensor, { keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] } }),
  );
  const original = (id: string) => rows.find((r, i) => rowId(r, i) === id);
  const canDrop = (row: Row | null, to: string) => !!row && !!pickMove(moves, row, to, perms, board.field);
  const anyMoves = Object.keys(moves).length > 0;

  const onStart = (e: DragStartEvent) => setDragging(original(String(e.active.id)) ?? null);
  const onEnd = (e: DragEndEvent) => {
    setDragging(null);
    const id = String(e.active.id);
    const to = e.over ? String(e.over.id) : '';
    const row = original(id);
    if (!row || !to) return;
    const action = pickMove(moves, row, to, perms, board.field);
    if (!action) return;
    setMoved((m) => ({ ...m, [id]: to }));
    setPending({ row, action, to });
  };
  const settle = (id: string) => setMoved((m) => { const n = { ...m }; delete n[id]; return n; });

  const collapsed = (value: string) => (board.collapsed ?? []).includes(value) && !opened.includes(value);
  const announce = {
    onDragStart: ({ active }: { active: { id: string | number } }) => `หยิบการ์ด ${String(get(original(String(active.id)), cardCols[0]?.key ?? 'id') ?? '')}`,
    onDragOver: ({ over }: { over: { id: string | number } | null }) => (over ? `อยู่เหนือ ${board.lanes.find((l) => l.value === over.id)?.label ?? ''}` : 'ไม่ได้อยู่เหนือคอลัมน์ใด'),
    onDragEnd: ({ over }: { over: { id: string | number } | null }) => (over ? `วางใน ${board.lanes.find((l) => l.value === over.id)?.label ?? ''}` : 'ยกเลิกการย้าย'),
    onDragCancel: () => 'ยกเลิกการย้าย',
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setDragging(null)}
      accessibility={{ announcements: announce, screenReaderInstructions: { draggable: 'กด Space เพื่อหยิบการ์ด ใช้ลูกศรเลือกคอลัมน์ แล้วกด Space อีกครั้งเพื่อวาง หรือ Esc เพื่อยกเลิก' } }}>
      {anyMoves && <p className="board-hint muted no-print">ลากการ์ดไปคอลัมน์อื่นเพื่อเปลี่ยนสถานะ — ระบบใช้ขั้นตอนเดียวกับปุ่มในหน้าเอกสาร</p>}
      <LayoutGroup>
      <div className="board" role="list" aria-label={screen.title}>
        {lanes.map((lane) => (
          <Lane key={lane.value} value={lane.value} label={lane.label} count={lane.rows.length}
            sum={board.sum ? [board.sum.label, formatValue(lane.sum, board.sum.format ?? 'qty'), board.sum.unit].filter(Boolean).join(' ') : ''}
            dragging={!!dragging} allowed={canDrop(dragging, lane.value)} home={!!dragging && String(get(dragging, board.field)) === lane.value}
            collapsed={collapsed(lane.value)} onOpen={() => setOpened((o) => [...o, lane.value])}>
            {lane.rows.length === 0 && <p className="board-empty">ไม่มีรายการ</p>}
            <AnimatePresence initial={false} mode="popLayout">
              {lane.rows.map((row) => (
                <Card key={String(row.__id)} id={String(row.__id)} row={row} cols={cardCols} module={module} screen={screen}
                  draggable={anyMoves && Object.keys(moves).some((to) => canDrop(row, to))} busy={moved[String(row.__id)] !== undefined}
                  landed={landed === String(row.__id)} dragging={dragging !== null && String(dragging.id ?? '') === String(row.id ?? '')}
                  actions={rowActions.filter((a) => matches(row, a.when))} onAction={onChanged} onOpen={(href) => router.push(href)} />
              ))}
            </AnimatePresence>
          </Lane>
        ))}
      </div>
      </LayoutGroup>
      <DragOverlay dropAnimation={null}>
        {dragging && <CardBody row={dragging} cols={cardCols} module={module} screen={screen} overlay />}
      </DragOverlay>
      {pending && (
        <ActionButton key={`${String(pending.row.id)}-${pending.to}`} auto action={pending.action} module={module} params={pending.row}
          onDone={() => { const id = String(pending.row.id); setPending(null); onChanged(); setLanded(id); setTimeout(() => settle(id), 600); setTimeout(() => setLanded((x) => (x === id ? null : x)), 1600); }}
          onCancel={() => { settle(String(pending.row.id)); setPending(null); }} />
      )}
    </DndContext>
  );
}

function Lane({ value, label, count, sum, dragging, allowed, home, collapsed, onOpen, children }: {
  value: string; label: string; count: number; sum: string; dragging: boolean; allowed: boolean; home: boolean; collapsed: boolean; onOpen: () => void; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: value, disabled: !allowed });
  const state = !dragging ? '' : home ? ' is-home' : allowed ? (isOver ? ' is-over' : ' can-drop') : ' no-drop';
  const narrow = collapsed && !(dragging && allowed);
  return (
    <section ref={setNodeRef} className={`lane tone-lane-${statusTone(value)}${state}${narrow ? ' is-collapsed' : ''}`} role="listitem" aria-label={`${label} ${count} รายการ`}>
      <header className="lane-head">
        <span className={`lane-dot tone-${statusTone(value)}`} aria-hidden />
        <b>{label}</b>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={count} className="lane-count" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={SPRING.pop}>
            {count.toLocaleString('th-TH')}
          </motion.span>
        </AnimatePresence>
        {narrow ? (
          <button type="button" className="btn-ghost lane-open" onClick={onOpen} aria-label={`แสดง ${label}`}><ChevronRight size={16} aria-hidden /></button>
        ) : sum && <span className="lane-sum">{sum}</span>}
        {dragging && !allowed && !home && <Lock size={14} className="lane-lock" aria-label="ย้ายมาคอลัมน์นี้ไม่ได้" />}
      </header>
      {!narrow && <div className="lane-body">{children}</div>}
    </section>
  );
}

function Card({ id, row, cols, module, screen, draggable, busy, landed, dragging, actions, onAction, onOpen }: {
  id: string; row: Row; cols: ListScreen['columns']; module: string; screen: ListScreen; draggable: boolean; busy: boolean;
  landed: boolean; dragging: boolean; actions: Action[]; onAction: () => void; onOpen: (href: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled: !draggable });
  const href = screen.rowLink && row.id !== undefined ? screenHref(module, screen.rowLink.screen, get(row, screen.rowLink.idFrom ?? 'id')) : undefined;
  return (
    // `layoutId`: when the card changes lane it glides there (Motion); the drag itself is drawn by DragOverlay
    <motion.article ref={setNodeRef} layout={!dragging} layoutId={`kcard-${id}`} transition={SPRING.snappy}
      initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: isDragging ? 0.35 : busy ? 0.6 : 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
      className={`kcard${isDragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}${draggable ? ' is-draggable' : ''}${landed ? ' is-landed' : ''}`}
      onClick={href ? () => onOpen(href) : undefined} {...(draggable ? listeners : {})}>
      {draggable && (
        <button type="button" className="kcard-grip" aria-label="ย้ายการ์ด (Space)" {...attributes} onClick={(e) => e.stopPropagation()}>
          <GripVertical size={14} aria-hidden />
        </button>
      )}
      <CardBody row={row} cols={cols} module={module} screen={screen} href={href} />
      {actions.length > 0 && (
        <div className="kcard-actions" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {actions.map((a) => <ActionButton key={a.id} action={a} module={module} params={row} onDone={onAction} />)}
        </div>
      )}
    </motion.article>
  );
}

function CardBody({ row, cols, href, overlay }: { row: Row; cols: ListScreen['columns']; module: string; screen: ListScreen; href?: string; overlay?: boolean }) {
  const [head, sub, ...facts] = cols;
  const shown = facts.filter((c) => {
    const v = get(row, c.key);
    return v !== undefined && v !== null && v !== '' && !(c.format === 'boolean' && v === false);
  });
  return (
    <div className={overlay ? 'kcard kcard-overlay' : 'kcard-body'}>
      {head && (
        <h3>{href ? <Link href={href} onClick={(e) => e.stopPropagation()}><Value value={get(row, head.key)} format={head.format} /></Link> : <Value value={get(row, head.key)} format={head.format} />}</h3>
      )}
      {sub && get(row, sub.key) !== undefined && get(row, sub.key) !== '' && <p className="kcard-sub"><Value value={get(row, sub.key)} format={sub.format} /></p>}
      {shown.length > 0 && (
        <dl>{shown.map((c) => <div key={c.key}><dt>{c.label}</dt><dd><Value value={get(row, c.key)} format={c.format} /></dd></div>)}</dl>
      )}
    </div>
  );
}
