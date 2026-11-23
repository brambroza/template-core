'use client';
/**
 * Kanban view of a list (ListScreen.kanban): one lane per status value, the list's rows as cards.
 * Read-only board — a card opens the record, where the stage buttons (ไปขั้นถัดไป, ปิดการขายได้ …) keep their rules and confirmations.
 * Lanes scroll sideways inside the board on narrow screens; the page itself never does.
 */
import Link from 'next/link';
import { get, initials, kanbanLanes, statusTone, type KanbanSpec } from '@erp/ui-schema';
import { Value } from './Value';

const blank = (v: unknown) => v === undefined || v === null || v === '';

/**
 * @param spec the screen's kanban spec
 * @param rows the list rows (already filtered by the list's filters)
 * @param hrefOf the detail link for a row, as the table uses it
 */
export function KanbanBoard({ spec, rows, hrefOf }: { spec: KanbanSpec; rows: Record<string, unknown>[]; hrefOf: (row: Record<string, unknown>) => string | undefined }) {
  const lanes = kanbanLanes(spec, rows);
  return (
    <div className="kanban" role="list" aria-label="มุมมอง Kanban">
      {lanes.map((lane) => (
        <section key={lane.value} className={`kb-lane${lane.closed ? ' is-closed' : ''}`} role="listitem" aria-label={`${lane.label} ${lane.rows.length} รายการ`}>
          <header className="kb-head">
            <span className={`kb-dot tone-${statusTone(lane.value)}`} aria-hidden />
            <h2>{lane.label}</h2>
            <span className="kb-count">{lane.rows.length.toLocaleString('th-TH')}</span>
            {lane.total !== null && spec.amount && lane.rows.length > 0 && (
              <span className="kb-total"><Value value={lane.total} format={spec.amount.format} /></span>
            )}
          </header>
          <ol className="kb-cards">
            {lane.rows.length === 0 && <li className="kb-empty">ไม่มีรายการ</li>}
            {lane.rows.map((row, i) => {
              const href = hrefOf(row);
              const person = spec.person ? String(get(row, spec.person) ?? '') : '';
              const title = String(get(row, spec.title) ?? '—');
              const subtitle = spec.subtitle ? get(row, spec.subtitle) : undefined;
              const amount = spec.amount ? get(row, spec.amount.key) : undefined;
              const meta = (spec.meta ?? []).filter((c) => !blank(get(row, c.key)));
              const body = (
                <>
                  <span className="kb-no">{String(get(row, 'no') ?? '')}</span>
                  <strong className="kb-title">{title}</strong>
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
              return (
                <li key={String(row.id ?? i)}>
                  {href ? <Link className="kb-card" href={href}>{body}</Link> : <div className="kb-card">{body}</div>}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
