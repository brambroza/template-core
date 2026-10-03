'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ChevronDown, Loader2, SlidersHorizontal, X } from 'lucide-react';
import { groupByArea, hasPerm, type AreaId, type ModuleUi, type Widget } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { useRegistry } from '@/lib/registry';
import { loadSession } from '@/lib/session';
import { readPref, writePref } from '@/lib/prefs';
import { ModuleIcon } from '@/components/Icon';
import { AiSpark, isAiModule } from '@/components/Brand';
import { Bars, Feed, Kpi, Pipeline, Trend, WidgetLink } from '@/components/widgets/Basic';
import { Floor3D } from '@/components/widgets/Floor3D';
import { useReveal } from '@/lib/motion';
import { safeHref } from '@/lib/href';

type Data = Record<string, unknown>;
type Entry = { m: ModuleUi; w: Widget; key: string; src: string };

/** Inside an area: numbers first, then work in flight, then rankings, then history. */
const ORDER: Widget['kind'][] = ['kpi', 'pipeline', 'bars', 'trend', 'feed', 'floor3d'];
/** Live kinds open the page as "ตอนนี้" (3D floor when maintenance is installed + what the bots/assets just reported). */
const LIVE: Widget['kind'][] = ['floor3d', 'feed'];
const REFRESH_MS = 30_000;
/** A big installation hides the 6-month trends by default so the pulse stays scannable; each user can turn them on. */
const QUIET_TRENDS_OVER = 12;

interface HomePrefs { shown: string[]; hidden: string[]; collapsed: AreaId[] }
const NO_PREFS: HomePrefs = { shown: [], hidden: [], collapsed: [] };

