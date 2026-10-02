'use client';

import { FileImage, FileSpreadsheet, FileText, File as FileIcon, Paperclip, Trash2, Download, ExternalLink, Upload } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ATTACHMENT_ACCEPT, ATTACHMENT_MAX_BYTES, attachmentRef, fileKind, formatBytes, formatDate, hasPerm,
  type AttachmentInfo, type AttachmentsPanel as PanelSpec, type FileKind,
} from '@erp/ui-schema';
import { api } from '@/lib/api';
import { loadSession } from '@/lib/session';
import { toast } from '@/lib/toast';

const ICONS: Record<FileKind, typeof FileIcon> = { image: FileImage, pdf: FileText, sheet: FileSpreadsheet, doc: FileText, text: FileText, file: FileIcon };
const ALLOWED_EXT = new Set(ATTACHMENT_ACCEPT.split(',').map((x) => x.slice(1)));

/** The file's bytes through the same-origin proxy with the user's token (links cannot carry the Authorization header). */
async function fetchBlob(module: string, id: string): Promise<Blob> {
  const token = loadSession()?.token;
  const res = await fetch(`/api/${module}/_attachments/${id}/content`, { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? 'ไม่พบไฟล์' : res.status === 403 ? 'บัญชีนี้ไม่มีสิทธิ์เปิดไฟล์นี้' : 'เปิดไฟล์ไม่ได้');
  return res.blob();
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'));
    r.readAsDataURL(file);
  });
}

/** Problem with a file before it is sent (the server re-checks size, type and content). */
function precheck(file: File): string | null {
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (!ALLOWED_EXT.has(ext)) return `${file.name}: ไม่รองรับไฟล์ประเภทนี้ (รองรับ ${[...ALLOWED_EXT].join(', ')})`;
  if (file.size > ATTACHMENT_MAX_BYTES) return `${file.name}: ใหญ่เกิน ${formatBytes(ATTACHMENT_MAX_BYTES)} (${formatBytes(file.size)})`;
  if (file.size === 0) return `${file.name}: ไฟล์ว่างเปล่า`;
  return null;
}

function Thumb({ module, file }: { module: string; file: AttachmentInfo }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    fetchBlob(module, file.id).then((b) => { if (alive) { made = URL.createObjectURL(b); setUrl(made); } }).catch(() => {});
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [module, file.id]);
  const Icon = ICONS.image;
  return url ? <img className="att-thumb" src={url} alt="" /> : <span className="att-icon" aria-hidden><Icon size={22} strokeWidth={1.6} /></span>;
}

/**
 * Files attached to one record (`DetailScreen.attachments`): list with icons/thumbnails, open, download, delete,
 * and upload by button or drag & drop. Talks to the module's kernel routes `/_attachments`.
 */
