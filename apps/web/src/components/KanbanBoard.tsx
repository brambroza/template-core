'use client';
/**
 * Kanban view of a list (ListScreen.kanban): one lane per status value, the list's rows as cards.
 *
 * Moving a card: drag it to another lane (mouse), or use its "ย้าย" button (touch, keyboard). Only the moves the spec lists are
 * offered — each runs the module's own action (ไปขั้นถัดไป, ปิดการขายได้, แพ้ …) with its confirmation or fields dialog, so the
 * board never sets a stage the module would not. Lanes a card cannot reach are dimmed while it is dragged.
 * Lanes scroll sideways inside the board on narrow screens; the page itself never does.
 */
import Link from 'next/link';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { get, initials, kanbanLanes, kanbanMove, statusTone, type KanbanMove, type KanbanSpec } from '@erp/ui-schema';
import { ActionButton } from './ActionButton';
import { Value } from './Value';

type Row = Record<string, unknown>;
const blank = (v: unknown) => v === undefined || v === null || v === '';
const rowKey = (row: Row, i: number) => String(row.id ?? i);

/**
 * @param spec the screen's kanban spec
 * @param rows the list rows (already filtered by the list's filters)
 * @param module the module the actions belong to
 * @param perms the user's permissions (moves need their action's perm)
 * @param hrefOf the detail link for a row, as the table uses it
 * @param onMoved called after a move's action succeeded, with the move and the action's response
 */
