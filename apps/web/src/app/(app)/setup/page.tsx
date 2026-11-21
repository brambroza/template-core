'use client';
/**
 * "ตั้งค่าเริ่มต้น" — 5 steps for a new cloud company (GET /api/identity/onboarding). Each step saves through the module that owns
 * the setting, then marks itself done; every step can be skipped and done later from the settings screens.
 *   1 ข้อมูลบริษัท   PUT identity /company (letterhead + seller details on every document)
 *   2 วิธีอนุมัติ     PUT purchasing /settings (works alone → may approve own POs; with approvers → creator cannot approve)
 *   3 ชวนทีมงาน    POST identity /users/invite (e-mail with a set-your-password link, role from a template)
 *   4 ข้อมูลตั้งต้น   links to the CSV imports of items and partners; the sample data bar handles "ล้างข้อมูลตัวอย่าง"
 *   5 เริ่มใช้งาน     summary, POST /onboarding/complete → home
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { screenHref } from '@/lib/nav';
import { useRegistry } from '@/lib/registry';
import { HOME } from '@/lib/showcase';
import { toast } from '@/lib/toast';

interface Step { id: 'company' | 'approvals' | 'team' | 'data' | 'start'; title: string; hint: string; done: boolean }
interface Onboarding { steps: Step[]; doneCount: number; completed: boolean }
interface Company { legal_name: string; tax_id: string | null; branch_code: string; address: string | null; phone: string | null; email: string | null; logo: string | null }
interface Template { id: string; name: string; description: string }

const LOGO_MAX = 300 * 1024;
const TEAM_TEMPLATES = ['executive', 'supervisor', 'purchasing', 'sales', 'warehouse', 'accounting', 'technician', 'staff'];

export default function Setup() {
  const router = useRouter();
  const [ob, setOb] = useState<Onboarding | null | undefined>(undefined);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    api<{ onboarding: Onboarding | null }>('identity', '/onboarding').then((r) => {
      setOb(r.onboarding);
      if (r.onboarding) setCurrent(Math.max(0, r.onboarding.steps.findIndex((s) => !s.done)));
    }).catch(() => setOb(null));
  }, []);

  if (ob === undefined) return <p className="muted">กำลังโหลด…</p>;
  if (ob === null) {
    return (
      <section className="setup">
        <h1>ตั้งค่าเริ่มต้น</h1>
        <p>บริษัทนี้ตั้งค่าโดยทีม GO Along แล้ว ตั้งค่าเพิ่มเติมได้ที่เมนูตั้งค่าแต่ละส่วน</p>
        <Link className="btn-primary" href={HOME}>ไปหน้าแรก</Link>
      </section>
    );
  }

  const step = ob.steps[current]!;
  const markDone = async (id: Step['id']) => {
    const r = await api<{ onboarding: Onboarding }>('identity', `/onboarding/steps/${id}`, { method: 'POST' });
    setOb(r.onboarding);
  };
  const next = async () => {
    await markDone(step.id);
    setCurrent((i) => Math.min(i + 1, ob.steps.length - 1));
  };
  const finish = async () => {
    await markDone('start');
    await api('identity', '/onboarding/complete', { method: 'POST' });
    toast({ title: 'ตั้งค่าเริ่มต้นเรียบร้อย', body: 'ปรับเพิ่มได้ทุกเมื่อที่เมนูตั้งค่า', tone: 'ok' });
    router.replace(HOME);
  };

  return (
    <section className="setup">
      <header className="setup-head">
        <h1>ตั้งค่าเริ่มต้น</h1>
        <p className="muted">5 ขั้น ใช้เวลาประมาณ 10 นาที · ข้ามขั้นไหนก็ได้แล้วกลับมาทำทีหลัง</p>
      </header>
      <ol className="setup-steps" aria-label="ขั้นตอน">
        {ob.steps.map((s, i) => (
          <li key={s.id} className={`${i === current ? 'is-current' : ''}${s.done ? ' is-done' : ''}`}>
            <button type="button" onClick={() => setCurrent(i)} aria-current={i === current ? 'step' : undefined}>
              <span className="setup-num" aria-hidden>{s.done ? <Check size={14} /> : i + 1}</span>
              <span>{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="setup-card">
        <h2>{current + 1}. {step.title}</h2>
        <p className="muted">{step.hint}</p>
        {step.id === 'company' && <CompanyStep onSaved={next} />}
        {step.id === 'approvals' && <ApprovalsStep onSaved={next} />}
        {step.id === 'team' && <TeamStep onDone={next} />}
        {step.id === 'data' && <DataStep onDone={next} />}
        {step.id === 'start' && <StartStep ob={ob} onFinish={finish} />}
        {step.id !== 'start' && (
          <p className="setup-skip"><button type="button" className="linklike" onClick={() => setCurrent((i) => i + 1)}>ข้ามไปก่อน</button></p>
        )}
      </div>
    </section>
  );
}

/** 1 — company profile (letterhead). Pre-filled with what identity already has (the name from sign-up). */
function CompanyStep({ onSaved }: { onSaved: () => Promise<void> }) {
  const [f, setF] = useState({ legalName: '', taxId: '', branchCode: '00000', address: '', phone: '', email: '', logo: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Company>('identity', '/company').then((c) => setF({
      legalName: c.legal_name ?? '', taxId: c.tax_id ?? '', branchCode: c.branch_code ?? '00000', address: c.address ?? '',
      phone: c.phone ?? '', email: c.email ?? '', logo: c.logo ?? '',
    })).catch(() => undefined);
  }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pickLogo = (file?: File) => {
    if (!file) return;
    if (file.size > LOGO_MAX) { setErrors((x) => ({ ...x, logo: 'โลโก้ใหญ่เกิน 300 KB' })); return; }
    const r = new FileReader();
    r.onload = () => setF((x) => ({ ...x, logo: String(r.result) }));
    r.readAsDataURL(file);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(''); setErrors({});
    try {
      await api('identity', '/company', {
        method: 'PUT',
        body: { legalName: f.legalName, taxId: f.taxId || null, branchCode: f.branchCode || '00000', address: f.address, phone: f.phone || null, email: f.email || null, logo: f.logo || null },
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      if (err instanceof ApiError) setErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v[0]])));
    } finally { setBusy(false); }
  };
  const fe = (k: string) => errors[k] && <span className="field-error">{errors[k]}</span>;
  return (
    <form className="setup-form" onSubmit={save} noValidate>
      <label>ชื่อนิติบุคคล (ตามที่จดทะเบียน)<input value={f.legalName} onChange={set('legalName')} required />{fe('legalName')}</label>
      <div className="setup-row">
        <label>เลขประจำตัวผู้เสียภาษี 13 หลัก<input value={f.taxId} onChange={set('taxId')} inputMode="numeric" placeholder="ยังไม่มีก็เว้นไว้ได้" />{fe('taxId')}</label>
        <label>รหัสสาขา<input value={f.branchCode} onChange={set('branchCode')} inputMode="numeric" /><small className="field-hint">สำนักงานใหญ่ = 00000</small>{fe('branchCode')}</label>
      </div>
      <label>ที่อยู่ (พิมพ์บนใบกำกับภาษี)<textarea value={f.address} onChange={set('address')} rows={2} required />{fe('address')}</label>
      <div className="setup-row">
        <label>โทรศัพท์<input value={f.phone} onChange={set('phone')} inputMode="tel" /></label>
        <label>อีเมลบริษัท<input type="email" value={f.email} onChange={set('email')} />{fe('email')}</label>
      </div>
      <label>โลโก้ (PNG/JPG/SVG ไม่เกิน 300 KB)
        <input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => pickLogo(e.target.files?.[0])} />
        {f.logo && <img src={f.logo} alt="โลโก้บริษัท" className="setup-logo" />}{fe('logo')}
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="btn-primary" type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกและไปขั้นถัดไป'}</button></div>
    </form>
  );
}

