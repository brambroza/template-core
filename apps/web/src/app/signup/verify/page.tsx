'use client';
/** The link in the sign-up mail: confirms the e-mail, creates the company and signs the new owner straight into the setup wizard. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { saveSession, type Session } from '@/lib/session';
import { AuthLayout } from '@/components/AuthLayout';

export default function VerifySignup() {
  const router = useRouter();
  const [error, setError] = useState('');
  const once = useRef(false); // the link works once: React's dev double effect must not spend it twice
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    if (!token) { setError('ลิงก์ไม่ครบ — เปิดลิงก์จากอีเมลอีกครั้ง'); return; }
    api<Session & { token: string }>('identity', '/signup/verify', { method: 'POST', body: { token } })
      .then((r) => {
        saveSession({ token: r.token, tenant: r.tenant, user: r.user, permissions: r.permissions });
        router.replace('/setup'); // the 5-step "ตั้งค่าเริ่มต้น" wizard first
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'ยืนยันไม่สำเร็จ'));
  }, [router]);

  return (
    <AuthLayout>
      <section className="login-pane">
        <div className="login-card" role="status" aria-live="polite">
          {!error ? (
            <><h1>กำลังเตรียมบริษัทของคุณ…</h1><p className="muted"><Loader2 size={16} className="spin" aria-hidden /> ยืนยันอีเมลและสร้างระบบ ใช้เวลาไม่กี่วินาที</p></>
          ) : (
            <>
              <h1>ยืนยันไม่สำเร็จ</h1>
              <p className="form-error" role="alert">{error}</p>
              <p className="login-links"><Link href="/login">เข้าสู่ระบบ</Link><Link href="/signup">สมัครใหม่</Link></p>
            </>
          )}
        </div>
      </section>
    </AuthLayout>
  );
}