export function KanbanBoard({ spec, rows, module, perms, hrefOf, onMoved }: {
  spec: KanbanSpec; rows: Row[]; module: string; perms: string[];
  hrefOf: (row: Row) => string | undefined; onMoved: (move: KanbanMove, result: unknown) => void;
}) {
  const lanes = kanbanLanes(spec, rows);
  const [dragging, setDragging] = useState<Row | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, setPending] = useState<{ row: Row; move: KanbanMove } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const targetsOf = (row: Row) => lanes.map((l) => ({ lane: l, move: kanbanMove(spec, row, l.value, perms) })).filter((t): t is { lane: typeof t.lane; move: KanbanMove } => !!t.move);

  const start = (row: Row, move: KanbanMove) => { setMenuFor(null); setPending({ row, move }); };
  const endDrag = () => { setDragging(null); setOver(null); };

  return (
    <div className={`kanban${dragging ? ' is-dragging' : ''}`} role="list" aria-label="มุมมอง Kanban">
      {lanes.map((lane) => {
        const dropMove = dragging ? kanbanMove(spec, dragging, lane.value, perms) : undefined;
        const laneState = !dragging ? '' : dropMove ? (over === lane.value ? ' is-over' : ' can-drop') : String(get(dragging, spec.field)) === lane.value ? ' is-source' : ' no-drop';
        return (
          <section key={lane.value} className={`kb-lane${lane.closed ? ' is-closed' : ''}${laneState}`} role="listitem" aria-label={`${lane.label} ${lane.rows.length} รายการ`}
            onDragOver={(e) => { if (!dropMove) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== lane.value) setOver(lane.value); }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over === lane.value) setOver(null); }}
            onDrop={(e) => { e.preventDefault(); const row = dragging; endDrag(); if (row && dropMove) start(row, dropMove); }}>
            <header className="kb-head">
              <span className={`kb-dot tone-${statusTone(lane.value)}`} aria-hidden />
              <h2>{lane.label}</h2>
              <span className="kb-count">{lane.rows.length.toLocaleString('th-TH')}</span>
              {lane.total !== null && spec.amount && lane.rows.length > 0 && (
                <span className="kb-total"><Value value={lane.total} format={spec.amount.format} /></span>
              )}
            </header>
            {dropMove && <p className="kb-drop-hint" aria-hidden>วางเพื่อ “{dropMove.action.label}”</p>}
            <ol className="kb-cards">
              {lane.rows.length === 0 && !dropMove && <li className="kb-empty">ไม่มีรายการ</li>}
              {lane.rows.map((row, i) => {
                const key = rowKey(row, i);
                const href = hrefOf(row);
                const targets = targetsOf(row);
                const moving = pending?.row === row;
                return (
                  <li key={key} className={`kb-item${moving ? ' is-moving' : ''}${dragging === row ? ' is-ghost' : ''}`}>
                    <Card spec={spec} row={row} href={href} draggable={targets.length > 0 && !pending}
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', key); setMenuFor(null); setDragging(row); }}
                      onDragEnd={endDrag} />
                    {moving && <span className="kb-busy" aria-label="กำลังย้าย"><Loader2 size={16} className="spin" aria-hidden /></span>}
                    {targets.length > 0 && !pending && (
                      <MoveMenu label={String(get(row, spec.title) ?? '')} open={menuFor === key} onToggle={(o) => setMenuFor(o ? key : null)}
                        targets={targets.map((t) => ({ value: t.lane.value, label: t.lane.label, action: t.move.action.label, tone: t.move.action.tone }))}
                        onPick={(value) => { const t = targets.find((x) => x.lane.value === value); if (t) start(row, t.move); }} />
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
      {pending && (
        <ActionButton key={`${rowKey(pending.row, 0)}:${pending.move.to}`} auto action={pending.move.action} module={module} params={pending.row}
          onDone={(result) => { const m = pending.move; setPending(null); onMoved(m, result); }}
          onCancel={() => setPending(null)} />
      )}
    </div>
  );
}

/** One card: a link to the record, draggable when the card has somewhere to go. */
function Card({ spec, row, href, draggable, onDragStart, onDragEnd }: {
  spec: KanbanSpec; row: Row; href?: string; draggable: boolean;
  onDragStart: (e: DragEvent) => void; onDragEnd: () => void;
}) {
  const person = spec.person ? String(get(row, spec.person) ?? '') : '';
  const subtitle = spec.subtitle ? get(row, spec.subtitle) : undefined;
  const amount = spec.amount ? get(row, spec.amount.key) : undefined;
  const meta = (spec.meta ?? []).filter((c) => !blank(get(row, c.key)));
  const body = (
    <>
      <span className="kb-no">{String(get(row, 'no') ?? '')}</span>
      <strong className="kb-title">{String(get(row, spec.title) ?? '—')}</strong>
      {!blank(subtitle) && <span className="kb-sub">{String(subtitle)}</span>}
      {spec.amount && !blank(amount) && <span className="kb-amount"><Value value={amount} format={spec.amount.format} /></span>}
      {(meta.length > 0 || person) && (
        <span className="kb-foot">
          <span className="kb-meta">
            {meta.map((c) => <span key={c.key} title={c.label}><Value value={get(row, c.key)} format={c.format} /></span>)}
          </span>
          {person && <span className="kb-person" title={person} aria-label={`ผู้รับผิดชอบ ${person}`}>{initials(person)}</span>}
        </span>
      )}
    </>
  );
  const drag = draggable ? { draggable: true, onDragStart, onDragEnd } : { draggable: false };
  return href
    ? <Link className={`kb-card${draggable ? ' is-draggable' : ''}`} href={href} {...drag}>{body}</Link>
    : <div className={`kb-card${draggable ? ' is-draggable' : ''}`} {...drag}>{body}</div>;
}

/** "ย้าย" — the same moves as dragging, for touch screens and the keyboard. */
function MoveMenu({ label, open, onToggle, targets, onPick }: {
  label: string; open: boolean; onToggle: (open: boolean) => void;
  targets: { value: string; label: string; action: string; tone?: string }[]; onPick: (value: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) onToggle(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onToggle(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="kb-move" ref={box}>
      <button type="button" className="kb-move-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`ย้าย ${label}`} title="ย้ายไปขั้นอื่น"
        onClick={() => onToggle(!open)}>
        <ArrowRightLeft size={14} aria-hidden />
      </button>
      {open && (
        <div className="kb-menu" role="menu" aria-label={`ย้าย ${label} ไปที่`}>
          {targets.map((t) => (
            <button key={t.value} type="button" role="menuitem" className={t.tone === 'danger' ? 'is-danger' : undefined} onClick={() => onPick(t.value)}>
              <span className={`kb-dot tone-${statusTone(t.value)}`} aria-hidden />
              <span>{t.label}</span>
              {t.action !== t.label && <small>{t.action}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
