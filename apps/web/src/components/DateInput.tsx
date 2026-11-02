'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  calendarWeeks, parseDateText, shiftIsoDay, shiftIsoMonth, thaiDateText, TH_MONTHS, TH_MONTHS_SHORT, TH_WEEKDAYS,
} from '@erp/ui-schema';
import { SPRING } from '@/lib/motion';

type Kind = 'date' | 'month';
type View = 'days' | 'months' | 'years';

const todayIso = () => {
  // the business day is Bangkok's (kernel thaiToday); the browser is in Thailand for every real user
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const be = (y: number) => y + 543;
const longLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${TH_MONTHS[m - 1]} ${be(y)}`;
};
export interface DateInputProps {
  kind?: Kind;
  /** ISO: YYYY-MM-DD (date) or YYYY-MM (month); "" = empty */
  value: string;
  onChange: (iso: string) => void;
  /** the field's label — the box's accessible name (forms and tests find it by this) */
  label: string;
  invalid?: boolean;
  min?: string;
  max?: string;
  /** shade the days between these in the calendar (a from–to filter) */
  range?: { from?: string; to?: string };
  placeholder?: string;
  className?: string;
}

/**
 * A Thai date box: shows "31 ต.ค. 2569", accepts what people type (31/10/2569, 2026-10-31, 31 ต.ค. 69 …) and opens a
 * Buddhist-era calendar (days → months → years) with Today / Clear. Keyboard: Alt+↓ opens; in the calendar ←→↑↓ move,
 * PageUp/PageDown change month, Enter picks, Esc closes. The value stays ISO, so APIs and tests are unchanged.
 */
export function DateInput({ kind = 'date', value, onChange, label, invalid, min, max, range, placeholder, className }: DateInputProps) {
  /** what the person has typed, while they are typing; null = show the value */
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const popId = useId();

  const shown = draft ?? thaiDateText(value, kind);
  const type = (text: string) => {
    setDraft(text);
    const iso = parseDateText(text, kind);
    setBad(iso === null);
    if (iso !== null && iso !== value) onChange(iso);
  };
  const pick = (iso: string) => {
    onChange(iso);
    setDraft(null);
    setBad(false);
    setOpen(false);
    input.current?.focus();
  };

  return (
    <div ref={box} className={`date-input${invalid || bad ? ' is-invalid' : ''}${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <input ref={input} type="text" inputMode="numeric" autoComplete="off" aria-label={label} aria-invalid={invalid || bad || undefined}
        placeholder={placeholder ?? (kind === 'month' ? 'ด/ปปปป' : 'วว/ดด/ปปปป')}
        value={shown}
        // the text never changes on focus (a select-all + type would append to it); typed text shows until the box is left
        onBlur={() => { setDraft(null); setBad(false); }}
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => {
          if ((e.altKey && e.key === 'ArrowDown') || (e.key === 'ArrowDown' && !draft)) { e.preventDefault(); setOpen(true); }
          if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false); }
        }} />
      {value && draft === null && (
        <button type="button" className="date-clear" aria-label="ล้างวันที่" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => onChange('')}>
          <X size={14} aria-hidden />
        </button>
      )}
      <button type="button" className="date-open" aria-label="เปิดปฏิทิน" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popId : undefined}
        onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
        <CalendarDays size={16} aria-hidden />
      </button>
      <CalendarPopover id={popId} open={open} anchor={box} kind={kind} value={value} min={min} max={max} range={range}
        onPick={pick} onClose={() => { setOpen(false); input.current?.focus(); }} />
    </div>
  );
}

