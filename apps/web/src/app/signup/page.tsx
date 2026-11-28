'use client';
/**
 * Self-serve sign-up, step 1: company, name, e-mail, password and a plan → identity mails a 6-digit code (POST /api/identity/signup)
 * and answers with a ticket this browser keeps; step 2 is /signup/verify, where the code is typed and the company is created.
 * Plans and prices come from GET /api/identity/plans. Cloudflare Turnstile guards the form when the installation has its keys.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { loadSession } from '@/lib/session';
import { HOME, SHOWCASE, SHOWCASE_CONTACT } from '@/lib/showcase';
import { LogoMark } from '@/components/Brand';
import { AuthLayout } from '@/components/AuthLayout';
import { Turnstile, useCaptchaSiteKey } from '@/components/Turnstile';
import { savePendingSignup } from '@/lib/signup-pending';

interface Plan { id: string; nameTh: string; priceMonthly: number; maxUsers: number; modulesTh: string[] }
interface Industry { id: string; nameTh: string; blurb: string }

export default function Signup() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [trialDays, setTrialDays] = useState(14);
  const [form, setForm] = useState({ companyName: '', name: '', email: '', password: '', plan: 'factory', industry: '' });
  const [captcha, setCaptcha] = useState('');
  const [captchaRound, setCaptchaRound] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const siteKey = useCaptchaSiteKey(captchaRound);

  useEffect(() => {
    if (loadSession()) router.replace(HOME);
    api<{ trialDays: number; plans: Plan[]; industries?: Industry[] }>('identity', '/plans')
      .then((r) => { setPlans(r.plans); setTrialDays(r.trialDays); setIndustries(r.industries ?? []); }).catch(() => setPlans([]));
  }, [router]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (industries.length && !form.industry) { setFieldErrors({ industry: 'เลือกประเภทธุรกิจ หรือ "ไม่ต้องใส่ข้อมูลตัวอย่าง"' }); return; }
    if (siteKey && !captcha) { setError('กรุณายืนยันว่าไม่ใช่โปรแกรมอัตโนมัติ'); return; }
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      const r = await api<{ ticket: string; email: string; codeMinutes: number; resendSeconds: number }>(
        'identity', '/signup', { method: 'POST', body: { ...form, industry: form.industry || 'none', ...(captcha ? { captchaToken: captcha } : {}) } });
      const now = Date.now();
      // the code page (/signup/verify) reads the ticket from this tab
      savePendingSignup({ ticket: r.ticket, email: r.email, startedAt: now, sentAt: now, codeMinutes: r.codeMinutes, resendSeconds: r.resendSeconds });
      router.push('/signup/verify');
      return; // stays "กำลังส่งรหัสยืนยัน…" until the code page opens
    } catch (err) {
      setError(err instanceof Error ? err.message : 'สมัครไม่สำเร็จ');
      if (err instanceof ApiError) setFieldErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v[0]])));
      setCaptcha('');
      setCaptchaRound((n) => n + 1);
    }
    setBusy(false);
  };

  return (
    <AuthLayout title={`ทดลองใช้ฟรี ${trialDays} วัน`} lead="ไม่ต้องใส่บัตรเครดิต · ข้อมูลตัวอย่างพร้อมให้ลอง · ยกเลิกเมื่อไรก็ได้ ข้อมูลของคุณส่งออกได้ทั้งหมด">
      <section className="login-pane">
        {SHOWCASE ? (
          <div className="login-card">
            <h1>สมัครใช้งาน</h1>
            <p className="showcase-note">หน้านี้เป็นตัวอย่าง — <a href={SHOWCASE_CONTACT}>ติดต่อทีม GO Along</a> เพื่อเปิดบัญชีจริง</p>
          </div>
        ) : (
          <form className="login-card signup-card" onSubmit={submit} noValidate>
            <LogoMark size={44} className="login-mark" />
            <h1>สมัครใช้งาน</h1>
            <label>ชื่อบริษัท / กิจการ<input value={form.companyName} onChange={set('companyName')} autoComplete="organization" required aria-invalid={!!fieldErrors.companyName} />
              {fieldErrors.companyName && <span className="field-error">{fieldErrors.companyName}</span>}</label>
            <label>ชื่อของคุณ<input value={form.name} onChange={set('name')} autoComplete="name" required aria-invalid={!!fieldErrors.name} />
              {fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}</label>
            <label>อีเมลที่ทำงาน<input type="email" value={form.email} onChange={set('email')} autoComplete="email" required aria-invalid={!!fieldErrors.email} />
              {fieldErrors.email && <span className="field-error">{fieldErrors.email}</span>}</label>
            <label>ตั้งรหัสผ่าน (อย่างน้อย 8 ตัว)<input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" minLength={8} required aria-invalid={!!fieldErrors.password} />
              {fieldErrors.password && <span className="field-error">{fieldErrors.password}</span>}</label>
            {industries.length > 0 && (
              <label>ประเภทธุรกิจ (เราใส่ข้อมูลตัวอย่างให้ลองกดได้ทันที ล้างทิ้งได้เมื่อพร้อมใช้จริง)
                <select value={form.industry} onChange={set('industry')} required aria-invalid={!!fieldErrors.industry}>
                  <option value="" disabled>— เลือกประเภทธุรกิจ —</option>
                  {industries.map((i) => <option key={i.id} value={i.id}>{i.nameTh}</option>)}
                  <option value="none">ไม่ต้องใส่ข้อมูลตัวอย่าง (เริ่มจากระบบว่าง)</option>
                </select>
                {industries.find((i) => i.id === form.industry) && <small className="field-hint">{industries.find((i) => i.id === form.industry)!.blurb}</small>}
                {fieldErrors.industry && <span className="field-error">{fieldErrors.industry}</span>}
              </label>
            )}
            {plans.length > 0 && (
              <fieldset className="plan-pick">
                <legend>เลือกแพ็กเกจ (เปลี่ยนได้ภายหลัง)</legend>
                {plans.map((p) => (
                  <label key={p.id} className={`plan-opt${form.plan === p.id ? ' is-on' : ''}`}>
                    <input type="radio" name="plan" value={p.id} checked={form.plan === p.id} onChange={() => setForm((f) => ({ ...f, plan: p.id }))} />
                    <span className="plan-head"><b>{p.nameTh}</b><span>{p.priceMonthly.toLocaleString('en-US')} บาท/เดือน</span></span>
                    <small>{p.modulesTh.join(' · ')} · ไม่เกิน {p.maxUsers} ผู้ใช้</small>
                  </label>
                ))}
                <p className="plan-note">ราคายังไม่รวม VAT · ทดลองฟรี {trialDays} วันก่อน ไม่มีการตัดเงินอัตโนมัติ</p>
              </fieldset>
            )}
            <Turnstile siteKey={siteKey} onToken={setCaptcha} resetKey={captchaRound} />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'กำลังส่งรหัสยืนยัน…' : `เริ่มทดลองใช้ฟรี ${trialDays} วัน`}</button>
            <p className="plan-note">เราจะส่งรหัสยืนยัน 6 หลักไปที่อีเมลนี้ เพื่อให้คุณกรอกในหน้าถัดไป</p>
            <p className="login-links"><span>มีบัญชีแล้ว? <Link href="/login">เข้าสู่ระบบ</Link></span></p>
          </form>
        )}
      </section>
    </AuthLayout>
  );
}
