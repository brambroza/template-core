'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { gsap, reducedMotion } from '@/lib/motion';
import { loadSession, loginNotice, loginReasonFrom, saveSession, type LoginReason, type Session } from '@/lib/session';
import { HOME, SHOWCASE, SHOWCASE_CONTACT } from '@/lib/showcase';
import { AiSpark, LogoMark, Wordmark } from '@/components/Brand';

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
      <defs>
        <linearGradient id="hot-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6366F1" /><stop offset=".5" stopColor="#A78BFA" /><stop offset="1" stopColor="#22D3EE" /></linearGradient>
      </defs>
      {blocks.sort((a, b) => a[0] + a[1] - (b[0] + b[1])).map(([x, y, h, hot], i) => {
        const top = [iso(x, y, h), iso(x + 1, y, h), iso(x + 1, y + 1, h), iso(x, y + 1, h)];
        const left = [iso(x, y + 1, h), iso(x + 1, y + 1, h), iso(x + 1, y + 1, 0), iso(x, y + 1, 0)];
        const right = [iso(x + 1, y, h), iso(x + 1, y + 1, h), iso(x + 1, y + 1, 0), iso(x + 1, y, 0)];
        const pts = (p: readonly (readonly [number, number])[]) => p.map((q) => q.join(',')).join(' ');
        return (
          <g key={i} className={`blk${hot ? ' hot' : ''}`}>
            {/* plain blocks take their colours from CSS (--blk-*: light by default); AI-hue "hot" blocks keep the gradient */}
            <polygon points={pts(left)} className={hot ? undefined : 'f-left'} fill={hot ? '#4F46E5' : undefined} />
            <polygon points={pts(right)} className={hot ? undefined : 'f-right'} fill={hot ? '#7C5CF0' : undefined} />
            <polygon points={pts(top)} className={hot ? undefined : 'f-top'} fill={hot ? 'url(#hot-top)' : undefined} />
          </g>
        );
      })}
    </svg>
  );
}

interface Persona { id: string; label: string; description: string; email: string; name: string; tenant: string }

/** Showcase login: one click per recorded role (GET /api/_showcase lists them; the tokens are fake and only work on this site). */
function PersonaPicker({ onDone }: { onDone: () => void }) {
  const [personas, setPersonas] = useState<Persona[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ personas: Persona[] }>('_showcase', '').then((r) => setPersonas(r.personas)).catch(() => { setPersonas([]); setError('โหลดตัวอย่างไม่สำเร็จ ลองรีเฟรชหน้านี้'); });
  }, []);
  const enter = async (p: Persona) => {
    setBusy(p.id);
    setError('');
    try {
      const r = await api<Session & { token: string }>('identity', '/auth/login', { method: 'POST', body: { persona: p.id, email: p.email } });
      saveSession({ token: r.token, tenant: r.tenant, user: r.user, permissions: r.permissions });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เข้าชมไม่สำเร็จ');
      setBusy('');
    }
  };
  return (
    <div className="login-card">
      <LogoMark size={44} className="login-mark" />
      <h1>ลองใช้ระบบจริง</h1>
      <p className="showcase-note">หน้าจอจริงของ Factory OS กับข้อมูลบริษัทสมมติ — เลือกบทบาทเพื่อดูว่าแต่ละฝ่ายเห็นอะไร ไม่ต้องสมัคร ไม่บันทึกข้อมูล</p>
      {!personas && <p className="muted">กำลังโหลด…</p>}
      <div className="persona-list">
        {personas?.map((p, i) => (
          <button key={p.id} type="button" className={`persona${i === 0 ? ' is-main' : ''}`} disabled={!!busy} onClick={() => enter(p)}>
            <span className="avatar" aria-hidden>{(p.name || p.label).trim().slice(0, 1)}</span>
            <span><b>เข้าชมในฐานะ {p.label}</b><small>{p.description || p.name}</small></span>
            <span className="go" aria-hidden>{busy === p.id ? 'กำลังเข้า…' : 'เข้าชม →'}</span>
          </button>
        ))}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="showcase-note">อยากเห็นกับข้อมูลแบบธุรกิจคุณ? <a href={SHOWCASE_CONTACT}>ขอเดโมเต็มกับทีม GO Along</a></p>
    </div>
  );
}

export default function Login() {
  const router = useRouter();
  const [tenant, setTenant] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<LoginReason>(null);

  useEffect(() => {
    if (loadSession()) router.replace(HOME);
    setReason(loginReasonFrom(window.location.search));
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
      router.replace(HOME);
    } catch (err) {
      setError(err instanceof Error && err.message !== 'Invalid credentials' ? err.message : 'รหัสบริษัท อีเมล หรือรหัสผ่านไม่ถูกต้อง');
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <section className="login-art">
        <FloorArt />
        <Wordmark size={34} by />
        <div style={{ position: 'relative' }}>
          <p className="ai-line"><AiSpark size={14} />ผู้ช่วย AI สั่งงานด้วยภาษาไทย</p>
          <h2>โรงงานทั้งหมด ในหน้าจอเดียว</h2>
          <p>เห็นเครื่องจักร สต็อก งานผลิต และเงินเข้าออกแบบสด พร้อมผู้ช่วยที่สั่งงานด้วยภาษาไทย</p>
        </div>
      </section>
      <section className="login-pane">
        {SHOWCASE ? <PersonaPicker onDone={() => router.replace(HOME)} /> : (
        <form className="login-card" onSubmit={submit}>
          <LogoMark size={44} className="login-mark" />
          <h1>เข้าสู่ระบบ</h1>
          {reason && <p className="login-note" role="status">{loginNotice(reason)}</p>}
          <label>รหัสบริษัท<input value={tenant} onChange={(e) => setTenant(e.target.value)} autoComplete="organization" required /></label>
          <label>อีเมล<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></label>
          <label>รหัสผ่าน<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
        </form>
        )}
      </section>
    </main>
  );
}
