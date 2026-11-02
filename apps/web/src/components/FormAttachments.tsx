'use client';

import { Camera, FileImage, FileSpreadsheet, FileText, File as FileIcon, Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, FORM_ATTACH_MAX, attachmentRef, fileKind, formatBytes, type FileKind, type FormAttach } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { precheck, readBase64, shrinkImage } from './AttachmentsPanel';

const ICONS: Record<FileKind, typeof FileIcon> = { image: FileImage, pdf: FileText, sheet: FileSpreadsheet, doc: FileText, text: FileText, file: FileIcon };

export interface PendingFile { key: string; file: File; url?: string }

/**
 * Photos / files picked on a form before its record exists (`FormScreen.attach`). "ถ่ายรูป" opens the camera on phones
 * (`capture`), "แนบรูป/ไฟล์" the file chooser; drag & drop works too. Big photos are shrunk here, so what the user sees is what is sent.
 */
export function FormAttachments({ spec, files, onChange, disabled }: { spec: FormAttach; files: PendingFile[]; onChange: (f: PendingFile[]) => void; disabled?: boolean }) {
  const camera = useRef<HTMLInputElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [preparing, setPreparing] = useState(false);
  // a picture the browser cannot draw (HEIC on some browsers, a damaged file) shows the file icon instead of a broken image
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const max = spec.max ?? FORM_ATTACH_MAX;
  // object URLs of the previews are released when a file leaves the list or the form closes
  const urls = useRef(new Set<string>());
  useEffect(() => () => { urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const add = async (list: FileList | File[]) => {
    setPreparing(true);
    const shrunk = await Promise.all(Array.from(list).map((f) => shrinkImage(f)));
    setPreparing(false);
    const bad: string[] = [];
    const room = max - files.length;
    const ok = shrunk.filter((f) => { const p = precheck(f); if (p) bad.push(p); return !p; });
    if (ok.length > room) bad.push(`แนบได้สูงสุด ${max} ไฟล์ — ไม่ได้เพิ่ม ${ok.length - Math.max(room, 0)} ไฟล์`);
    const added = ok.slice(0, Math.max(room, 0)).map((file) => {
      const url = fileKind(file.type) === 'image' ? URL.createObjectURL(file) : undefined;
      if (url) urls.current.add(url);
      return { key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 8)}`, file, url };
    });
    setProblems(bad);
    if (added.length) onChange([...files, ...added]);
  };
  const remove = (key: string) => {
    const gone = files.find((f) => f.key === key);
    if (gone?.url) { URL.revokeObjectURL(gone.url); urls.current.delete(gone.url); }
    onChange(files.filter((f) => f.key !== key));
  };

  const label = spec.label ?? 'รูปถ่าย / ไฟล์แนบ';
  return (
    <section
      className={`form-attach${over ? ' is-over' : ''}`}
      aria-label={label}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}
    >
      <div className="form-attach-head">
        <div>
          <h3>{label} <span className="muted">{files.length ? `${files.length}/${max}` : 'ไม่บังคับ'}</span></h3>
          <p className="muted">{spec.hint ?? `ลากไฟล์มาวาง หรือกดปุ่ม — รูป, PDF, Excel, Word ไฟล์ละไม่เกิน ${formatBytes(ATTACHMENT_MAX_BYTES)}`}</p>
        </div>
        <div className="form-attach-buttons">
          <button type="button" className={spec.photos ? 'btn btn-photo' : 'btn'} onClick={() => camera.current?.click()} disabled={disabled || preparing || files.length >= max}>
            <Camera size={16} aria-hidden /> ถ่ายรูป
          </button>
          <button type="button" className="btn" onClick={() => chooser.current?.click()} disabled={disabled || preparing || files.length >= max}>
            <Paperclip size={16} aria-hidden /> แนบรูป/ไฟล์
          </button>
        </div>
        {/* capture: phones open the camera straight away; desktops show the file chooser filtered to images */}
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden aria-hidden tabIndex={-1}
          onChange={(e) => { if (e.target.files?.length) add(e.target.files); e.target.value = ''; }} />
        <input ref={chooser} type="file" multiple accept={ATTACHMENT_ACCEPT} hidden aria-label={`เลือกไฟล์ — ${label}`} data-testid="form-attach-input"
          onChange={(e) => { if (e.target.files?.length) add(e.target.files); e.target.value = ''; }} />
      </div>
      {preparing && <p className="muted" role="status">กำลังเตรียมรูป…</p>}
      {problems.length > 0 && <p className="form-attach-error" role="alert">{problems.join(' · ')}</p>}
      {files.length > 0 && (
        <ul className="form-attach-list">
          {files.map((p) => {
            const Icon = ICONS[fileKind(p.file.type)];
            return (
              <li key={p.key} className={p.url ? 'is-image' : ''}>
                {p.url && !broken.has(p.key)
                  ? <img src={p.url} alt="" onError={() => setBroken((b) => new Set(b).add(p.key))} />
                  : <span className="form-attach-icon" aria-hidden><Icon size={26} strokeWidth={1.5} /></span>}
                <span className="form-attach-name" title={p.file.name}>{p.file.name}</span>
                <small className="muted">{formatBytes(p.file.size)}</small>
                <button type="button" className="form-attach-remove" aria-label={`เอา ${p.file.name} ออก`} onClick={() => remove(p.key)} disabled={disabled}><X size={14} aria-hidden /></button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Upload the kept files to the record just created; returns the names that could not be sent (the record is saved either way). */
export async function uploadPending(module: string, entity: string, recordId: string, files: PendingFile[], progress: (text: string) => void): Promise<string[]> {
  const failed: string[] = [];
  for (const [i, p] of files.entries()) {
    progress(`กำลังแนบไฟล์ ${i + 1}/${files.length}…`);
    try {
      await api(module, '/_attachments', { method: 'POST', body: { ref: attachmentRef(entity, recordId), fileName: p.file.name, contentType: p.file.type || undefined, dataBase64: await readBase64(p.file) } });
    } catch (e) {
      failed.push(`${p.file.name}: ${(e as Error).message}`);
    }
  }
  return failed;
}