/** 2 — who approves. Only purchasing has a separation-of-duties switch today; without purchasing there is nothing to choose. */
function ApprovalsStep({ onSaved }: { onSaved: () => Promise<void> }) {
  const { installed } = useRegistry();
  const [mode, setMode] = useState<'alone' | 'separate'>('separate');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!installed('purchasing')) return;
    api<{ creatorCannotApprove: boolean }>('purchasing', '/settings').then((s) => setMode(s.creatorCannotApprove ? 'separate' : 'alone')).catch(() => undefined);
  }, [installed]);
  if (!installed('purchasing')) {
    return (
      <div className="setup-form">
        <p>แพ็กเกจของบริษัทยังไม่มีระบบจัดซื้อ จึงยังไม่ต้องตั้งผู้อนุมัติ · ใบลาและใบเบิกจะส่งให้หัวหน้าที่ตั้งไว้ในทะเบียนพนักงานอนุมัติ</p>
        <div className="form-actions"><button className="btn-primary" type="button" onClick={() => void onSaved()}>ไปขั้นถัดไป</button></div>
      </div>
    );
  }
  const save = async () => {
    setBusy(true); setError('');
    try {
      await api('purchasing', '/settings', {
        method: 'PUT',
        body: mode === 'alone' ? { creatorCannotApprove: false, standardApprovalLimit: 0 } : { creatorCannotApprove: true, standardApprovalLimit: 50000 },
      });
      await onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ'); } finally { setBusy(false); }
  };
  return (
    <div className="setup-form">
      <fieldset className="setup-choices">
        <legend>ใครเป็นคนอนุมัติใบสั่งซื้อ</legend>
        <label className={`setup-choice${mode === 'alone' ? ' is-on' : ''}`}>
          <input type="radio" name="mode" checked={mode === 'alone'} onChange={() => setMode('alone')} />
          <b>ทำงานคนเดียว / เจ้าของทำเองทั้งหมด</b>
          <small>คนสร้างใบสั่งซื้ออนุมัติเองได้ ไม่มีวงเงินแยกขั้น เหมาะกับกิจการที่เจ้าของซื้อเอง</small>
        </label>
        <label className={`setup-choice${mode === 'separate' ? ' is-on' : ''}`}>
          <input type="radio" name="mode" checked={mode === 'separate'} onChange={() => setMode('separate')} />
          <b>มีคนสร้าง และมีผู้อนุมัติแยก (แนะนำเมื่อมีพนักงานจัดซื้อ)</b>
          <small>คนสร้างอนุมัติใบของตัวเองไม่ได้ · เกิน 50,000 บาท ต้องให้ผู้บริหารอนุมัติ · ผู้สอบบัญชีตรวจได้ว่าแยกหน้าที่</small>
        </label>
      </fieldset>
      <p className="field-hint">เปลี่ยนได้ทุกเมื่อที่ จัดซื้อ → ตั้งค่าการอนุมัติ</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="btn-primary" type="button" disabled={busy} onClick={() => void save()}>{busy ? 'กำลังบันทึก…' : 'บันทึกและไปขั้นถัดไป'}</button></div>
    </div>
  );
}

