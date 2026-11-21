'use client';
/**
 * Date and month boxes in พ.ศ. The value handed to forms and filters stays ISO ("2026-10-03" / "2026-10"), so no service changes.
 * People can type (03/10/2569, 3/10/69, 3 ต.ค. 2569, 2026-10-03 …) or pick from a Sunday-first calendar that opens below the box.
 */
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import {
  calendarWeeks, dateInputText, monthInputText, parseDateInput, parseMonthInput, THAI_MONTHS, THAI_MONTHS_SHORT, THAI_WEEKDAYS_SHORT,
} from '@erp/ui-schema';

interface Props {
  kind: 'date' | 'month';
  value: string;
  onChange: (value: string) => void;
  label: string;
  min?: string;
  max?: string;
  invalid?: boolean;
}

/** Today in Bangkok as "YYYY-MM-DD" (business dates are Bangkok dates everywhere in the system). */
function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

/**
 * A date (or month) box: free typing in พ.ศ. plus a calendar button. Typing a complete valid date updates the value at once;
 * leaving the box with text that is not a date puts the last good value back.
 */
export function ThaiDateInput({ kind, value, onChange, label, min, max, invalid }: Props) {
  const show = kind === 'date' ? dateInputText : monthInputText;
  const parse = kind === 'date' ? parseDateInput : parseMonthInput;
  const [text, setText] = useState(show(value));
  const [open, setOpen] = useState(false);
  const [bad, setBad] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const popId = useId();

  // a value set from outside (preset chips, reset, AI fill) replaces what is shown
  useEffect(() => { if (parse(text) !== value) { setText(show(value)); setBad(false); } }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const type = (t: string) => {
    setText(t);
    if (!t.trim()) { setBad(false); if (value) onChange(''); return; }
    const v = parse(t);
    setBad(!v);
    if (v && v !== value && (!min || v >= min) && (!max || v <= max)) onChange(v);
  };
  const pick = (v: string) => { onChange(v); setText(show(v)); setBad(false); setOpen(false); };

  return (
    <div className="thai-date" ref={wrap} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}>
      <input
        type="text" inputMode={kind === 'date' ? 'numeric' : 'text'} aria-label={label} aria-invalid={invalid || bad}
        placeholder={kind === 'date' ? 'วว/ดด/ปปปป' : 'เดือน ปี พ.ศ.'} value={text} autoComplete="off"
        title={kind === 'date' ? 'พิมพ์ เช่น 03/10/2569 หรือ 3 ต.ค. 69 หรือเลือกจากปฏิทิน' : 'พิมพ์ เช่น 10/2569 หรือ ต.ค. 2569'}
        onChange={(e) => type(e.target.value)}
        onBlur={() => { if (bad) { setText(show(value)); setBad(false); } }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); setOpen(true); } }}
      />
      <button type="button" className="thai-date-btn" aria-label={`เลือก${kind === 'date' ? 'วันที่' : 'เดือน'}: ${label}`}
        aria-expanded={open} aria-controls={popId} onClick={() => setOpen((o) => !o)}>
        <CalendarDays size={16} aria-hidden />
      </button>
      {open && (kind === 'date'
        ? <CalendarPop id={popId} value={value} min={min} max={max} onPick={pick} />
        : <MonthPop id={popId} value={value} min={min} max={max} onPick={pick} />)}
    </div>
  );
}

