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

export type ReadResult = { proposal: AiProposal; file: File } | { offline: string };

/** Send one file to /assist/fill for this form. Throws an Error with a Thai message. */
export async function readDocument(module: string, screen: string, picked: File): Promise<ReadResult> {
  const file = await prepare(picked);
  const session = loadSession();
  const res = await fetch('/assist/fill', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
    body: JSON.stringify({ module, screen, file: { mediaType: file.type, name: file.name, dataBase64: await readBase64(file) } }),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.offline) return { offline: data.message };
  if (!res.ok) throw new Error(data?.error?.message ?? 'AI อ่านเอกสารไม่ได้');
  return { proposal: data as AiProposal, file };
}

/**
 * The AI button of a form with `aiFill`: pick or take a photo / PDF (several = a queue, read one by one) → /assist/fill.
 * Nothing is saved; the form shows what was read and the person checks it and presses save.
 */
export function AiFillButton({ spec, busy, message, onFiles }: {
  spec: AiFillSpec; busy: boolean; message: string;
  /** chosen files, in order; the form reads the first and queues the rest */
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="ai-fill">
      <input ref={input} type="file" accept="image/*,application/pdf" multiple hidden aria-hidden tabIndex={-1}
        onChange={(e) => { const f = [...(e.target.files ?? [])]; if (f.length) onFiles(f); e.target.value = ''; }} />
      <button type="button" className="btn-ai ai-fill-btn" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 size={16} className="spin" aria-hidden /> : <AiSpark size={16} />}
        {busy ? 'AI กำลังอ่าน…' : spec.label}
      </button>
      {message ? <p className="ai-fill-msg" role="status">{message}</p> : <p className="ai-fill-msg muted">หรือลากรูป / PDF มาวางบนฟอร์ม · เลือกหลายไฟล์ได้</p>}
    </div>
  );
}

/** Drop target over a whole screen: shows a frame while files are dragged over it. */
export function useFileDrop(enabled: boolean, onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const isFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');
  return {
    over,
    props: enabled ? {
      onDragEnter: (e: React.DragEvent) => { if (!isFiles(e)) return; e.preventDefault(); depth.current++; setOver(true); },
      onDragOver: (e: React.DragEvent) => { if (isFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } },
      onDragLeave: (e: React.DragEvent) => { if (!isFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); },
      onDrop: (e: React.DragEvent) => { if (!isFiles(e)) return; e.preventDefault(); depth.current = 0; setOver(false); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); },
    } : {},
  };
}

/** The frame shown while files are dragged over a drop target. */
export function DropOverlay({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return <div className="drop-overlay" aria-hidden><span><AiSpark size={22} /> {label}</span></div>;
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
