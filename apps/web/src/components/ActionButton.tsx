'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { fillPath, get, initialValues, missingRequired, toBody, type Action } from '@erp/ui-schema';
import { api, ApiError, isShowcaseRefusal } from '@/lib/api';
import { toast } from '@/lib/toast';
import { SHOWCASE } from '@/lib/showcase';
import { FieldRow, LinesEditor, type Values } from './Fields';

/**
 * A button that calls an action endpoint. Opens a dialog first when the action needs input or a confirmation.
 * `params` fill the endpoint template (route id, row values).
 */
export function ActionButton({ action, module, params, onDone }: { action: Action; module: string; params: Record<string, unknown>; onDone: (result: any) => void }) {
  const needsDialog = !!(action.fields?.length || action.lines || action.confirm || action.impact);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<Values>(() => initialValues(action.fields ?? []));
  const [lines, setLines] = useState<Values[]>([]);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) dialog.current?.showModal?.();
    else dialog.current?.close?.();
  }, [open]);

  const run = async () => {
    const missing = missingRequired(action.fields ?? [], values);
    setFieldErrors(missing);
    if (Object.keys(missing).length) return;
    setBusy(true);
    setError('');
    try {
      const filledLines = action.lines ? lines.filter((l) => Object.values(l).some((v) => v !== '' && v !== undefined)) : undefined;
      const body = action.fields?.length || action.lines ? toBody(action.fields ?? [], values, action.lines, filledLines) : undefined;
      const result = await api(module, fillPath(action.endpoint, values, params), { method: action.method, body });
      setOpen(false);
      if (action.toast) toast({ title: action.label, body: String(get(result, action.toast) ?? ''), tone: 'info' });
      else toast({ title: `${action.label} — เรียบร้อย`, tone: action.tone === 'danger' ? 'warn' : 'ok' });
      onDone(result);
    } catch (e) {
      if (isShowcaseRefusal(e)) { setOpen(false); return; } // showcase: the toast explains it, no red error
      setError(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ');
      if (e instanceof ApiError) setFieldErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v[0]])));
    } finally {
      setBusy(false);
    }
  };

  const tone = action.tone === 'primary' ? 'btn-primary' : action.tone === 'danger' ? 'btn-danger' : 'btn';
  return (
    <>
      <button type="button" className={tone} disabled={busy} onClick={() => (needsDialog ? setOpen(true) : run())}>
        {busy && !open ? 'กำลังบันทึก…' : action.label}
      </button>
      {!needsDialog && error && <p className="inline-error" role="alert">{error}</p>}
      {needsDialog && (
        <dialog ref={dialog} className="dialog" onClose={() => setOpen(false)} aria-labelledby={`dlg-${action.id}`}>
          <form method="dialog" onSubmit={(e) => { e.preventDefault(); run(); }}>
            <h2 id={`dlg-${action.id}`}>{action.label}</h2>
            {action.confirm && <p className="confirm-text">{action.confirm}</p>}
            {!!action.fields?.length && (
              <div className="form-grid">
                {action.fields.map((f) => (
                  <FieldRow key={f.name} field={f} module={module} values={values} error={fieldErrors[f.name]} onChange={(p) => setValues((v) => ({ ...v, ...p }))} />
                ))}
              </div>
            )}
            {action.lines && <LinesEditor spec={action.lines} module={module} lines={lines} onChange={setLines} />}
            {action.impact && open && !SHOWCASE && <ImpactPreview action={action} module={module} params={params} values={values} lines={lines} />}
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setOpen(false)}>ยกเลิก</button>
              <button type="submit" className={action.tone === 'danger' ? 'btn-danger' : 'btn-primary'} disabled={busy}>{busy ? 'กำลังบันทึก…' : action.label}</button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}

/** physical effects first (stock, cost, QC), then the books */
const IMPACT_ORDER = ['inventory', 'costing', 'quality', 'production', 'sales', 'purchasing', 'accounting'];
const impactRank = (m: string) => (IMPACT_ORDER.includes(m) ? IMPACT_ORDER.indexOf(m) : IMPACT_ORDER.length);

interface Impact { module: string; nameTh: string; event: string; lines: { text: string; tone?: 'info' | 'ok' | 'warn' | 'stop' }[] }
type Preview = { state: 'loading' } | { state: 'blocked'; message: string } | { state: 'ready'; impacts: Impact[] } | { state: 'unavailable' };

/**
 * "ผลกระทบเมื่อกดยืนยัน": runs the action as a dry run (nothing saved), then asks every installed module that would react
 * what it would do (stock, cost, accounting, QC…). Re-runs half a second after the inputs change. A refusal shows at once,
 * before the user presses the button.
 */
function ImpactPreview({ action, module, params, values, lines }: { action: Action; module: string; params: Record<string, unknown>; values: Values; lines: Values[] }) {
  const [p, setP] = useState<Preview>({ state: 'loading' });
  const key = JSON.stringify([values, lines]);
  useEffect(() => {
    let stop = false;
    setP((x) => (x.state === 'ready' ? x : { state: 'loading' }));
    const t = setTimeout(async () => {
      try {
        const filledLines = action.lines ? lines.filter((l) => Object.values(l).some((v) => v !== '' && v !== undefined)) : undefined;
        const body = action.fields?.length || action.lines ? toBody(action.fields ?? [], values, action.lines, filledLines) : undefined;
        const dry = await api<{ dryRun?: boolean; events?: unknown[] }>(module, fillPath(action.endpoint, values, params), { method: action.method, body, query: { _dryRun: 1 } });
        if (!dry?.dryRun) { if (!stop) setP({ state: 'unavailable' }); return; }
        const r = dry.events?.length ? await api<{ impacts: Impact[] }>('_impact', '', { method: 'POST', body: { events: dry.events } }) : { impacts: [] };
        if (!stop) setP({ state: 'ready', impacts: r.impacts });
      } catch (e) {
        if (!stop) setP(e instanceof ApiError && e.status >= 400 && e.status < 500 ? { state: 'blocked', message: e.message } : { state: 'unavailable' });
      }
    }, 500);
    return () => { stop = true; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (p.state === 'unavailable') return null;
  return (
    <section className="impact" aria-live="polite" aria-busy={p.state === 'loading'}>
      <h3><Sparkles size={15} aria-hidden />ผลกระทบเมื่อกดยืนยัน{p.state === 'loading' && <Loader2 size={14} className="spin" aria-label="กำลังคำนวณ" />}</h3>
      {p.state === 'blocked' && <p className="impact-blocked"><AlertTriangle size={15} aria-hidden />ยังทำรายการนี้ไม่ได้: {p.message}</p>}
      {p.state === 'ready' && !p.impacts.length && <p className="impact-none">ไม่มีผลต่อส่วนอื่นของระบบ (หรือบัญชีนี้ไม่มีสิทธิ์ดู)</p>}
      {p.state === 'ready' && [...p.impacts].sort((a, b) => impactRank(a.module) - impactRank(b.module)).map((g) => (
        <div key={`${g.module}.${g.event}`} className="impact-group">
          <h4>{g.nameTh}</h4>
          <ul>{g.lines.map((l, i) => <li key={i} className={`impact-${l.tone ?? 'plain'}`}>{l.text}</li>)}</ul>
        </div>
      ))}
      <p className="impact-note">ตัวอย่างนี้ยังไม่บันทึกอะไร — คำนวณจากข้อมูล ณ ตอนนี้</p>
    </section>
  );
}