function CalendarPopover({ id, open, anchor, kind, value, min, max, range, onPick, onClose }: {
  id: string; open: boolean; anchor: React.RefObject<HTMLDivElement | null>; kind: Kind; value: string; min?: string; max?: string;
  range?: { from?: string; to?: string }; onPick: (iso: string) => void; onClose: () => void;
}) {
  const today = todayIso();
  const start = (kind === 'month' ? (value ? `${value}-01` : '') : value) || today;
  const [cursor, setCursor] = useState(start);
  const [view, setView] = useState<View>(kind === 'month' ? 'months' : 'days');
  const [dir, setDir] = useState(0);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; up: boolean } | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const host = useMemo(() => (open ? (anchor.current?.closest('dialog') as HTMLElement | null) ?? document.body : null), [open]);

  // reset to the value each time it opens
  useEffect(() => { if (open) { setCursor(start); setView(kind === 'month' ? 'months' : 'days'); } }, [open]);
  // below the box, or above it when there is no room; follows scrolling
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const h = 360, w = 300;
      const up = r.bottom + h > window.innerHeight && r.top > h;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
      setPos(up ? { bottom: window.innerHeight - r.top + 8, left, up } : { top: r.bottom + 8, left, up });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);
  // click outside closes
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  // keyboard focus follows the cursor day
  useEffect(() => {
    if (open && view === 'days') pop.current?.querySelector<HTMLButtonElement>(`[data-iso="${cursor}"]`)?.focus({ preventScroll: true });
  }, [open, cursor, view, pos !== null]);

  const [y, m] = cursor.split('-').map(Number);
  const out = (iso: string) => (!!min && iso < min) || (!!max && iso > max);
  const move = (months: number) => { setDir(months > 0 ? 1 : -1); setCursor(shiftIsoMonth(cursor, months)); };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (view !== 'days') return;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (step[e.key] !== undefined) {
      e.preventDefault();
      const next = shiftIsoDay(cursor, step[e.key]);
      if (next.slice(0, 7) !== cursor.slice(0, 7)) setDir(step[e.key] > 0 ? 1 : -1);
      setCursor(next);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); move(e.key === 'PageDown' ? 1 : -1); }
    else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const wd = new Date(`${cursor}T00:00:00Z`).getUTCDay();
      setCursor(shiftIsoDay(cursor, e.key === 'Home' ? -wd : 6 - wd));
    }
  };

  const title = view === 'days' ? `${TH_MONTHS[m - 1]} ${be(y)}` : view === 'months' ? `พ.ศ. ${be(y)}` : `พ.ศ. ${be(y - 7)} – ${be(y + 4)}`;
  const prev = () => (view === 'days' ? move(-1) : view === 'months' ? (setDir(-1), setCursor(shiftIsoMonth(cursor, -12))) : (setDir(-1), setCursor(shiftIsoMonth(cursor, -144))));
  const next = () => (view === 'days' ? move(1) : view === 'months' ? (setDir(1), setCursor(shiftIsoMonth(cursor, 12))) : (setDir(1), setCursor(shiftIsoMonth(cursor, 144))));

  if (!host) return null;
  return createPortal(
    <AnimatePresence>
      {open && pos && (
        <motion.div ref={pop} id={id} role="dialog" aria-label="เลือกวันที่" className="cal-pop"
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, transformOrigin: pos.up ? 'bottom left' : 'top left' }}
          initial={{ opacity: 0, scale: 0.96, y: pos.up ? 6 : -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
          transition={SPRING.soft} onKeyDown={keys}>
          <header className="cal-head">
            <button type="button" className="cal-nav" aria-label="ก่อนหน้า" onClick={prev}><ChevronLeft size={16} aria-hidden /></button>
            <button type="button" className="cal-title" aria-live="polite"
              onClick={() => setView(view === 'days' ? 'months' : 'years')} disabled={view === 'years'}>{title}</button>
            <button type="button" className="cal-nav" aria-label="ถัดไป" onClick={next}><ChevronRight size={16} aria-hidden /></button>
          </header>

          <div className="cal-body">
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.div key={`${view}-${view === 'days' ? cursor.slice(0, 7) : view === 'months' ? y : Math.floor(y / 12)}`} custom={dir}
                initial={{ opacity: 0, x: dir * 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -24 }} transition={{ duration: 0.18, ease: 'easeOut' }}>
                {view === 'days' && (
                  <table className="cal-grid" role="grid">
                    <thead><tr>{TH_WEEKDAYS.map((w, i) => <th key={w} scope="col" className={i === 0 ? 'is-sun' : undefined}>{w}</th>)}</tr></thead>
                    <tbody>
                      {calendarWeeks(y, m).map((week) => (
                        <tr key={week[0].iso}>
                          {week.map((d) => {
                            const inRange = !!range?.from && !!range?.to && d.iso >= range.from && d.iso <= range.to;
                            const edge = d.iso === range?.from || d.iso === range?.to;
                            const cls = ['cal-day', d.inMonth ? '' : 'is-other', d.iso === today ? 'is-today' : '', d.iso === value ? 'is-selected' : '',
                              inRange ? 'in-range' : '', edge ? 'is-edge' : ''].filter(Boolean).join(' ');
                            return (
                              <td key={d.iso} role="gridcell" aria-selected={d.iso === value}>
                                <button type="button" className={cls} data-iso={d.iso} tabIndex={d.iso === cursor ? 0 : -1} disabled={out(d.iso)}
                                  aria-label={longLabel(d.iso)} aria-current={d.iso === today ? 'date' : undefined}
                                  onClick={() => onPick(d.iso)}>
                                  {d.iso === value && <motion.span layoutId={`${id}-sel`} className="cal-sel" transition={SPRING.snappy} aria-hidden />}
                                  <span>{d.day}</span>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {view === 'months' && (
                  <div className="cal-tiles">
                    {TH_MONTHS_SHORT.map((label, i) => {
                      const ym = `${y}-${String(i + 1).padStart(2, '0')}`;
                      const sel = kind === 'month' ? value === ym : value.slice(0, 7) === ym;
                      return (
                        <button key={label} type="button" className={`cal-tile${sel ? ' is-selected' : ''}${today.slice(0, 7) === ym ? ' is-today' : ''}`}
                          aria-label={`${TH_MONTHS[i]} ${be(y)}`}
                          onClick={() => (kind === 'month' ? onPick(ym) : (setCursor(`${ym}-01`), setView('days')))}>{label}</button>
                      );
                    })}
                  </div>
                )}
                {view === 'years' && (
                  <div className="cal-tiles">
                    {Array.from({ length: 12 }, (_, i) => y - 7 + i).map((yy) => (
                      <button key={yy} type="button" className={`cal-tile${String(yy) === value.slice(0, 4) ? ' is-selected' : ''}${String(yy) === today.slice(0, 4) ? ' is-today' : ''}`}
                        onClick={() => { setCursor(`${yy}-${String(m).padStart(2, '0')}-01`); setView('months'); }}>{be(yy)}</button>
                    ))}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <footer className="cal-foot">
            <button type="button" className="btn-ghost" onClick={() => onPick(kind === 'month' ? today.slice(0, 7) : today)} disabled={kind === 'date' && out(today)}>
              {kind === 'month' ? 'เดือนนี้' : 'วันนี้'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => onPick('')}>ล้าง</button>
          </footer>
        </motion.div>
      )}
    </AnimatePresence>,
    host,
  );
}