/** 3 — invite colleagues; each gets an e-mail to set their own password. */
function TeamStep({ onDone }: { onDone: () => Promise<void> }) {
  const { catalog } = useRegistry();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [f, setF] = useState({ name: '', email: '', template: 'staff' });
  const [invited, setInvited] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const modules = catalog.map((m) => m.id);
  useEffect(() => {
    if (!modules.length) return;
    api<Template[]>('identity', '/role-templates', { query: { modules: modules.join(',') } })
      .then((ts) => setTemplates(TEAM_TEMPLATES.map((id) => ts.find((x) => x.id === id)).filter((x): x is Template => !!x)))
      .catch(() => setTemplates([]));
  }, [modules.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api<{ message: string }>('identity', '/users/invite', { method: 'POST', body: { ...f, modules } });
      setInvited((x) => [...x, `${f.name} (${f.email})`]);
      toast({ title: r.message, tone: 'ok' });
      setF({ name: '', email: '', template: f.template });
    } catch (err) { setError(err instanceof Error ? err.message : 'ส่งคำเชิญไม่สำเร็จ'); } finally { setBusy(false); }
  };
  const chosen = templates.find((t) => t.id === f.template);
  return (
    <div className="setup-form">
      <form onSubmit={invite} className="setup-invite">
        <div className="setup-row">
          <label>ชื่อ<input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} required /></label>
          <label>อีเมล<input type="email" value={f.email} onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))} required /></label>
        </div>
        <label>หน้าที่
          <select value={f.template} onChange={(e) => setF((x) => ({ ...x, template: e.target.value }))}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {chosen && <small className="field-hint">{chosen.description}</small>}
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions"><button className="btn" type="submit" disabled={busy || !f.name || !f.email}>{busy ? 'กำลังส่ง…' : 'ส่งอีเมลเชิญ'}</button></div>
      </form>
      {invited.length > 0 && <ul className="setup-invited">{invited.map((x) => <li key={x}><Check size={14} aria-hidden /> เชิญแล้ว: {x}</li>)}</ul>}
      <div className="form-actions"><button className="btn-primary" type="button" onClick={() => void onDone()}>{invited.length ? 'เสร็จแล้ว ไปขั้นถัดไป' : 'ยังไม่ชวนตอนนี้ ไปขั้นถัดไป'}</button></div>
    </div>
  );
}

