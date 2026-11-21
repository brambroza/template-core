'use client';
/**
 * Sample data of a trial company (GET /api/identity/starter): "กำลังเตรียมข้อมูลตัวอย่าง…" while it is put in, then what to try
 * first (approve the PO the sample clerk raised, receive goods, ship an order) and "ล้างข้อมูลตัวอย่าง — เริ่มใช้จริง".
 * Clearing deletes ALL of the company's data in every module, so the owner types the words. Nothing shows for companies
 * without sample data, once it is cleared, or in showcase mode.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { screenHref } from '@/lib/nav';
import { loadSession } from '@/lib/session';
import { HOME, SHOWCASE } from '@/lib/showcase';
import { toast } from '@/lib/toast';

interface StarterView {
  industry: string;
  industryName: string;
  state: 'seeding' | 'ready' | 'failed';
  next: { approvePo?: string; receivePo?: string; shipSo?: string; invoiceSo?: string };
  error: string | null;
}

const CONFIRM_WORDS = 'ล้างข้อมูลตัวอย่าง';

export function StarterBanner() {
  const [view, setView] = useState<StarterView | null>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);

  const load = useCallback(() => api<{ starter: StarterView | null }>('identity', '/starter').then((r) => setView(r.starter)).catch(() => setView(null)), []);
  useEffect(() => { if (!SHOWCASE) void load(); }, [load]);
  // seeding takes a few seconds: look again until it is done. On the home page reload once so every card shows the sample data;
  // anywhere else (the setup wizard, a form) only the bar changes — a reload would throw away what the owner is typing
  const sawSeeding = useRef(false);
  const path = usePathname();
  useEffect(() => {
    if (view?.state === 'seeding') {
      sawSeeding.current = true;
      const t = setTimeout(load, 3000);
      return () => clearTimeout(t);
    }
    if (view && sawSeeding.current) {
      sawSeeding.current = false;
      if (path === HOME) window.location.reload();
    }
  }, [view, load, path]);
  useEffect(() => { if (open) dialog.current?.showModal?.(); else dialog.current?.close?.(); }, [open]);

  if (!view) return null;
  const canClear = (loadSession()?.permissions ?? []).some((p) => p === '*' || p === 'identity.*' || p === 'identity.company.write');

  const clear = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api<{ message: string }>('identity', '/starter/clear', { method: 'POST', body: { confirm: typed.trim() } });
      setOpen(false);
      toast({ title: 'ล้างข้อมูลตัวอย่างแล้ว', body: r.message, tone: 'ok' });
      // every module deletes in the background (about a second): reload once they are done
      setTimeout(() => window.location.reload(), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ล้างไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  if (view.state === 'seeding') {
    return <p className="starter-bar" role="status"><Sparkles size={16} aria-hidden /> กำลังเตรียมข้อมูลตัวอย่าง “{view.industryName}” ให้ลองใช้… (ไม่กี่วินาที)</p>;
  }
  const { next } = view;
  return (
    <div className="starter-bar" role="note">
      <Sparkles size={16} aria-hidden />
      <span>
        {view.state === 'failed' ? view.error : <>ตอนนี้เป็น<b>ข้อมูลตัวอย่าง</b> “{view.industryName}” · ลองทำ:</>}
        {view.state === 'ready' && (
          <span className="starter-steps">
            {next.approvePo && <Link href={screenHref('purchasing', 'poList')}>อนุมัติใบสั่งซื้อ {next.approvePo}</Link>}
            {next.receivePo && <Link href={screenHref('purchasing', 'poList')}>รับของตาม {next.receivePo}</Link>}
            {next.shipSo && <Link href={screenHref('sales', 'soList')}>ส่งของตาม {next.shipSo}</Link>}
          </span>
        )}
      </span>
      {canClear && <button type="button" className="btn starter-clear" onClick={() => { setTyped(''); setError(''); setOpen(true); }}>ล้างข้อมูลตัวอย่าง — เริ่มใช้จริง</button>}
      <dialog ref={dialog} className="dialog" onClose={() => setOpen(false)}>
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); void clear(); }}>
          <h2>ล้างข้อมูลตัวอย่างและเริ่มใช้จริง</h2>
          <p>ระบบจะ<b>ลบข้อมูลทั้งหมดของบริษัท</b>ในทุกระบบ ทั้งข้อมูลตัวอย่างและทุกอย่างที่บันทึกระหว่างทดลอง (สินค้า คู่ค้า เอกสาร สต็อก บัญชี) และเลขที่เอกสารจะเริ่มใหม่ที่ 0001</p>
          <p>ที่ยังอยู่: ผู้ใช้ บทบาท ข้อมูลบริษัท (หัวเอกสาร) และแพ็กเกจ · ทำได้ครั้งเดียว ย้อนกลับไม่ได้</p>
          <label>พิมพ์ “{CONFIRM_WORDS}” เพื่อยืนยัน<input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>ยกเลิก</button>
            <button type="submit" className="btn btn-danger" disabled={busy || typed.trim() !== CONFIRM_WORDS}>{busy ? 'กำลังล้าง…' : 'ลบข้อมูลทั้งหมดของบริษัท'}</button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
