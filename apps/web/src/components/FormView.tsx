'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { fillPath, get, initialValues, missingRequired, prefillFromQuery, routeParams, toBody, type FormScreen } from '@erp/ui-schema';
import { api, ApiError } from '@/lib/api';
import { screenHref } from '@/lib/nav';
import { FieldRow, LinesEditor, type Values } from './Fields';

const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function FormView({ module, screen, id }: { module: string; screen: FormScreen; id?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  // values passed by the command palette / assistant: ?f.qty=500&f.itemId=…&l.itemId=RM-STEEL
  const [values, setValues] = useState<Values>(() => ({ ...initialValues(screen.fields), ...prefillFromQuery(search.entries()) }));
  const [lines, setLines] = useState<Values[]>(() => (screen.lines ? [initialValues(screen.lines.fields)] : []));
  const [loading, setLoading] = useState(!!screen.load);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [lineErrors, setLineErrors] = useState<Record<number, Record<string, string>>>({});
  const params = routeParams(screen.load ?? screen.endpoint, id);
  const qs = search.toString();
  const firstQs = useRef(qs);
  useEffect(() => {
    // a new command while this form is open: apply its values (the first render already used them)
    if (qs !== firstQs.current) setValues((v) => ({ ...v, ...prefillFromQuery(new URLSearchParams(qs).entries()) }));
  }, [qs]);

  useEffect(() => {
    if (!screen.load) return;
    api<Record<string, unknown>>(module, fillPath(screen.load, params))
      .then((rec) => setValues(Object.fromEntries(screen.fields.map((f) => [f.name, get(rec, f.name) ?? get(rec, snake(f.name)) ?? '']))))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [module, screen.load, id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fe = missingRequired(screen.fields, values);
    const used = lines.filter((l) => Object.values(l).some((v) => v !== '' && v !== undefined && v !== null));
    const le: Record<number, Record<string, string>> = {};
    if (screen.lines) {
      lines.forEach((l, i) => {
        if (!used.includes(l)) return;
        const m = missingRequired(screen.lines!.fields, l);
        if (Object.keys(m).length) le[i] = m;
      });
    }
    setFieldErrors(fe);
    setLineErrors(le);
    if (screen.lines?.min && used.length < screen.lines.min) {
      setError(`เพิ่ม${screen.lines.label}อย่างน้อย ${screen.lines.min} รายการ`);
      return;
    }
    if (Object.keys(fe).length || Object.keys(le).length) {
      setError('กรอกข้อมูลที่จำเป็นให้ครบ');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api<Record<string, unknown>>(module, fillPath(screen.endpoint, values, params), { method: screen.method, body: toBody(screen.fields, values, screen.lines, used) });
      const after = screen.after;
      router.push(after ? screenHref(module, after.screen, after.idFrom ? get(result, after.idFrom) : undefined) : '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      if (err instanceof ApiError) setFieldErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v[0]])));
      setBusy(false);
    }
  };

  if (loading) return <p className="muted">กำลังโหลด…</p>;
  return (
    <form className="screen form" onSubmit={submit} noValidate>
      <header className="screen-head"><h1>{screen.title}</h1></header>
      <div className="form-grid">
        {screen.fields.map((f) => (
          <FieldRow key={f.name} field={f} module={module} values={values} error={fieldErrors[f.name]} onChange={(p) => setValues((v) => ({ ...v, ...p }))} />
        ))}
      </div>
      {screen.lines && <LinesEditor spec={screen.lines} module={module} lines={lines} onChange={setLines} errors={lineErrors} />}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => router.back()}>ยกเลิก</button>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'กำลังบันทึก…' : screen.submitLabel}</button>
      </div>
    </form>
  );
}
