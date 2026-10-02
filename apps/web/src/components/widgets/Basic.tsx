'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef } from 'react';
import { formatValue, get, type BarsWidget, type FeedWidget, type KpiWidget, type PipelineWidget, type TrendWidget } from '@erp/ui-schema';
import { countUp, growX, gsap, reducedMotion } from '@/lib/motion';

const compact = new Intl.NumberFormat('th-TH', { notation: 'compact', maximumFractionDigits: 1 });
/** Big numbers on cards: money as ฿ + compact Thai units (1.4 แสน), counts as integers. */
const kpiText = (n: number, format?: string) => (format === 'money' ? `฿${Math.abs(n) >= 10000 ? compact.format(n) : formatValue(Math.round(n), 'qty')}` : formatValue(Math.round(n), 'qty'));
const shortQty = (n: number) => formatValue(Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10, 'qty');
import { screenHref } from '@/lib/nav';

type Data = Record<string, unknown>;

export function Kpi({ w, data }: { w: KpiWidget; data: Data }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
      const item = w.items[Number(el.dataset.count)];
      countUp(el, Number(get(data, item.key) ?? 0), (n) => kpiText(n, item.format));
    });
  }, [data]);
  return (
    <div className="kpis" ref={ref}>
      {w.items.map((it, i) => {
        const v = Number(get(data, it.key) ?? 0);
        return (
          <div key={it.key} className={`kpi tone-${it.tone ?? 'neutral'}${v === 0 ? ' is-zero' : ''}${it.format === 'money' ? ' is-money' : ''}`}>
            <b data-count={i} title={formatValue(v, it.format)}>{kpiText(v, it.format)}</b>
            <span>{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Bars({ w, data }: { w: BarsWidget; data: Data }) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = ((get(data, w.rows) as Data[]) ?? []).slice(0, 10);
  const max = Math.max(1, ...rows.map((r) => Math.max(Number(get(r, w.value) ?? 0), Number(w.threshold ? get(r, w.threshold) ?? 0 : 0))));
  useLayoutEffect(() => { if (ref.current) growX(ref.current.querySelectorAll('.bar-fill')); }, [data]);
  if (!rows.length) return <p className="muted">ยังไม่มีข้อมูลสต็อก</p>;
  return (
    <div className="bars" ref={ref}>
      {rows.map((r, i) => {
        const v = Math.max(0, Number(get(r, w.value) ?? 0));
        const min = w.threshold ? (get(r, w.threshold) as number | null) : null;
        const low = min != null && v < Number(min);
        return (
          <div key={i} className="bar-row" title={min != null ? `ขั้นต่ำ ${formatValue(min, w.format)}` : undefined}>
            <span className="label">{String(get(r, w.label) ?? '')}</span>
            <span className="bar-track" role="img" aria-label={`${get(r, w.label)} คงเหลือ ${formatValue(v, w.format)}${min != null ? ` ขั้นต่ำ ${formatValue(min, w.format)}` : ''}`}>
              <span className={`bar-fill${low ? ' low' : ''}`} style={{ width: `${(v / max) * 100}%` }} />
              {min != null && <span className="bar-min" style={{ left: `${(Number(min) / max) * 100}%` }} />}
            </span>
            <span className="val">{w.format === 'money' ? formatValue(get(r, w.value), 'money') : shortQty(Number(get(r, w.value) ?? 0))}</span>
          </div>
        );
      })}
    </div>
  );
}

export function Trend({ w, data }: { w: TrendWidget; data: Data }) {
  const ref = useRef<SVGSVGElement>(null);
  const rows = (get(data, w.rows) as Data[]) ?? [];
  const W = 300, H = 110, pad = 6;
  const ys = rows.map((r) => Number(get(r, w.y) ?? 0));
  const max = Math.max(1, ...ys);
  const pts = ys.map((y, i) => [pad + (i * (W - pad * 2)) / Math.max(1, ys.length - 1), H - 18 - (y / max) * (H - 30)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = pts.length ? `${line} L${pts.at(-1)![0].toFixed(1)},${H - 18} L${pts[0][0].toFixed(1)},${H - 18} Z` : '';
  useLayoutEffect(() => {
    const path = ref.current?.querySelector<SVGPathElement>('.trend-line');
    if (!path || reducedMotion()) return;
    const len = path.getTotalLength();
    gsap.fromTo(path, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.1, ease: 'power2.out' });
    gsap.fromTo(ref.current!.querySelector('.trend-area'), { opacity: 0 }, { opacity: 1, duration: 0.9, delay: 0.3 });
  }, [data]);
  const last = ys.at(-1) ?? 0;
  return (
    <div className="trend">
      <div className="now">{w.format === 'money' ? `฿${formatValue(last, 'money')}` : formatValue(last, w.format)}<span className="muted" style={{ fontSize: '.8rem', fontWeight: 400, marginLeft: 8 }}>เดือนนี้</span></div>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${w.title}: ${rows.map((r) => `${formatValue(get(r, w.x), 'month')} ${formatValue(get(r, w.y), w.format)}`).join(', ')}`}>
        <path className="trend-area" d={area} fill="color-mix(in srgb, var(--accent) 22%, transparent)" />
        <path className="trend-line" d={line} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === pts.length - 1 ? 4 : 2.5} fill={i === pts.length - 1 ? 'var(--accent-deep)' : 'var(--ink)'} />)}
        {rows.map((r, i) => <text key={i} x={pts[i][0]} y={H - 2} textAnchor="middle" fontSize="9" fill="var(--ink-3)">{formatValue(get(r, w.x), 'month')}</text>)}
      </svg>
    </div>
  );
}

export function Pipeline({ w, data, module }: { w: PipelineWidget; data: Data; module: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = (get(data, w.rows) as Data[]) ?? [];
  useLayoutEffect(() => {
    if (!ref.current || reducedMotion()) return;
    gsap.fromTo(ref.current.querySelectorAll('.card'), { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: 'power3.out', stagger: 0.04, clearProps: 'transform,opacity' });
  }, [data]);
  return (
    <div className="pipeline" ref={ref} style={{ ['--n' as string]: w.stages.length }}>
      {w.stages.map((st) => {
        const items = rows.filter((r) => get(r, w.field) === st.value);
        return (
          <section key={st.value} className="lane" aria-label={`${st.label} ${items.length} รายการ`}>
            <div className="lane-head"><span>{st.label}</span><span>{items.length}</span></div>
            {items.length === 0 && <span className="muted" style={{ fontSize: '.8rem', padding: '0 2px' }}>ว่าง</span>}
            {items.slice(0, 6).map((r, i) => {
              const qty = Number(r.qty ?? 0), done = Number(r.completed_qty ?? 0);
              const body = (
                <>
                  <b>{String(get(r, w.title2) ?? '')}</b>
                  {w.subtitle && <span>{String(get(r, w.subtitle) ?? '')}{qty ? ` · ${formatValue(done, 'qty')}/${formatValue(qty, 'qty')}` : ''}</span>}
                  {qty > 0 && <div className="meter"><i style={{ width: `${Math.min(100, (done / qty) * 100)}%` }} /></div>}
                </>
              );
              return w.link
                ? <a key={i} className="card" href={screenHref(module, w.link.screen, get(r, w.link.idFrom ?? 'id'))}>{body}</a>
                : <div key={i} className="card">{body}</div>;
            })}
            {items.length > 6 && <span className="muted" style={{ fontSize: '.8rem' }}>และอีก {items.length - 6} รายการ</span>}
          </section>
        );
      })}
    </div>
  );
}

export function WidgetLink({ module, screen }: { module: string; screen?: string }) {
  if (!screen) return null;
  return <Link href={screenHref(module, screen)}>ดูทั้งหมด</Link>;
}

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'เมื่อสักครู่';
  if (s < 3600) return `${Math.floor(s / 60)} นาที`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชม.`;
  return `${Math.floor(s / 86400)} วัน`;
}

/** Live activity: newest first, a coloured dot per level, items slide in. */
export function Feed({ w, data }: { w: FeedWidget; data: Data }) {
  const ref = useRef<HTMLOListElement>(null);
  const rows = ((get(data, w.rows) ?? []) as Data[]).slice(0, 6);
  const first = rows[0] ? String(get(rows[0], 'id') ?? '') : '';
  useLayoutEffect(() => {
    if (!ref.current || reducedMotion()) return;
    gsap.fromTo(ref.current.querySelectorAll('li'), { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.4, stagger: 0.06, ease: 'power2.out', clearProps: 'opacity,transform' });
  }, [first]);
  if (!rows.length) return <p className="muted feed-empty">ยังเงียบอยู่ — เปิดสูตรอัตโนมัติแล้วบอทจะรายงานที่นี่</p>;
  return (
    <ol className="feed" ref={ref}>
      {rows.map((r, i) => {
        const link = w.link ? (get(r, w.link) as string | null) : null;
        const inner = (
          <>
            <span className={`lvl tone-${w.level ? String(get(r, w.level)) : 'info'}`} aria-hidden />
            <span className="feed-text"><b>{String(get(r, w.title2) ?? '')}</b>{w.body && <span>{String(get(r, w.body) ?? '')}</span>}</span>
            <time dateTime={String(get(r, w.time))}>{ago(String(get(r, w.time)))}</time>
          </>
        );
        return <li key={String(get(r, 'id') ?? i)}>{link ? <Link href={link}>{inner}</Link> : <div>{inner}</div>}</li>;
      })}
    </ol>
  );
}
