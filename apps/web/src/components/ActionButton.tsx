'use client';

import { useEffect, useRef, useState } from 'react';
import { fillPath, get, initialValues, missingRequired, toBody, type Action } from '@erp/ui-schema';
import { api, ApiError, isShowcaseRefusal } from '@/lib/api';
import { toast } from '@/lib/toast';
import { FieldRow, LinesEditor, type Values } from './Fields';

/**
 * A button that calls an action endpoint. Opens a dialog first when the action needs input or a confirmation.
 * `params` fill the endpoint template (route id, row values).
 * `auto`: no button — run at once (or open the dialog at once); used when a card is dropped on a kanban lane.
 * `onCancel` then fires when the dialog is closed without running, or when the call fails (the card goes back).
 */
export function ActionButton({ action, module, params, onDone, auto, onCancel }: {
  action: Action; module: string; params: Record<string, unknown>; onDone: (result: any) => void; auto?: boolean; onCancel?: (error?: string) => void;
}) {
  const needsDialog = !!(action.fields?.length || action.lines || action.confirm);
  const [open, setOpen] = useState(!!auto && needsDialog);
  const done = useRef(false);
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
  // dropped card with nothing to ask: run once
  useEffect(() => { if (auto && !needsDialog) run(); }, []);

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
      done.current = true;
      setOpen(false);
      if (action.toast) toast({ title: action.label, body: String(get(result, action.toast) ?? ''), tone: 'info' });
      else toast({ title: `${action.label} — เรียบร้อย`, tone: action.tone === 'danger' ? 'warn' : 'ok' });
      onDone(result);
    } catch (e) {
      if (isShowcaseRefusal(e)) { setOpen(false); if (auto) onCancel?.(); return; } // showcase: the toast explains it, no red error
      const message = e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ';
      if (auto && !needsDialog) { toast({ title: `${action.label} ไม่สำเร็จ`, body: message, tone: 'warn' }); onCancel?.(message); return; }
      setError(message);
      if (e instanceof ApiError) setFieldErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, v[0]])));
    } finally {
      setBusy(false);
    }
  };

  const tone = action.tone === 'primary' ? 'btn-primary' : action.tone === 'danger' ? 'btn-danger' : 'btn';
  const closed = () => { setOpen(false); if (auto && !done.current) onCancel?.(); };
  return (
    <>
      {!auto && (
        <button type="button" className={tone} disabled={busy} onClick={() => (needsDialog ? setOpen(true) : run())}>
          {busy && !open ? 'กำลังบันทึก…' : action.label}
        </button>
      )}
      {!auto && !needsDialog && error && <p className="inline-error" role="alert">{error}</p>}
      {needsDialog && (
        <dialog ref={dialog} className="dialog" onClose={closed} aria-labelledby={`dlg-${action.id}`}>
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
