'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { attachmentRef, fillPath, get, initialValues, mergeAiFill, missingRequired, prefillFromQuery, recordLines, recordValues, routeParams, toBody, type FormScreen } from '@erp/ui-schema';
import { api, ApiError, isShowcaseRefusal } from '@/lib/api';
import { HOME } from '@/lib/showcase';
import { screenHref } from '@/lib/nav';
import { useRegistry } from '@/lib/registry';
import { toast } from '@/lib/toast';
import { AiFillButton, AiFillReview, DropOverlay, readDocument, useFileDrop, type AiProposal } from './AiFill';
import { clearQueue, enqueue, readable, remaining, takeNext } from '@/lib/ai-queue';
import { aiFilledGlow } from '@/lib/motion';
import { markSaved } from '@/lib/saved-flash';
import { FieldRow, LinesEditor, type Values } from './Fields';

function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'));
    r.readAsDataURL(blob);
  });
}


/** `screenId`: the screen's name in its module's ui.ts (needed by the "สแกนใบเสร็จ" AI route). */
export function FormView({ module, screen, id, screenId }: { module: string; screen: FormScreen; id?: string; screenId?: string }) {
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
  // "สแกนใบเสร็จ": what the AI proposed, and the file to attach to the saved record (if its detail screen has attachments)
  const { ui } = useRegistry();
  const [ai, setAi] = useState<{ proposal: AiProposal; filled: number } | null>(null);
  const aiFile = useRef<File | null>(null);
  const [attachAi, setAttachAi] = useState(true);
  const afterScreen = screen.after ? ui(module)?.screens[screen.after.screen] : undefined;
  const attachEntity = afterScreen?.kind === 'detail' && screen.after?.idFrom ? afterScreen.attachments?.entity : undefined;
  const canAi = !!screen.aiFill && !screen.load && !!screenId;
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState('');
  /** "เอกสาร 2 จาก 5" while a queue of dropped files is being worked through */
  const [queuePos, setQueuePos] = useState<{ position: number; total: number } | null>(null);
  const blankValues = () => ({ ...initialValues(screen.fields), ...prefillFromQuery(new URLSearchParams(firstQs.current).entries()) });
  const blankLines = () => (screen.lines ? [initialValues(screen.lines.fields)] : []);

  /** read one file and put what it says into the (fresh) form */
  const readFile = async (file: File, fresh: boolean) => {
    setAiBusy(true);
    setAiMessage('');
    try {
      const r = await readDocument(module, screenId!, file);
      if ('offline' in r) { setAiMessage(r.offline); return; }
      aiFile.current = r.file;
      const base = fresh ? { values: blankValues(), lines: blankLines() } : { values, lines };
      const merged = mergeAiFill(base, r.proposal, screen.lines ? initialValues(screen.lines.fields) : {});
      setValues(merged.values);
      if (screen.lines) setLines(merged.lines);
      setFieldErrors({}); setLineErrors({}); setError('');
      setAi({ proposal: r.proposal, filled: merged.filled });
      // what the AI just filled, for the glow that runs down those inputs once they are on screen
      const typedLines = base.lines.filter((l) => Object.values(l).some((v) => v !== '' && v !== undefined && v !== null)).length;
      setGlow({
        fields: Object.keys(r.proposal.values).filter((k) => !k.startsWith('__') && merged.values[k] === r.proposal.values[k] && (base.values[k] === '' || base.values[k] === undefined || base.values[k] === null)),
        lines: merged.lines.map((_, i) => i).filter((i) => i >= (typedLines ? typedLines : 0) && i < merged.lines.length && r.proposal.lines.length > 0),
      });
    } catch (e) {
      setAiMessage(e instanceof Error ? e.message : 'AI อ่านเอกสารไม่ได้');
    } finally {
      setAiBusy(false);
    }
  };
  /** open the next queued file in an empty form; false when the queue is done */
  const nextQueued = (fresh: boolean): boolean => {
    const n = canAi ? takeNext(module, screenId!) : undefined;
    if (!n) { setQueuePos(null); return false; }
    setQueuePos({ position: n.position, total: n.total });
    if (fresh) { setValues(blankValues()); setLines(blankLines()); setAi(null); aiFile.current = null; }
    readFile(n.file, fresh);
    return true;
  };
  const takeFiles = (picked: File[]) => {
    const { ok, skipped } = readable(picked);
    if (!ok.length) { setAiMessage('รองรับรูป JPG / PNG / WEBP หรือ PDF'); return; }
    if (skipped) toast({ title: `ข้าม ${skipped} ไฟล์ที่ไม่ใช่รูปหรือ PDF`, tone: 'warn' });
    if (ok.length === 1) { setQueuePos(null); clearQueue(); readFile(ok[0], false); return; }
    enqueue(module, screenId!, ok);
    nextQueued(false);
  };
  const formRef = useRef<HTMLFormElement>(null);
  const [glow, setGlow] = useState<{ fields: string[]; lines: number[] } | null>(null);
  useEffect(() => {
    if (!glow || !formRef.current) return;
    const root = formRef.current;
    const inputs = [
      ...glow.fields.flatMap((f) => [...root.querySelectorAll<HTMLElement>(`[data-field="${CSS.escape(f)}"] :is(input, select, textarea)`)]),
      ...glow.lines.flatMap((i) => [...root.querySelectorAll<HTMLElement>(`tr[data-line="${i}"] :is(input, select, textarea)`)]),
    ];
    aiFilledGlow(inputs);
    setGlow(null);
  }, [glow]);
  const drop = useFileDrop(canAi && !busy && !aiBusy, takeFiles);
  // opened from a list's "สร้างจากเอกสาร" (?ai=next): start on the first queued file
  useEffect(() => { if (canAi && search.get('ai') === 'next') nextQueued(false); }, []);
  useEffect(() => {
    // a new command while this form is open: apply its values (the first render already used them)
    if (qs !== firstQs.current) setValues((v) => ({ ...v, ...prefillFromQuery(new URLSearchParams(qs).entries()) }));
  }, [qs]);

  useEffect(() => {
    if (!screen.load) return;
    api<Record<string, unknown>>(module, fillPath(screen.load, params))
      .then((rec) => {
        setValues(recordValues(screen.fields, rec));
        // an edit form with lines (a BOM, a journal) opens with the record's lines, not one blank row
        if (screen.lines) { const ls = recordLines(screen.lines, rec); if (ls.length) setLines(ls); }
      })
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
      // automation rules may have reacted to what was just saved: refresh the bell shortly
      setTimeout(() => window.dispatchEvent(new CustomEvent('erp:notifications')), 1500);
      const after = screen.after;
      const savedId = after?.idFrom ? get(result, after.idFrom) : undefined;
      if (ai && aiFile.current && attachEntity && attachAi && savedId) {
        const f = aiFile.current;
        try {
          await api(module, '/_attachments', { method: 'POST', body: { ref: attachmentRef(attachEntity, String(savedId)), fileName: f.name, contentType: f.type || undefined, dataBase64: await readBase64(f) } });
        } catch (err) {
          toast({ title: 'บันทึกแล้ว แต่แนบรูปไม่ได้', body: `${(err as Error).message} — แนบเองได้ที่หน้าเอกสาร`, tone: 'warn' });
        }
      }
      const target = after ? screenHref(module, after.screen, after.idFrom ? get(result, after.idFrom) : undefined) : HOME;
      // a new document opens with the "บันทึกแล้ว" panel (SavedPanel, flag handed over in memory); edits just go back to the document
      const celebrate = !screen.load && afterScreen?.kind === 'detail' && !!after?.idFrom && target !== HOME;
      // a queue of documents: stay on the form and open the next one; the saved record is one click away
      if (canAi && remaining(module, screenId!) > 0) {
        toast({ title: `บันทึกฉบับที่ ${queuePos?.position ?? ''} แล้ว — เปิดฉบับถัดไป`, ...(target !== HOME ? { href: target } : {}), tone: 'ok' });
        setBusy(false);
        nextQueued(true);
        return;
      }
      if (queuePos) { clearQueue(); if (queuePos.total > 1) toast({ title: `บันทึกครบ ${queuePos.total} ฉบับแล้ว`, tone: 'ok' }); }
      if (celebrate) markSaved(target);
      router.push(target);
    } catch (err) {
      setBusy(false);
      if (isShowcaseRefusal(err)) return; // showcase: a toast already explained it, the form stays as typed
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      if (err instanceof ApiError) setFieldErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v[0]])));
    }
  };

  if (loading) return <p className="muted">กำลังโหลด…</p>;
  return (
    <form ref={formRef} className={`screen form${canAi ? ' has-drop' : ''}`} onSubmit={submit} noValidate {...drop.props}>
      <DropOverlay show={drop.over} label="วางรูปหรือ PDF ให้ AI กรอกฟอร์มนี้ (หลายไฟล์ = ทำทีละฉบับ)" />
      <header className="screen-head">
        <h1>{screen.title}</h1>
        {canAi && <AiFillButton spec={screen.aiFill!} busy={aiBusy} message={aiMessage} onFiles={takeFiles} />}
      </header>
      {queuePos && (
        <div className="ai-queue" role="status">
          <b>เอกสาร {queuePos.position} จาก {queuePos.total}</b>
          <span className="muted">ตรวจแล้วกดบันทึก ฉบับถัดไปจะเปิดให้เอง</span>
          <span className="ai-queue-actions">
            <button type="button" className="btn-ghost" disabled={aiBusy} onClick={() => { if (!nextQueued(true)) { setValues(blankValues()); setLines(blankLines()); setAi(null); } }}>ข้ามฉบับนี้</button>
            <button type="button" className="btn-ghost" onClick={() => { clearQueue(); setQueuePos(null); }}>หยุดคิว</button>
          </span>
        </div>
      )}
      {aiBusy && <div className="ai-reading" role="status"><span className="ai-reading-bar" aria-hidden />AI กำลังอ่านเอกสาร…</div>}
      {ai && (
        <AiFillReview proposal={ai.proposal} filled={ai.filled} attach={attachEntity ? attachAi : null} onAttach={setAttachAi} onClose={() => setAi(null)} />
      )}
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