function CalendarPop({ id, value, min, max, onPick }: { id: string; value: string; min?: string; max?: string; onPick: (v: string) => void }) {
  const today = todayIso();
  const start = value || today;
  const [ym, setYm] = useState({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) });
  const [focus, setFocus] = useState(start);
  const grid = useRef<HTMLDivElement>(null);
  const page = (delta: number) => setYm(({ y, m }) => { const t = y * 12 + (m - 1) + delta; return { y: Math.floor(t / 12), m: (t % 12) + 1 }; });
  const allowed = (d: string) => (!min || d >= min) && (!max || d <= max);

  // arrow keys move a day / a week, PageUp/PageDown a month; the grid follows the focused day
  const move = (days: number) => {
    const d = new Date(`${focus}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const next = d.toISOString().slice(0, 10);
    setFocus(next);
    setYm({ y: Number(next.slice(0, 4)), m: Number(next.slice(5, 7)) });
  };
  useEffect(() => { grid.current?.querySelector<HTMLButtonElement>(`[data-iso="${focus}"]`)?.focus(); }, [focus, ym]);

  return (
    <div className="thai-date-pop" id={id} role="dialog" aria-label="เลือกวันที่">
      <div className="thai-date-head">
        <button type="button" className="icon-btn" aria-label="เดือนก่อน" onClick={() => page(-1)}><ChevronLeft size={16} /></button>
        <strong aria-live="polite">{THAI_MONTHS[ym.m - 1]} {ym.y + 543}</strong>
        <button type="button" className="icon-btn" aria-label="เดือนถัดไป" onClick={() => page(1)}><ChevronRight size={16} /></button>
      </div>
      <div className="thai-date-grid" role="grid" ref={grid}
        onKeyDown={(e) => {
          const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
          if (step) { e.preventDefault(); move(step); }
          if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); page(e.key === 'PageUp' ? -1 : 1); }
        }}>
        {THAI_WEEKDAYS_SHORT.map((w, i) => <span key={w} role="columnheader" className={`thai-date-wd${i === 0 ? ' is-sun' : ''}`}>{w}</span>)}
        {calendarWeeks(ym.y, ym.m).flat().map((d) => {
          const ok = allowed(d.iso);
          return (
            <button key={d.iso} type="button" role="gridcell" data-iso={d.iso} disabled={!ok} tabIndex={d.iso === focus ? 0 : -1}
              aria-selected={d.iso === value} aria-label={`${Number(d.iso.slice(8))} ${THAI_MONTHS[Number(d.iso.slice(5, 7)) - 1]} ${Number(d.iso.slice(0, 4)) + 543}`}
              className={`thai-day${d.inMonth ? '' : ' is-out'}${d.iso === today ? ' is-today' : ''}${d.iso === value ? ' is-on' : ''}`}
              onClick={() => onPick(d.iso)}>{Number(d.iso.slice(8))}</button>
          );
        })}
      </div>
      <div className="thai-date-foot">
        <button type="button" className="chip-btn" disabled={!allowed(today)} onClick={() => onPick(today)}>วันนี้</button>
        <span className="thai-date-hint">พิมพ์ได้ เช่น 3/10/69</span>
      </div>
    </div>
  );
}

function MonthPop({ id, value, min, max, onPick }: { id: string; value: string; min?: string; max?: string; onPick: (v: string) => void }) {
  const now = todayIso().slice(0, 7);
  const [y, setY] = useState(Number((value || now).slice(0, 4)));
  const allowed = (p: string) => (!min || p >= min.slice(0, 7)) && (!max || p <= max.slice(0, 7));
  return (
    <div className="thai-date-pop" id={id} role="dialog" aria-label="เลือกเดือน">
      <div className="thai-date-head">
        <button type="button" className="icon-btn" aria-label="ปีก่อน" onClick={() => setY(y - 1)}><ChevronLeft size={16} /></button>
        <strong aria-live="polite">พ.ศ. {y + 543}</strong>
        <button type="button" className="icon-btn" aria-label="ปีถัดไป" onClick={() => setY(y + 1)}><ChevronRight size={16} /></button>
      </div>
      <div className="thai-month-grid">
        {THAI_MONTHS_SHORT.map((m, i) => {
          const p = `${y}-${String(i + 1).padStart(2, '0')}`;
          return (
            <button key={p} type="button" disabled={!allowed(p)} aria-pressed={p === value} aria-label={`${THAI_MONTHS[i]} ${y + 543}`}
              className={`thai-day${p === now ? ' is-today' : ''}${p === value ? ' is-on' : ''}`} onClick={() => onPick(p)}>{m}</button>
          );
        })}
      </div>
      <div className="thai-date-foot">
        <button type="button" className="chip-btn" disabled={!allowed(now)} onClick={() => onPick(now)}>เดือนนี้</button>
      </div>
    </div>
  );
}