/** "ภาพรวมวันนี้" (works for offices and factories alike): every installed module contributes widgets, grouped by business area. */
export default function Home() {
  const { modules, loading } = useRegistry();
  const session = loadSession();
  const perms = session?.permissions ?? [];
  const [prefs, setPrefs] = useState<HomePrefs>(NO_PREFS);
  const [picking, setPicking] = useState(false);
  const [briefing, setBriefing] = useState<BriefingState>(null);
  useEffect(() => setPrefs({ ...NO_PREFS, ...readPref<Partial<HomePrefs>>('home', {}) }), []);
  const savePrefs = (p: HomePrefs) => { setPrefs(p); writePref('home', p); };

  const all: Entry[] = useMemo(() => modules
    .flatMap((m) => (m.widgets ?? []).filter((w) => hasPerm(perms, w.perm)).map((w) => ({ m, w, key: `${m.module}.${w.id}`, src: `${m.module}${w.endpoint}` })))
    .sort((a, b) => ORDER.indexOf(a.w.kind) - ORDER.indexOf(b.w.kind)), [modules, perms.join()]);
  const quietTrends = all.length > QUIET_TRENDS_OVER;
  const byDefault = (e: Entry) => !(quietTrends && e.w.kind === 'trend');
  const isShown = (e: Entry) => (prefs.hidden.includes(e.key) ? false : prefs.shown.includes(e.key) ? true : byDefault(e));
  const shown = all.filter(isShown);
  const live = shown.filter((e) => LIVE.includes(e.w.kind)).sort((a, b) => LIVE.indexOf(a.w.kind) - LIVE.indexOf(b.w.kind));
  const areas = groupByArea(shown.filter((e) => !LIVE.includes(e.w.kind)), (e) => e.m);

  // data: only for sections that have scrolled near the viewport; everything visible refreshes every 30 s
  const [data, setData] = useState<Record<string, Data>>({});
  const [wanted, setWanted] = useState<string[]>([]);
  const [updated, setUpdated] = useState<Date | null>(null);
  const loaded = useRef(new Set<string>());
  const want = useCallback((srcs: string[]) => setWanted((w) => {
    const add = srcs.filter((s) => !w.includes(s));
    return add.length ? [...w, ...add] : w;
  }), []);
  useEffect(() => {
    if (!wanted.length) return;
    let stop = false;
    const load = async (srcs: string[]) => {
      const entries = await Promise.all(srcs.map(async (src) => {
        const [mod, ...rest] = src.split('/');
        try { return [src, await api<Data>(mod, `/${rest.join('/')}`)] as const; } catch { return [src, null] as const; }
      }));
      if (stop) return;
      srcs.forEach((s) => loaded.current.add(s));
      setData((d) => ({ ...d, ...(Object.fromEntries(entries.filter(([, v]) => v)) as Record<string, Data>) }));
      setUpdated(new Date());
    };
    load(wanted.filter((s) => !loaded.current.has(s)));
    const t = setInterval(() => load(wanted), REFRESH_MS);
    return () => { stop = true; clearInterval(t); };
  }, [wanted.join(',')]);

  const toggleArea = (a: AreaId) => savePrefs({ ...prefs, collapsed: prefs.collapsed.includes(a) ? prefs.collapsed.filter((x) => x !== a) : [...prefs.collapsed, a] });

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'สวัสดีตอนเช้า' : h < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น'; })();
  return (
    <div className="screen home">
      <header className="pulse-head">
        <div>
          <h1>ภาพรวมวันนี้</h1>
          {session?.tenant?.name && <p className="pulse-company" style={{ fontWeight: 600, color: 'var(--ink)' }}>{session.tenant.name}</p>}
          <p>{greeting} {session?.user.name}{updated ? ` · ข้อมูล ณ ${updated.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.` : ''}</p>
        </div>
        <div className="pulse-tools">
          <span className="live"><i />อัปเดตทุก 30 วินาที</span>
          {all.length > 0 && <BriefingButton onResult={setBriefing} busy={briefing === 'loading'} />}
          {all.length > 0 && (
            <button type="button" className="btn" onClick={() => setPicking(true)}>
              <SlidersHorizontal size={16} aria-hidden />เลือกการ์ดที่แสดง
            </button>
          )}
        </div>
      </header>
      {briefing && briefing !== 'loading' && <BriefingCard b={briefing} onClose={() => setBriefing(null)} />}
      {loading && <p className="muted">กำลังโหลด…</p>}
      {!loading && !all.length && <p className="muted">ยังไม่มีข้อมูลภาพรวมสำหรับบัญชีนี้ เลือกงานจากเมนูด้านซ้าย</p>}
      {!loading && all.length > 0 && !shown.length && <p className="muted">ซ่อนการ์ดไว้ทั้งหมด — กด “เลือกการ์ดที่แสดง” เพื่อเลือกใหม่</p>}

      {live.length > 0 && (
        <PulseSection id="live" label="ตอนนี้" entries={live} data={data} want={want} className="pulse-live" />
      )}
      {areas.map((g) => (
        <PulseSection key={g.area} id={g.area} label={g.label} entries={g.items} data={data} want={want}
          collapsed={prefs.collapsed.includes(g.area)} onToggle={() => toggleArea(g.area)} />
      ))}

      {picking && <WidgetPicker all={all} isShown={isShown} byDefault={byDefault} prefs={prefs} onSave={savePrefs} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** One area of the dashboard. Its cards render at once (stable layout); their data loads when the section nears the viewport. */
function PulseSection({ id, label, entries, data, want, collapsed, onToggle, className }: {
  id: string; label: string; entries: Entry[]; data: Record<string, Data>; want: (srcs: string[]) => void;
  collapsed?: boolean; onToggle?: () => void; className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const srcs = [...new Set(entries.map((e) => e.src))].join(',');
  useEffect(() => {
    if (collapsed || !srcs) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { want(srcs.split(',')); return; }
    const io = new IntersectionObserver((xs) => { if (xs.some((x) => x.isIntersecting)) { want(srcs.split(',')); io.disconnect(); } }, { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [srcs, collapsed, want]);
  useReveal(grid, '.widget', [collapsed, entries.length]);
  const headingId = `pulse-${id}`;
  // one rhythm for every area: a row of KPI cards that share the width, work-in-flight boards full width,
  // rankings and trends in pairs (an odd last one takes the full row). The live section keeps declared sizes.
  const live = className === 'pulse-live';
  const kpis = live ? [] : entries.filter((e) => e.w.kind === 'kpi');
  const rest = live ? entries : entries.filter((e) => e.w.kind !== 'kpi');
  const halves = rest.filter((e) => e.w.kind === 'bars' || e.w.kind === 'trend');
  const sizeOf = (w: Widget, i: number): Widget['size'] => {
    if (live) return w.size;
    if (w.kind === 'pipeline') return 'lg';
    if (w.kind === 'bars' || w.kind === 'trend') return halves.length % 2 === 1 && rest[i] === halves.at(-1) ? 'lg' : 'md';
    return w.size;
  };
  return (
    <section ref={ref} className={`pulse-section${className ? ` ${className}` : ''}`} aria-labelledby={headingId}>
      <h2 className="pulse-title" id={headingId}>
        {onToggle ? (
          <button type="button" aria-expanded={!collapsed} onClick={onToggle}>
            <ChevronDown size={16} aria-hidden className="chev" />{label}
            {collapsed && <span className="muted"> · ซ่อน {entries.length} การ์ด</span>}
          </button>
        ) : label}
      </h2>
      {!collapsed && (
        <div ref={grid}>
          {kpis.length > 0 && (
            <div className="kpi-row">
              {kpis.map(({ m, w, key, src }) => <WidgetCard key={key} m={m} w={w} data={data[src]} />)}
            </div>
          )}
          {rest.length > 0 && (
            <div className="widgets">
              {rest.map(({ m, w, key, src }, i) => <WidgetCard key={key} m={m} w={w} data={data[src]} size={sizeOf(w, i)} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function WidgetCard({ m, w, data, size }: { m: ModuleUi; w: Widget; data?: Data; size?: Widget['size'] }) {
  return (
    <section className={`widget ${size ?? w.size ?? 'sm'} kind-${w.kind}${isAiModule(m.module) ? ' is-ai' : ''}`} aria-label={w.title}>
      <div className="widget-head">
        <h3><ModuleIcon name={m.icon} glyph={m.glyph} size={16} />{w.title}</h3>
        <WidgetLink module={m.module} screen={w.href} />
      </div>
      {!data ? <div className="skeleton" aria-label="กำลังโหลด" />
        : w.kind === 'kpi' ? <Kpi w={w} data={data} />
        : w.kind === 'bars' ? <Bars w={w} data={data} />
        : w.kind === 'trend' ? <Trend w={w} data={data} />
        : w.kind === 'pipeline' ? <Pipeline w={w} data={data} module={m.module} />
        : w.kind === 'feed' ? <Feed w={w} data={data} />
        : <Floor3D w={w} data={data} module={m.module} />}
    </section>
  );
}

/** "เลือกการ์ดที่แสดง": per-user choice of cards, grouped by area; only differences from the default are saved. */
function WidgetPicker({ all, isShown, byDefault, prefs, onSave, onClose }: {
  all: Entry[]; isShown: (e: Entry) => boolean; byDefault: (e: Entry) => boolean; prefs: HomePrefs; onSave: (p: HomePrefs) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [on, setOn] = useState(() => new Set(all.filter(isShown).map((e) => e.key)));
  useEffect(() => { dialog.current?.showModal?.(); }, []);
  const groups = groupByArea(all, (e) => e.m);
  const set = (keys: string[], value: boolean) => setOn((s) => { const n = new Set(s); keys.forEach((k) => (value ? n.add(k) : n.delete(k))); return n; });
  const save = () => {
    onSave({
      ...prefs,
      shown: all.filter((e) => on.has(e.key) && !byDefault(e)).map((e) => e.key),
      hidden: all.filter((e) => !on.has(e.key) && byDefault(e)).map((e) => e.key),
    });
    onClose();
  };
  return (
    <dialog ref={dialog} className="dialog dialog-wide" onClose={onClose} aria-labelledby="picker-title">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <h2 id="picker-title">เลือกการ์ดที่แสดง</h2>
        <p className="confirm-text">เลือกเฉพาะสิ่งที่คุณดูทุกวัน การตั้งค่านี้จำไว้ในเครื่องนี้สำหรับบัญชีของคุณ</p>
        <div className="picker">
          {groups.map((g) => {
            const keys = g.items.map((e) => e.key);
            const allOn = keys.every((k) => on.has(k));
            return (
              <fieldset key={g.area} className="picker-group">
                <legend>
                  <label className="check"><input type="checkbox" checked={allOn} onChange={() => set(keys, !allOn)} />{g.label}</label>
                </legend>
                {g.items.map((e) => (
                  <label key={e.key} className="check">
                    <input type="checkbox" checked={on.has(e.key)} onChange={() => set([e.key], !on.has(e.key))} />
                    <span>{e.w.title}{e.w.title !== e.m.label && <span className="muted"> · {e.m.label}</span>}</span>
                  </label>
                ))}
              </fieldset>
            );
          })}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn-ghost" onClick={() => setOn(new Set(all.filter(byDefault).map((e) => e.key)))}>ค่าเริ่มต้น</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn" onClick={onClose}>ยกเลิก</button>
          <button type="submit" className="btn-primary">บันทึก</button>
        </div>
      </form>
    </dialog>
  );
}

/* ---------------- "สรุปให้หน่อย": AI daily briefing (POST /assist/briefing, cached 10 min per user on the server) ---------------- */

interface Briefing { bullets: string[]; actions: { label: string; href: string }[]; generatedAt?: string; cached?: boolean; offline?: boolean; reply?: string; error?: string }
type BriefingState = Briefing | 'loading' | null;

function BriefingButton({ onResult, busy }: { onResult: (b: BriefingState) => void; busy: boolean }) {
  const run = async () => {
    onResult('loading');
    try {
      const token = loadSession()?.token;
      const res = await fetch('/assist/briefing', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? 'สรุปไม่ได้ในตอนนี้');
      onResult(data as Briefing);
    } catch (e) {
      onResult({ bullets: [], actions: [], error: e instanceof Error ? e.message : 'สรุปไม่ได้ในตอนนี้' });
    }
  };
  return (
    <button type="button" className="btn-ai briefing-btn" onClick={run} disabled={busy}>
      {busy ? <Loader2 size={16} className="spin" aria-hidden /> : <AiSpark size={16} />}
      {busy ? 'AI กำลังดูข้อมูล…' : 'สรุปให้หน่อย'}
    </button>
  );
}

function BriefingCard({ b, onClose }: { b: Briefing; onClose: () => void }) {
  const router = useRouter();
  const problem = b.error ?? (b.offline ? b.reply : undefined);
  const at = b.generatedAt ? new Date(b.generatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <section className={`briefing${problem ? ' is-error' : ''}`} aria-label="สรุปวันนี้โดย AI" aria-live="polite">
      <header>
        <b><AiSpark size={18} /> สรุปวันนี้{at ? ` · ณ ${at} น.` : ''} <span className="ai-tag">AI</span></b>
        <button type="button" className="btn-ghost" onClick={onClose} aria-label="ปิดสรุป"><X size={16} aria-hidden /></button>
      </header>
      {problem ? <p>{problem}</p> : (
        <>
          <ul>{b.bullets.map((t, i) => <li key={i}>{t}</li>)}</ul>
          {b.actions.length > 0 && (
            <div className="bubble-actions">
              {b.actions.filter((a) => safeHref(a.href)).map((a) => (
                <button key={a.href} type="button" className="btn" onClick={() => router.push(a.href)}>{a.label}<ArrowRight size={14} aria-hidden /></button>
              ))}
            </div>
          )}
          <p className="muted briefing-foot">AI อ่านข้อมูลตามสิทธิ์ของคุณเท่านั้น ไม่บันทึกอะไรแทนคุณ{b.cached ? ' · สรุปเดิม (อัปเดตได้ทุก 10 นาที)' : ''}</p>
        </>
      )}
    </section>
  );
}