export function AttachmentsPanel({ module, spec, recordId }: { module: string; spec: PanelSpec; recordId: string }) {
  const perms = loadSession()?.permissions ?? [];
  const ref = attachmentRef(spec.entity, recordId);
  const [files, setFiles] = useState<AttachmentInfo[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [denied, setDenied] = useState(false);
  const allowed = hasPerm(perms, spec.perm);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<AttachmentInfo[]>(module, '/_attachments', { query: { ref } }).then((r) => { setFiles(r); setError(''); })
      .catch((e) => { setFiles([]); if (e.status === 403) setDenied(true); else setError(e.message); });
  }, [module, ref]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  // no right to see this record's files (the server decides): no panel at all
  if (!allowed || denied) return null;

  const upload = async (list: FileList | File[]) => {
    const all = Array.from(list);
    const problems = all.map(precheck).filter(Boolean) as string[];
    if (problems.length) toast({ title: 'แนบไฟล์ไม่ได้', body: problems.join('\n'), tone: 'stop' });
    const ok = all.filter((f) => !precheck(f));
    for (const f of ok) {
      setBusy(`กำลังแนบ ${f.name}…`);
      try {
        await api(module, '/_attachments', { method: 'POST', body: { ref, fileName: f.name, contentType: f.type || undefined, dataBase64: await readBase64(f) } });
      } catch (e) {
        toast({ title: `แนบ ${f.name} ไม่ได้`, body: (e as Error).message, tone: 'stop' });
      }
    }
    setBusy(null);
    if (ok.length) {
      toast({ title: `แนบไฟล์แล้ว ${ok.length} ไฟล์`, tone: 'ok' });
      load();
    }
  };

  const open = async (f: AttachmentInfo, download: boolean) => {
    // a tab must be opened inside the click, before the await, or the popup blocker stops it
    const win = download ? null : window.open('', '_blank');
    try {
      const url = URL.createObjectURL(await fetchBlob(module, f.id));
      if (win) win.location.href = url;
      else {
        const a = document.createElement('a');
        a.href = url;
        a.download = f.file_name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      win?.close();
      toast({ title: 'เปิดไฟล์ไม่ได้', body: (e as Error).message, tone: 'stop' });
    }
  };

  const remove = async (f: AttachmentInfo) => {
    if (!window.confirm(`ลบไฟล์ "${f.file_name}"?`)) return;
    try {
      await api(module, `/_attachments/${f.id}`, { method: 'DELETE' });
      toast({ title: 'ลบไฟล์แล้ว', tone: 'warn' });
      load();
    } catch (e) {
      toast({ title: 'ลบไฟล์ไม่ได้', body: (e as Error).message, tone: 'stop' });
    }
  };

  return (
    <section className="detail-lines attachments no-print" aria-label={spec.label ?? 'ไฟล์แนบ'}>
      <div className="att-head">
        <h2><Paperclip size={16} aria-hidden /> {spec.label ?? 'ไฟล์แนบ'}{files && files.length > 0 && <span className="att-count">{files.length}</span>}</h2>
        <button type="button" className="btn" onClick={() => input.current?.click()} disabled={!!busy}>
          <Upload size={16} aria-hidden /> แนบไฟล์
        </button>
        <input ref={input} type="file" multiple hidden accept={ATTACHMENT_ACCEPT} onChange={(e) => { if (e.target.files?.length) upload(e.target.files); e.target.value = ''; }} />
      </div>
      <div
        className={`att-drop${over ? ' over' : ''}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) upload(e.dataTransfer.files); }}
      >
        {error && <p className="form-error" role="alert">{error}</p>}
        {!files && <p className="muted">กำลังโหลด…</p>}
        {files && files.length === 0 && !busy && <p className="muted att-empty">ยังไม่มีไฟล์ — ลากไฟล์มาวางที่นี่ หรือกด “แนบไฟล์” (รูป, PDF, Excel, Word, CSV ไม่เกิน {formatBytes(ATTACHMENT_MAX_BYTES)})</p>}
        {files && files.length > 0 && (
          <ul className="att-list">
            {files.map((f) => {
              const kind = fileKind(f.content_type);
              const Icon = ICONS[kind];
              return (
                <li key={f.id} className="att-item">
                  <button type="button" className="att-open" onClick={() => open(f, kind !== 'image' && kind !== 'pdf')} title="เปิดไฟล์">
                    {kind === 'image' ? <Thumb module={module} file={f} /> : <span className="att-icon" aria-hidden><Icon size={22} strokeWidth={1.6} /></span>}
                    <span className="att-meta">
                      <span className="att-name">{f.file_name}</span>
                      <span className="muted">{formatBytes(f.size)} · {f.uploaded_by_name ?? 'ไม่ระบุชื่อ'} · {formatDate(f.created_at, true)}</span>
                    </span>
                  </button>
                  <span className="att-actions">
                    {(kind === 'image' || kind === 'pdf') && (
                      <button type="button" className="btn-ghost" onClick={() => open(f, false)} aria-label={`เปิด ${f.file_name}`} title="เปิดในแท็บใหม่"><ExternalLink size={16} /></button>
                    )}
                    <button type="button" className="btn-ghost" onClick={() => open(f, true)} aria-label={`ดาวน์โหลด ${f.file_name}`} title="ดาวน์โหลด"><Download size={16} /></button>
                    {f.can_delete && <button type="button" className="btn-ghost att-del" onClick={() => remove(f)} aria-label={`ลบ ${f.file_name}`} title="ลบ"><Trash2 size={16} /></button>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {busy && <p className="muted" role="status">{busy}</p>}
      </div>
    </section>
  );
}
