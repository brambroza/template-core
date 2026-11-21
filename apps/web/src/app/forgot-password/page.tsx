'use client';
/** "ลืมรหัสผ่าน": e-mail → identity mails a one-time link (same answer whether or not the e-mail has an account). */
import Link from 'next/link';
import { useState } from 'react';
import { MailCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { LogoMark } from '@/components/Brand';
import { AuthLayout } from '@/components/AuthLayout';
import { Turnstile, TURNSTILE_SITE_KEY } from '@/components/Turnstile';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [round, setRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (TURNSTILE_SITE_KEY && !captcha) { setError('กรุณายืนยันว่าไม่ใช่โปรแกรมอัตโนมัติ'); return; }
    setBusy(true);
    setError('');
    try {
      const r = await api<{ message: string }>('identity', '/auth/forgot', { method: 'POST', body: { email, ...(captcha ? { captchaToken: captcha } : {}) } });
      setSent(r.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ส่งไม่สำเร็จ');
      setCaptcha('');
      setRound((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <section className="login-pane">
        {sent ? (
          <div className="login-card" role="status">
            <MailCheck size={40} aria-hidden className="login-done-icon" />
            <h1>ตรวจอีเมลของคุณ</h1>
            <p>{sent}</p>
            <p className="login-links"><Link href="/login">กลับไปหน้าเข้าสู่ระบบ</Link></p>
          </div>
        ) : (
          <form className="login-card" onSubmit={submit}>
            <LogoMark size={44} className="login-mark" />
            <h1>ลืมรหัสผ่าน</h1>
            <p className="muted">ใส่อีเมลที่ใช้เข้าสู่ระบบ เราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้</p>
            <label>อีเมล<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
            <Turnstile onToken={setCaptcha} resetKey={round} />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'กำลังส่ง…' : 'ส่งลิงก์ตั้งรหัสผ่านใหม่'}</button>
            <p className="login-links"><Link href="/login">กลับไปหน้าเข้าสู่ระบบ</Link></p>
          </form>
        )}
      </section>
    </AuthLayout>
  );
}