/** 4 — starting data: the CSV imports of items and partners (sample data can be cleared from the bar on top). */
function DataStep({ onDone }: { onDone: () => Promise<void> }) {
  const [hasSample, setHasSample] = useState(false);
  useEffect(() => { api<{ starter: unknown }>('identity', '/starter').then((r) => setHasSample(!!r.starter)).catch(() => undefined); }, []);
  return (
    <div className="setup-form">
      {hasSample && (
        <p className="setup-note">ตอนนี้ในระบบเป็น<b>ข้อมูลตัวอย่าง</b> · ลองใช้ให้คล่องก่อน แล้วกด “ล้างข้อมูลตัวอย่าง — เริ่มใช้จริง” ที่แถบด้านบน ก่อนนำเข้าข้อมูลจริง (การล้างจะลบทุกอย่างที่บันทึกไว้)</p>
      )}
      <ul className="setup-links">
        <li><Link href={screenHref('master-data', 'items')}>สินค้าและวัตถุดิบ</Link> — กด “นำเข้า CSV” แล้วดาวน์โหลดแบบฟอร์ม กรอกจาก Excel เดิม ระบบบอกแถวที่ผิดก่อนบันทึก</li>
        <li><Link href={screenHref('master-data', 'partners')}>ลูกค้าและผู้ขาย</Link> — นำเข้าแบบเดียวกัน (เลขผู้เสียภาษีตรวจให้)</li>
      </ul>
      <div className="form-actions"><button className="btn-primary" type="button" onClick={() => void onDone()}>ไปขั้นถัดไป</button></div>
    </div>
  );
}

/** 5 — summary and done. */
function StartStep({ ob, onFinish }: { ob: Onboarding; onFinish: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const left = ob.steps.filter((s) => s.id !== 'start' && !s.done);
  return (
    <div className="setup-form">
      <ul className="setup-summary">
        {ob.steps.filter((s) => s.id !== 'start').map((s) => <li key={s.id} className={s.done ? 'is-done' : ''}>{s.done ? <Check size={14} aria-hidden /> : '·'} {s.title}{s.done ? '' : ' (ยังไม่ได้ทำ — ทำทีหลังได้)'}</li>)}
      </ul>
      <p>เรื่องแรกที่ควรลอง: ดูการ์ด “ต้องตัดสินใจวันนี้” บนหน้าแรก แล้วกดอนุมัติหรือรับงานจากตรงนั้น · กด ⌘K เพื่อค้นหาหรือสั่งงานได้ทุกหน้า</p>
      {left.length > 0 && <p className="field-hint">ขั้นที่ข้ามไว้ กลับมาทำได้ที่ “ตั้งค่าเริ่มต้น” บนหน้าแรก</p>}
      <div className="form-actions"><button className="btn-primary" type="button" disabled={busy} onClick={() => { setBusy(true); void onFinish().finally(() => setBusy(false)); }}>เริ่มใช้งาน</button></div>
    </div>
  );
}
