'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { csvTemplate, IMPORT_MAX_ROWS, mapImportRows, parseCsv, type ImportResult, type ImportSpec } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { datedFileName, decodeText, downloadText } from '@/lib/download';
import { toast } from '@/lib/toast';

const PREVIEW_ROWS = 100;
const n = (v: number) => v.toLocaleString('th-TH');

interface Parsed { rows: Record<string, string>[]; lines: number[]; ignored: string[] }

/**
 * "นำเข้า CSV" for a list screen with `import`: pick a file → parsed in the browser → dry run on the server →
 * preview with per-row errors → confirm → the server writes everything in one transaction.
 */
export function ImportButton({ module, spec, title, onDone }: { module: string; spec: ImportSpec; title: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) dialog.current?.showModal?.();
    else dialog.current?.close?.();
  }, [open]);

  const reset = () => {
    setParsed(null);
    setPreview(null);
    setError('');
    setFileName('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const pick = async (file: File | undefined) => {
    reset();
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    try {
      const m = mapImportRows(spec.columns, parseCsv(decodeText(await file.arrayBuffer())));
      if (m.missing.length) throw new Error(`ไฟล์ไม่มีคอลัมน์ ${m.missing.map((c) => c.label).join(', ')} — ใช้หัวคอลัมน์ตามแบบฟอร์ม`);
      if (!m.rows.length) throw new Error('ไม่พบข้อมูลในไฟล์ (แถวแรกต้องเป็นหัวคอลัมน์)');
      if (m.rows.length > IMPORT_MAX_ROWS) throw new Error(`นำเข้าได้ครั้งละไม่เกิน ${n(IMPORT_MAX_ROWS)} แถว ไฟล์นี้มี ${n(m.rows.length)} แถว — แบ่งเป็นหลายไฟล์`);
      setParsed(m);
      setPreview(await api<ImportResult>(module, spec.endpoint, { method: 'POST', body: { rows: m.rows, dryRun: true } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'อ่านไฟล์ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!parsed) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<ImportResult>(module, spec.endpoint, { method: 'POST', body: { rows: parsed.rows } });
      setOpen(false);
      reset();
      toast({ title: `นำเข้า${title} — เรียบร้อย`, body: `เพิ่มใหม่ ${n(r.created)} · อัปเดต ${n(r.updated)} รายการ`, tone: 'ok' });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'นำเข้าไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const labelOf = (key?: string) => spec.columns.find((c) => c.key === key)?.label ?? key;
  const byRow = new Map<number, { field?: string; message: string }[]>();
  for (const e of preview?.errors ?? []) byRow.set(e.row, [...(byRow.get(e.row) ?? []), e]);
  const shownCols = spec.columns.filter((c) => parsed?.rows.some((r) => r[c.key] !== undefined));
  // rows with problems first, so they are visible without scrolling
  const order = parsed ? parsed.rows.map((_, i) => i).sort((a, b) => Number(byRow.has(b + 1)) - Number(byRow.has(a + 1)) || a - b).slice(0, PREVIEW_ROWS) : [];
  const ready = !!preview && preview.errors.length === 0;

  return (
    <>
      <button type="button" className="btn" onClick={() => { reset(); setOpen(true); }}>
        <Upload size={16} aria-hidden /> นำเข้า CSV
      </button>
      <dialog ref={dialog} className="dialog dialog-wide" onClose={() => setOpen(false)} aria-labelledby={`imp-${spec.endpoint}`}>
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); if (ready) confirm(); }}>
          <h2 id={`imp-${spec.endpoint}`}>นำเข้า{title}จากไฟล์ CSV</h2>
          <p className="confirm-text">
            แถวแรกเป็นหัวคอลัมน์ (ชื่อภาษาไทยตามแบบฟอร์ม) รายการที่มีรหัสอยู่แล้วจะถูกอัปเดต รหัสใหม่จะถูกเพิ่ม · ครั้งละไม่เกิน {n(IMPORT_MAX_ROWS)} แถว
          </p>
          <ul className="import-cols" aria-label="คอลัมน์ที่รองรับ">
            {spec.columns.map((c) => <li key={c.key}>{c.label}{c.required && <span className="req" aria-label="จำเป็น"> *</span>}</li>)}
          </ul>
          <div className="import-pick">
            <label className="sr-only" htmlFor={`imp-file-${spec.endpoint}`}>เลือกไฟล์ CSV</label>
            <input ref={fileInput} id={`imp-file-${spec.endpoint}`} type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
            <button type="button" className="btn-ghost" onClick={() => downloadText(spec.template ?? datedFileName(`แบบฟอร์ม${title}`), csvTemplate(spec))}>
              <Download size={16} aria-hidden /> ดาวน์โหลดแบบฟอร์ม
            </button>
          </div>

          {busy && !preview && <p className="muted" role="status">กำลังตรวจสอบ {fileName}…</p>}
          {parsed && !!parsed.ignored.length && <p className="field-help">ไม่ใช้คอลัมน์: {parsed.ignored.join(', ')}</p>}

          {preview && parsed && (
            <>
              <p className="import-summary" role="status">
                <span>ทั้งหมด <b>{n(preview.total)}</b> แถว</span>
                <span>เพิ่มใหม่ <b>{n(preview.created)}</b></span>
                <span>อัปเดต <b>{n(preview.updated)}</b></span>
                <span className={byRow.size ? 'has-errors' : undefined}>ผิดพลาด <b>{n(byRow.size)}</b> แถว</span>
              </p>
              <div className="table-wrap import-preview">
                <table className="data">
                  <thead>
                    <tr>
                      <th className="num">แถว</th>
                      {shownCols.map((c) => <th key={c.key}>{c.label}</th>)}
                      <th>ผลตรวจ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.map((i) => {
                      const errs = byRow.get(i + 1) ?? [];
                      const bad = new Set(errs.map((e) => e.field));
                      return (
                        <tr key={i} className={errs.length ? 'row-error' : undefined}>
                          <td className="num muted">{parsed.lines[i]}</td>
                          {shownCols.map((c) => <td key={c.key} className={bad.has(c.key) ? 'cell-error' : undefined}>{parsed.rows[i][c.key] ?? ''}</td>)}
                          <td>{errs.length ? errs.map((e, k) => <div key={k} className="inline-error">{e.field ? `${labelOf(e.field)}: ` : ''}{e.message}</div>) : <span className="muted">พร้อม</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {parsed.rows.length > PREVIEW_ROWS && <p className="field-help">แสดง {n(PREVIEW_ROWS)} แถวแรกจาก {n(parsed.rows.length)} แถว</p>}
              {!ready && <p className="form-error" role="alert">แก้ไขแถวที่ผิดพลาดในไฟล์แล้วเลือกไฟล์ใหม่ — ยังไม่มีการบันทึกข้อมูลใด ๆ</p>}
            </>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>ยกเลิก</button>
            <button type="submit" className="btn-primary" disabled={!ready || busy}>
              {busy && preview ? 'กำลังนำเข้า…' : preview ? `นำเข้า ${n(preview.total)} รายการ` : 'นำเข้า'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
