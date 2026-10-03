'use client';

import { useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { AiSpark } from './Brand';
import type { AiFillSpec } from '@erp/ui-schema';
import { loadSession } from '@/lib/session';

/** What /assist/fill proposes; FormView merges it into the empty fields (see mergeAiFill). */
export interface AiProposal {
  values: Record<string, unknown>;
  lines: Record<string, unknown>[];
  facts: { label: string; value: string }[];
  warnings: string[];
}

/** Claude reads images up to ~1568 px on the long side; larger photos only cost more and upload slower. */
const MAX_SIDE = 1568;

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'));
    r.readAsDataURL(blob);
  });
}

/** Phone photos -> JPEG ≤ 1568 px. Anything the browser cannot decode (e.g. HEIC on Chrome) is sent as is; the server explains. */
async function prepare(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.type === 'image/jpeg' && file.size < 1_500_000) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return file;
    const base = file.name.replace(/\.[^.]+$/, '') || 'receipt';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/**
 * The "สแกนใบเสร็จ" button of a form with `aiFill`: pick or take a photo (or a PDF) → /assist/fill → `onProposal`.
 * Nothing is saved; the form shows what was read and the person checks it and presses save.
 */
export function AiFillButton({ module, screen, spec, onProposal, onFile }: {
  module: string; screen: string; spec: AiFillSpec;
  onProposal: (p: AiProposal) => void;
  /** the (shrunk) file that was read, so the form can attach it after saving */
  onFile: (f: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const run = async (picked: File) => {
    setBusy(true);
    setMessage('');
    try {
      const file = await prepare(picked);
      const session = loadSession();
      const res = await fetch('/assist/fill', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
        body: JSON.stringify({ module, screen, file: { mediaType: file.type, name: file.name, dataBase64: await readBase64(file) } }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.offline) { setMessage(data.message); return; }
      if (!res.ok) throw new Error(data?.error?.message ?? 'AI อ่านเอกสารไม่ได้');
      onFile(file);
      onProposal(data as AiProposal);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'AI อ่านเอกสารไม่ได้');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="ai-fill">
      <input ref={input} type="file" accept="image/*,application/pdf" hidden aria-hidden tabIndex={-1}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); }} />
      <button type="button" className="btn-ai ai-fill-btn" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 size={16} className="spin" aria-hidden /> : <AiSpark size={16} />}
        {busy ? 'AI กำลังอ่าน…' : spec.label}
      </button>
      {message && <p className="ai-fill-msg" role="status">{message}</p>}
    </div>
  );
}

/** What the AI read off the paper + what to double-check, shown above the form until dismissed. */
export function AiFillReview({ proposal, filled, attach, onAttach, onClose }: {
  proposal: AiProposal; filled: number;
  /** null = this form has nowhere to attach the file */
  attach: boolean | null; onAttach: (v: boolean) => void; onClose: () => void;
}) {
  return (
    <section className="ai-review" aria-label="ข้อมูลที่ AI อ่านได้">
      <header>
        <b><AiSpark size={16} /> AI กรอกให้ {filled} ช่อง/รายการ — ตรวจแล้วค่อยกดบันทึก</b>
        <button type="button" className="btn-ghost" onClick={onClose} aria-label="ปิด"><X size={16} aria-hidden /></button>
      </header>
      {proposal.facts.length > 0 && (
        <dl>{proposal.facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}</dl>
      )}
      {proposal.warnings.length > 0 && <ul className="ai-warn">{proposal.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {attach !== null ? (
        <label className="ai-attach"><input type="checkbox" checked={attach} onChange={(e) => onAttach(e.target.checked)} /> แนบรูปนี้กับเอกสารหลังบันทึก</label>
      ) : <p className="muted">แนบรูปเป็นหลักฐานได้ที่หน้าเอกสารหลังบันทึก</p>}
    </section>
  );
}
