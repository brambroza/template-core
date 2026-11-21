'use client';
/** The link in the reset mail: set a new password (twice), then sign in. Every older session ends. */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { LogoMark } from '@/components/Brand';
import { AuthLayout } from '@/components/AuthLayout';

export default function ResetPassword() {
  const [token, setToken] = useState('');
  // an invitation from a colleague (POST /users/invite) uses the same one-time link: only the wording differs
  const [invite, setInvite] = useState(false);
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setToken(q.get('token') ?? '');
    setInvite(q.get('invite') === '1');
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) { setError('รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร'); return; }
    if (pw !== again) { setError('รหัสผ่านสองช่องไม่ตรงกัน'); return; }
    setBusy(true);
    setError('');
    try {
      const r = await api<{ message: string }>('identity', '/auth/reset', { method: 'POST', body: { token, newPassword: pw } });
      setDone(r.message);
    } catch (err) {
      setError(err instanceof ApiError && err.fieldErrors.newPassword?.[0] ? err.fieldErrors.newPassword[0] : err instanceof Error ? err.message : 'ตั้งรหัสผ่านไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <section className="login-pane">
        {done ? (
          <div className="login-card" role="status">
            <CheckCircle2 size={40} aria-hidden className="login-done-icon" />
            <h1>{invite ? 'ตั้งรหัสผ่านแล้ว' : 'ตั้งรหัสผ่านใหม่แล้ว'}</h1>
            <p>{done}</p>
            <Link className="btn-primary" href="/login">เข้าสู่ระบบ</Link>
          </div>
        ) : (
          <form className="login-card" onSubmit={submit}>
            <LogoMark size={44} className="login-mark" />
            <h1>{invite ? 'ตั้งรหัสผ่านเพื่อเริ่มใช้งาน' : 'ตั้งรหัสผ่านใหม่'}</h1>
            {!token && <p className="form-error" role="alert">ลิงก์ไม่ครบ — เปิดลิงก์จากอีเมลอีกครั้ง หรือ <Link href="/forgot-password">ขอลิงก์ใหม่</Link></p>}
            <label>{invite ? 'รหัสผ่าน' : 'รหัสผ่านใหม่'} (อย่างน้อย 8 ตัว)<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" minLength={8} required /></label>
            <label>{invite ? 'ใส่รหัสผ่านอีกครั้ง' : 'ใส่รหัสผ่านใหม่อีกครั้ง'}<input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" minLength={8} required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn-primary" type="submit" disabled={busy || !token}>{busy ? 'กำลังบันทึก…' : invite ? 'ตั้งรหัสผ่านและเริ่มใช้งาน' : 'ตั้งรหัสผ่านใหม่'}</button>
            <p className="login-links"><Link href="/forgot-password">ขอลิงก์ใหม่</Link><Link href="/login">กลับไปหน้าเข้าสู่ระบบ</Link></p>
          </form>
        )}
      </section>
    </AuthLayout>
  );
}
