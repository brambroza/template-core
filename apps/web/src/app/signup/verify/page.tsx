'use client';
/**
 * Sign-up, step 2: type the 6-digit code from the mail. The ticket of the sign-up was kept by /signup in this tab
 * (lib/signup-pending.ts); ticket + code → POST /api/identity/signup/verify confirms the e-mail, creates the company and signs
 * the new owner straight into the setup wizard. "ส่งรหัสอีกครั้ง" → POST /api/identity/signup/resend (one per minute).
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MailCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { loadSession, saveSession, type Session } from '@/lib/session';
import { HOME } from '@/lib/showcase';
import {
  clearPendingSignup, clock, CODE_LENGTH, codeDigits, digitOfKey, loadPendingSignup, savePendingSignup, secondsLeft, type PendingSignup,
} from '@/lib/signup-pending';
import { AuthLayout } from '@/components/AuthLayout';

export default function VerifySignup() {
  const router = useRouter();
  /** undefined = not read yet (first paint), null = this tab has no sign-up waiting */
  const [pending, setPending] = useState<PendingSignup | null | undefined>(undefined);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);
  const checking = useRef(false); // typing the sixth digit and pressing Enter must not send the code twice (it works once)

  useEffect(() => {
    if (loadSession()) { router.replace(HOME); return; }
    setPending(loadPendingSignup());
  }, [router]);
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const verify = useCallback(async (value: string) => {
    if (!pending || value.length !== CODE_LENGTH || checking.current) return;
    checking.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api<Session & { token: string }>('identity', '/signup/verify', { method: 'POST', body: { ticket: pending.ticket, code: value } });
      clearPendingSignup();
      saveSession({ token: r.token, tenant: r.tenant, user: r.user, permissions: r.permissions });
      router.replace('/setup'); // the 5-step "ตั้งค่าเริ่มต้น" wizard first; stays "กำลังเตรียม…" until it opens
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ยืนยันไม่สำเร็จ');
      setCode('');
      setBusy(false);
      checking.current = false;
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [pending, router]);

  /** Every way digits arrive (typing, paste, the phone's "from Mail" suggestion): keep six digits, check as soon as they are complete. */
  const accept = (raw: string) => {
    const digits = codeDigits(raw);
    setCode(digits);
    if (digits.length === CODE_LENGTH) void verify(digits);
  };

  const resend = async () => {
    if (!pending || resending || busy) return;
    setResending(true);
    setError('');
    setNotice('');
    try {
      const r = await api<{ message: string; codeMinutes: number; resendSeconds: number }>('identity', '/signup/resend', { method: 'POST', body: { ticket: pending.ticket } });
      const next = { ...pending, sentAt: Date.now(), codeMinutes: r.codeMinutes, resendSeconds: r.resendSeconds };
      savePendingSignup(next);
      setPending(next);
      setNow(Date.now());
      setNotice(r.message);
      setCode('');
      input.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ส่งรหัสไม่สำเร็จ');
    } finally {
      setResending(false);
    }
  };

  const startOver = () => {
    clearPendingSignup();
    router.replace('/signup');
  };

  const codeLeft = pending ? secondsLeft(pending.sentAt + pending.codeMinutes * 60_000, now) : 0;
  const resendIn = pending ? secondsLeft(pending.sentAt + pending.resendSeconds * 1000, now) : 0;

  return (
    <AuthLayout>
      <section className="login-pane">
        {pending === undefined ? (
          <div className="login-card" role="status"><p className="muted"><Loader2 size={16} className="spin" aria-hidden /> กำลังโหลด…</p></div>
        ) : pending === null ? (
          <div className="login-card">
            <h1>ไม่พบการสมัครที่รอยืนยัน</h1>
            <p className="muted">รหัสยืนยันต้องกรอกในเบราว์เซอร์และแท็บเดียวกับที่กดสมัคร ภายใน 24 ชั่วโมง — ถ้าปิดแท็บนั้นไปแล้ว ให้สมัครใหม่อีกครั้ง (ใช้เวลาไม่ถึงนาที)</p>
            <p className="login-links"><Link href="/signup">สมัครใหม่</Link><Link href="/login">เข้าสู่ระบบ</Link></p>
          </div>
        ) : (
          <form className="login-card" onSubmit={(e) => { e.preventDefault(); void verify(code); }} noValidate>
            <MailCheck size={40} aria-hidden className="login-done-icon" />
            <h1>กรอกรหัสยืนยัน</h1>
            <p>เราส่งรหัส 6 หลักไปที่ <b className="code-mail">{pending.email}</b> — เปิดอีเมลแล้วพิมพ์รหัสที่นี่ (ถ้าไม่เห็น ลองดูในโฟลเดอร์สแปม)</p>
            <label>รหัสยืนยัน 6 หลัก
              <input
                ref={input} className="code-input" value={code} disabled={busy} autoFocus
                type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" placeholder="••••••"
                aria-invalid={!!error} aria-describedby="code-meta"
                onChange={(e) => accept(e.target.value)}
                onKeyDown={(e) => {
                  // Thai keyboard layout: the number row types ๅ / - ภ ถ … — take the digit of the key instead
                  const digit = digitOfKey(e);
                  if (digit === null) return;
                  e.preventDefault();
                  const el = e.currentTarget;
                  accept(code.slice(0, el.selectionStart ?? code.length) + digit + code.slice(el.selectionEnd ?? code.length));
                }}
              />
            </label>
            <p id="code-meta" className={`code-meta${codeLeft ? '' : ' is-over'}`}>
              {codeLeft ? `รหัสนี้ใช้ได้อีก ${clock(codeLeft)} นาที` : 'รหัสนี้หมดอายุแล้ว — กด "ส่งรหัสอีกครั้ง" เพื่อรับรหัสใหม่'}
            </p>
            {notice && <p className="form-note" role="status">{notice}</p>}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn-primary" type="submit" disabled={busy || code.length !== CODE_LENGTH}>
              {busy ? <><Loader2 size={16} className="spin" aria-hidden /> กำลังเตรียมบริษัทของคุณ…</> : 'ยืนยันและเริ่มใช้งาน'}
            </button>
            <p className="login-links">
              <button type="button" className="linklike" onClick={resend} disabled={resendIn > 0 || resending || busy}>
                {resending ? 'กำลังส่ง…' : resendIn > 0 ? `ส่งรหัสอีกครั้งได้ใน ${resendIn} วินาที` : 'ส่งรหัสอีกครั้ง'}
              </button>
              <button type="button" className="linklike" onClick={startOver} disabled={busy}>ใช้อีเมลอื่น</button>
            </p>
            <p className="plan-note">ถ้าอีเมลนี้มีบัญชีอยู่แล้ว อีเมลที่ได้รับจะเป็นวิธีเข้าสู่ระบบแทนรหัส — <Link href="/login">เข้าสู่ระบบ</Link></p>
          </form>
        )}
      </section>
    </AuthLayout>
  );
}
