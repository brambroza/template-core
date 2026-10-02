'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { gsap, reducedMotion } from '@/lib/motion';
import { loadSession, saveSession, type Session } from '@/lib/session';

/** Isometric blocks that assemble on load — the factory being built, in 2D. */
function FloorArt() {
  const ref = useRef<SVGSVGElement>(null);
  const blocks: [number, number, number, boolean][] = [];
  for (let gx = 0; gx < 6; gx++) for (let gy = 0; gy < 5; gy++) if ((gx * 7 + gy * 3) % 4 !== 0) blocks.push([gx, gy, 1 + ((gx + gy * 2) % 3), (gx * 5 + gy) % 9 === 0]);
  const iso = (x: number, y: number, z: number) => [300 + (x - y) * 34, 120 + (x + y) * 19 - z * 22] as const;
  useLayoutEffect(() => {
    if (!ref.current || reducedMotion()) return;
    gsap.fromTo(ref.current.querySelectorAll('.blk'), { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'back.out(1.4)', stagger: { each: 0.03, from: 'random' } });
    gsap.to(ref.current.querySelectorAll('.blk.hot'), { opacity: 0.55, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 1.4 });
  }, []);
  return (
    <svg ref={ref} className="grid3d" viewBox="0 0 600 420" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {blocks.sort((a, b) => a[0] + a[1] - (b[0] + b[1])).map(([x, y, h, hot], i) => {
        const top = [iso(x, y, h), iso(x + 1, y, h), iso(x + 1, y + 1, h), iso(x, y + 1, h)];
        const left = [iso(x, y + 1, h), iso(x + 1, y + 1, h), iso(x + 1, y + 1, 0), iso(x, y + 1, 0)];
        const right = [iso(x + 1, y, h), iso(x + 1, y + 1, h), iso(x + 1, y + 1, 0), iso(x + 1, y, 0)];
        const pts = (p: readonly (readonly [number, number])[]) => p.map((q) => q.join(',')).join(' ');
        return (
          <g key={i} className={`blk${hot ? ' hot' : ''}`}>
            <polygon points={pts(left)} fill={hot ? '#B8920F' : '#1E2A33'} />
            <polygon points={pts(right)} fill={hot ? '#D9A800' : '#26343F'} />
            <polygon points={pts(top)} fill={hot ? '#F5C518' : '#33434F'} />
          </g>
        );
      })}
    </svg>
  );
}

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
      <section className="login-art">
        <FloorArt />
        <div style={{ position: 'relative' }}>
          <h2>โรงงานทั้งหมด ในหน้าจอเดียว</h2>
          <p>เห็นเครื่องจักร สต็อก งานผลิต และเงินเข้าออกแบบสด พร้อมผู้ช่วยที่สั่งงานด้วยภาษาไทย</p>
        </div>
      </section>
      <section className="login-pane">
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
      </section>
    </main>
  );
}
