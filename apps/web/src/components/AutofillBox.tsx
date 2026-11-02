'use client';

import { Building2, Check, Loader2, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { autofillReady, autofillValues, get, type FormAutofill } from '@erp/ui-schema';
import { api } from '@/lib/api';

type Row = Record<string, unknown>;

/**
 * "พิมพ์ชื่อหรือเลขผู้เสียภาษี แล้วระบบกรอกให้" (`FormScreen.autofill`): searches the module's register route — a complete 13-digit
 * number at once, a name after a short pause or Enter — lists the matches, and fills the form with the one picked.
 */
export function AutofillBox({ module, spec, onPick }: { module: string; spec: FormAutofill; onPick: (values: Record<string, unknown>, row: Row) => void }) {
  const id = useId();
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const seq = useRef(0);

  const search = async (q: string) => {
    const kind = autofillReady(q, spec.minLength);
    if (!kind) return;
    const mine = ++seq.current;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ results?: Row[]; source?: string } | Row[]>(module, spec.endpoint, { query: { q: q.trim() } });
      if (mine !== seq.current) return; // a newer search is on its way
      const list = Array.isArray(r) ? r : r.results ?? [];
      setRows(list);
      setSource(Array.isArray(r) ? '' : r.source ?? '');
      setActive(0);
    } catch (e) {
      if (mine !== seq.current) return;
      setRows(null);
      setError((e as Error).message);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  };

  // a full tax ID searches at once; a name waits until the typing stops
  useEffect(() => {
    const kind = autofillReady(text, spec.minLength);
    if (!kind) { setRows(null); setError(''); return; }
    const t = setTimeout(() => search(text), kind === 'tin' ? 0 : 700);
    return () => clearTimeout(t);
  }, [text]);

  const choose = (row: Row) => {
    onPick(autofillValues(spec, row), row);
    setPicked(spec.title.map((k) => get(row, k)).filter(Boolean).join(' · '));
    setRows(null);
    setText('');
  };

  const line = (row: Row, keys?: string[]) => (keys ?? []).map((k) => get(row, k)).filter((v) => v !== undefined && v !== null && v !== '').join(' · ');
  const ready = autofillReady(text, spec.minLength);

  return (
    <section className="autofill" aria-label={spec.label}>
      <label htmlFor={id} className="autofill-label"><Building2 size={16} aria-hidden /> {spec.label}</label>
      <div className="autofill-box">
        <Search size={16} aria-hidden className="autofill-icon" />
        <input
          id={id}
          role="combobox"
          aria-expanded={!!rows?.length}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          placeholder={spec.placeholder ?? 'เลขผู้เสียภาษี 13 หลัก หรือชื่อบริษัท'}
          value={text}
          autoComplete="off"
          onChange={(e) => { setText(e.target.value); setPicked(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (rows?.[active]) choose(rows[active]); else search(text); }
            if (e.key === 'ArrowDown' && rows?.length) { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
            if (e.key === 'ArrowUp' && rows?.length) { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            if (e.key === 'Escape') setRows(null);
          }}
        />
        {busy && <Loader2 size={16} className="spin autofill-busy" aria-label="กำลังค้นหา" />}
      </div>
      {!rows && !error && !picked && <p className="muted autofill-hint">{spec.hint ?? 'พิมพ์เลข 13 หลัก ระบบค้นหาทันที หรือพิมพ์ชื่อแล้วรอสักครู่'}</p>}
      {!rows && !error && !picked && text && !ready && !busy && <p className="muted autofill-hint">{/^\d/.test(text.trim()) ? `เลขผู้เสียภาษีต้องมี 13 หลัก (ตอนนี้ ${text.replace(/\D/g, '').length} หลัก)` : `พิมพ์อย่างน้อย ${spec.minLength ?? 3} ตัวอักษร`}</p>}
      {picked && <p className="autofill-picked" role="status"><Check size={15} aria-hidden /> กรอกข้อมูลจาก {picked} แล้ว — ตรวจแล้วกดบันทึก</p>}
      {error && <p className="autofill-error" role="alert">{error}</p>}
      {rows && rows.length === 0 && <p className="muted autofill-hint" role="status">ไม่พบ “{text.trim()}”{source ? ` ใน${source}` : ''} — กรอกเองได้ด้านล่าง</p>}
      {rows && rows.length > 0 && (
        <>
          <ul className="autofill-list" id={`${id}-list`} role="listbox" aria-label="ผลการค้นหา">
            {rows.map((r, i) => {
              const ex = spec.existing ? get(r, spec.existing) : null;
              return (
                <li key={i} role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''}
                  onMouseDown={(e) => { e.preventDefault(); choose(r); }} onMouseEnter={() => setActive(i)}>
                  <div className="autofill-main">
                    <strong>{line(r, spec.title)}</strong>
                    {spec.subtitle && <span>{line(r, spec.subtitle)}</span>}
                  </div>
                  <div className="autofill-side">
                    {spec.tag && <span className="pill tone-neutral">{String(get(r, spec.tag) ?? '')}</span>}
                    {ex ? <span className="pill tone-warn" title="บริษัทนี้มีข้อมูลสาขานี้อยู่แล้ว">มีในระบบแล้ว: {String(ex)}</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {source && <p className="muted autofill-source">ข้อมูลจาก {source} · {rows.length} รายการ</p>}
        </>
      )}
    </section>
  );
}
