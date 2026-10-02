'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { datePresets, get, initialValues, type Field, type LinesSpec } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { useRegistry } from '@/lib/registry';

export type Values = Record<string, unknown>;

interface FieldProps {
  field: Field;
  module: string;
  values: Values;
  onChange: (patch: Values) => void;
  error?: string;
  compact?: boolean;
}

/** Records returned by a lookup endpoint, filtered client-side by the typed text as well. */
function useLookup(module: string, field: Field, text: string, enabled: boolean) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const lk = field.lookup!;
  useEffect(() => {
    if (!enabled) return;
    const t = setTimeout(() => {
      setLoading(true);
      api<Record<string, unknown>[]>(lk.module ?? module, lk.path, { query: { ...lk.query, q: text || undefined, limit: 50 } })
        .then((r) => setRows(Array.isArray(r) ? r : []))
        .catch(() => setRows([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [enabled, text, module, lk.module, lk.path, JSON.stringify(lk.query)]);
  const needle = text.trim().toLowerCase();
  const filtered = needle ? rows.filter((r) => lk.label.some((k) => String(get(r, k) ?? '').toLowerCase().includes(needle))) : rows;
  return { rows: filtered, loading };
}

function LookupInput({ field, module, values, onChange, error, compact }: FieldProps) {
  const lk = field.lookup!;
  const id = useId();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState<string>(() => String(values[`__label.${field.name}`] ?? ''));
  const box = useRef<HTMLDivElement>(null);
  const { rows, loading } = useLookup(module, field, text, open);
  const selected = values[field.name];

  useEffect(() => {
    if (!selected) setChosen('');
  }, [selected]);
  const given = values[`__label.${field.name}`];
  useEffect(() => {
    if (given) setChosen(String(given));
  }, [given]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (r: Record<string, unknown>) => {
    const patch: Values = {};
    for (const [target, source] of Object.entries(lk.assign)) patch[target] = get(r, source) ?? undefined;
    onChange(patch);
    setChosen(lk.label.map((k) => get(r, k)).filter(Boolean).join('  '));
    setText('');
    setOpen(false);
  };

  return (
    <div className={`lookup${open ? ' is-open' : ''}`} ref={box}>
      <input
        id={id}
        aria-label={field.label}
        aria-invalid={!!error}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        placeholder={chosen || (compact ? field.label : 'พิมพ์เพื่อค้นหา')}
        className={chosen ? 'has-choice' : ''}
        value={open ? text : chosen}
        onFocus={() => { setOpen(true); setText(''); }}
        onChange={(e) => { setText(e.target.value); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rows.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === 'Enter' && open && rows[active]) { e.preventDefault(); pick(rows[active]); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul className="lookup-list" id={`${id}-list`} role="listbox">
          {loading && rows.length === 0 && <li className="lookup-empty">กำลังค้นหา…</li>}
          {!loading && rows.length === 0 && <li className="lookup-empty">ไม่พบ{field.label}</li>}
          {rows.slice(0, 30).map((r, i) => (
            <li key={String(r.id ?? i)} role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(r); }} onMouseEnter={() => setActive(i)}>
              <strong>{String(get(r, lk.label[0]) ?? '')}</strong>
              {lk.label.slice(1).map((k) => <span key={k}>{String(get(r, k) ?? '')}</span>)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MultiLookup({ field, module, values, onChange }: FieldProps) {
  const { rows } = useLookup(module, field, '', true);
  const valueKey = Object.values(field.lookup!.assign)[0];
  const current = (values[field.name] as string[] | undefined) ?? [];
  const toggle = (v: string) => onChange({ [field.name]: current.includes(v) ? current.filter((x) => x !== v) : [...current, v] });
  return (
    <div className="checks">
      {rows.map((r) => {
        const v = String(get(r, valueKey));
        return (
          <label key={v} className="check">
            <input type="checkbox" checked={current.includes(v)} onChange={() => toggle(v)} />
            {field.lookup!.label.map((k) => String(get(r, k) ?? '')).join(' ')}
          </label>
        );
      })}
      {rows.length === 0 && <p className="muted">ยังไม่มีรายการให้เลือก</p>}
    </div>
  );
}

/** Permission picker built from the installed modules' manifests. */
function PermissionsInput({ field, values, onChange }: FieldProps) {
  const { catalog } = useRegistry();
  const current = (values[field.name] as string[] | undefined) ?? [];
  const set = (perm: string, on: boolean) => onChange({ [field.name]: on ? [...new Set([...current, perm])] : current.filter((p) => p !== perm) });
  const all = current.includes('*');
  return (
    <div className="perms">
      <label className="check perm-all">
        <input type="checkbox" checked={all} onChange={(e) => set('*', e.target.checked)} />
        ทุกสิทธิ์ในทุกโมดูล (ผู้ดูแลระบบ)
      </label>
      {!all && catalog.filter((m) => m.permissions.length).map((m) => {
        const prefix = m.permissions[0].key.split('.')[0];
        const wholeModule = current.includes(`${prefix}.*`);
        return (
          <fieldset key={m.id} className="perm-group">
            <legend>{m.nameTh}</legend>
            <label className="check">
              <input type="checkbox" checked={wholeModule} onChange={(e) => set(`${prefix}.*`, e.target.checked)} />
              ทุกสิทธิ์ของ{m.nameTh}
            </label>
            {!wholeModule && m.permissions.map((p) => (
              <label key={p.key} className="check">
                <input type="checkbox" checked={current.includes(p.key)} onChange={(e) => set(p.key, e.target.checked)} />
                {p.label}
              </label>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}

/** Largest picture kept as a data URL in a text field (company logo). */
const IMAGE_MAX_BYTES = 300 * 1024;

/**
 * A text field that holds a picture as a data URL (the company logo): preview + choose / remove a file, instead of
 * a box of base64 text. Recognised by its value ("data:image/…") or by a help text that mentions data:image.
 */
function ImageDataInput({ field, values, onChange }: FieldProps) {
  const v = String(values[field.name] ?? '');
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState('');
  const pick = (file: File) => {
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) { setProblem('เลือกไฟล์รูป PNG, JPEG, SVG หรือ WebP'); return; }
    if (file.size > IMAGE_MAX_BYTES) { setProblem(`ไฟล์ใหญ่ ${Math.round(file.size / 1024)} KB — ไม่เกิน ${IMAGE_MAX_BYTES / 1024} KB`); return; }
    const r = new FileReader();
    r.onload = () => { setProblem(''); onChange({ [field.name]: String(r.result) }); };
    r.readAsDataURL(file);
  };
  return (
    <div className="image-input">
      <div className="image-preview">{v ? <img src={v} alt={field.label} /> : <span className="muted">ยังไม่มีรูป</span>}</div>
      <div className="image-actions">
        <button type="button" className="btn" onClick={() => input.current?.click()}>{v ? 'เปลี่ยนรูป' : 'เลือกไฟล์รูป'}</button>
        {v && <button type="button" className="btn-ghost" onClick={() => onChange({ [field.name]: '' })}>ลบรูป</button>}
        <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" aria-label={field.label}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
        {problem && <p className="field-error" role="alert">{problem}</p>}
      </div>
    </div>
  );
}

const isImageData = (field: Field, v: unknown) => field.type === 'image'
  || (field.type === 'textarea' && (String(v ?? '').startsWith('data:image/') || /data:image/.test(field.help ?? '')));

export function FieldInput(props: FieldProps) {
  const { field, values, onChange, error, compact } = props;
  const v = values[field.name];
  const common = { 'aria-label': field.label, 'aria-invalid': !!error };
  switch (field.type) {
    case 'lookup': return <LookupInput {...props} />;
    case 'multilookup': return <MultiLookup {...props} />;
    case 'permissions': return <PermissionsInput {...props} />;
    case 'image': return <ImageDataInput {...props} />;
    case 'textarea': if (isImageData(field, v)) return <ImageDataInput {...props} />;
      return <textarea {...common} rows={3} value={String(v ?? '')} onChange={(e) => onChange({ [field.name]: e.target.value })} />;
    case 'boolean':
      return (
        <label className="check">
          <input type="checkbox" checked={!!v} onChange={(e) => onChange({ [field.name]: e.target.checked })} />
          {field.label}
        </label>
      );
    case 'select':
      return (
        <select {...common} value={String(v ?? (compact && field.default !== undefined ? field.default : ''))} onChange={(e) => onChange({ [field.name]: e.target.value })}>
          <option value="">{compact ? field.label : 'ทั้งหมด / ไม่ระบุ'}</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    case 'date':
    case 'month':
      // a date box shows its own mm/dd/yyyy text, so a compact (filter) one carries its label above the value
      return (
        <label className={compact ? 'float-field' : 'date-field'}>
          {compact && <span className="float-label">{field.label}</span>}
          <input {...common} type={field.type} placeholder={field.type === 'month' ? 'YYYY-MM' : undefined} value={String(v ?? '')}
            onChange={(e) => onChange({ [field.name]: e.target.value })} />
        </label>
      );
    default:
      return (
        <input
          {...common}
          type={field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : field.type === 'email' ? 'email' : 'text'}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          step={field.type === 'number' ? field.step ?? 'any' : undefined}
          placeholder={compact ? field.label : undefined}
          value={String(v ?? '')}
          onChange={(e) => onChange({ [field.name]: e.target.value })}
        />
      );
  }
}

export function FieldRow({ field, error, ...rest }: FieldProps) {
  const id = useId();
  if (field.type === 'boolean') return <div className="field"><FieldInput field={field} error={error} {...rest} />{error && <p className="field-error">{error}</p>}</div>;
  return (
    <div className={`field${(field.type === 'textarea' && !isImageData(field, rest.values[field.name])) || field.type === 'permissions' || field.type === 'multilookup' ? ' field-wide' : ''}`}>
      <label htmlFor={id}>{field.label}{field.required && <span className="req" aria-hidden> *</span>}</label>
      <div id={id}><FieldInput field={field} error={error} {...rest} /></div>
      {field.help && !error && <p className="field-help">{field.help}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

export function LinesEditor({ spec, module, lines, onChange, errors }: { spec: LinesSpec; module: string; lines: Values[]; onChange: (l: Values[]) => void; errors?: Record<number, Record<string, string>> }) {
  const blank = useMemo(() => initialValues(spec.fields), [spec]);
  const update = (i: number, patch: Values) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <section className="lines-editor" aria-label={spec.label}>
      <h3>{spec.label}</h3>
      <table>
        <thead>
          <tr>
            <th className="num">#</th>
            {spec.fields.map((f) => <th key={f.name}>{f.label}{f.required && <span className="req" aria-hidden> *</span>}</th>)}
            <th><span className="sr-only">ลบ</span></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="num">{i + 1}</td>
              {spec.fields.map((f) => (
                <td key={f.name} className={f.type === 'lookup' ? 'cell-lookup' : ''}>
                  <FieldInput field={f} module={module} values={line} compact onChange={(p) => update(i, p)} error={errors?.[i]?.[f.name]} />
                  {errors?.[i]?.[f.name] && <p className="field-error">{errors[i][f.name]}</p>}
                </td>
              ))}
              <td>
                <button type="button" className="btn-ghost" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label={`ลบรายการที่ ${i + 1}`}>ลบ</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn" onClick={() => onChange([...lines, { ...blank }])}>เพิ่มรายการ</button>
    </section>
  );
}

/**
 * A "from – to" pair of date filters as one control: both dates in one box under the pair's label,
 * plus quick ranges (this month, last month, this quarter, this year). Each date keeps its own query param.
 */
export function DateRangeInput({ from, to, values, onChange }: { from: Field; to: Field; values: Values; onChange: (patch: Values) => void }) {
  const a = String(values[from.name] ?? '');
  const b = String(values[to.name] ?? '');
  const presets = datePresets();
  const active = presets.find((p) => p.from === a && p.to === b)?.id;
  return (
    <div className="date-range" role="group" aria-label={`${from.label} – ${to.label}`}>
      <div className="float-field range-box">
        <span className="float-label">{from.label} – {to.label}</span>
        <span className="range-inputs">
          <input type="date" aria-label={from.label} value={a} max={b || undefined} onChange={(e) => onChange({ [from.name]: e.target.value })} />
          <span aria-hidden className="range-dash">–</span>
          <input type="date" aria-label={to.label} value={b} min={a || undefined} onChange={(e) => onChange({ [to.name]: e.target.value })} />
        </span>
      </div>
      <div className="range-presets">
        {presets.map((p) => (
          <button key={p.id} type="button" className={`chip-btn${active === p.id ? ' is-on' : ''}`} aria-pressed={active === p.id}
            onClick={() => onChange(active === p.id ? { [from.name]: '', [to.name]: '' } : { [from.name]: p.from, [to.name]: p.to })}>{p.label}</button>
        ))}
      </div>
    </div>
  );
}
