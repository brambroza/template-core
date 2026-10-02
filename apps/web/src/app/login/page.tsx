'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { loadSession, saveSession, type Session } from '@/lib/session';

export default function Login() {
  const router = useRouter();
  const [tenant, setTenant] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (loadSession()) router.replace('/');
    setExpired(new URLSearchParams(window.location.search).has('expired'));
    try { setTenant(window.localStorage.getItem('erp.tenant') ?? ''); } catch { /* ignore */ }
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<Session & { token: string }>('identity', '/auth/login', { method: 'POST', body: { tenant, email, password } });
      saveSession({ token: r.token, tenant: r.tenant, user: r.user, permissions: r.permissions });
      try { window.localStorage.setItem('erp.tenant', tenant); } catch { /* ignore */ }
      router.replace('/');
    } catch (err) {
      setError(err instanceof Error && err.message !== 'Invalid credentials' ? err.message : 'รหัสบริษัท อีเมล หรือรหัสผ่านไม่ถูกต้อง');
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-tape" aria-hidden />
        <h1>เข้าสู่ระบบ</h1>
        {expired && <p className="login-note">หมดเวลาการใช้งาน เข้าสู่ระบบอีกครั้ง</p>}
        <label>รหัสบริษัท<input value={tenant} onChange={(e) => setTenant(e.target.value)} autoComplete="organization" required /></label>
        <label>อีเมล<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
        <label>รหัสผ่าน<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
      </form>
    </main>
  );
}
