'use client';

import { useEffect, useRef, useState } from 'react';
import { hasPerm, type ModuleUi, type Widget } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { useRegistry } from '@/lib/registry';
import { loadSession } from '@/lib/session';
import { ModuleIcon } from '@/components/Icon';
import { Bars, Feed, Kpi, Pipeline, Trend, WidgetLink } from '@/components/widgets/Basic';
import { Floor3D } from '@/components/widgets/Floor3D';
import { useReveal } from '@/lib/motion';

type Data = Record<string, unknown>;
const ORDER: Widget['kind'][] = ['floor3d', 'feed', 'kpi', 'pipeline', 'trend', 'bars'];
const REFRESH_MS = 30_000;

/** "Factory Pulse": every installed module contributes its own widgets. */
export default function Home() {
  const { modules, loading } = useRegistry();
  const session = loadSession();
  const perms = session?.permissions ?? [];
  const [data, setData] = useState<Record<string, Data>>({});
  const [updated, setUpdated] = useState<Date | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  const widgets = modules
    .flatMap((m) => (m.widgets ?? []).filter((w) => hasPerm(perms, w.perm)).map((w) => ({ m, w })))
    .sort((a, b) => ORDER.indexOf(a.w.kind) - ORDER.indexOf(b.w.kind));
  const sources = [...new Set(widgets.map(({ m, w }) => `${m.module}${w.endpoint}`))];

  useEffect(() => {
    if (!sources.length) return;
    let stop = false;
    const load = async () => {
      const entries = await Promise.all(sources.map(async (src) => {
        const [mod, ...rest] = src.split('/');
        try { return [src, await api<Data>(mod, `/${rest.join('/')}`)] as const; } catch { return [src, null] as const; }
      }));
      if (stop) return;
      setData(Object.fromEntries(entries.filter(([, d]) => d)) as Record<string, Data>);
      setUpdated(new Date());
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { stop = true; clearInterval(t); };
  }, [sources.join(',')]);

  useReveal(grid, '.widget', [loading, widgets.length]);

  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'สวัสดีตอนเช้า' : h < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น'; })();
  return (
    <div className="screen home">
      <header className="pulse-head">
        <div>
          <h1>ภาพรวมโรงงาน</h1>
          <p>{greeting} {session?.user.name}{updated ? `, ข้อมูล ณ ${updated.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
        </div>
        <span className="live"><i />อัปเดตอัตโนมัติทุก 30 วินาที</span>
      </header>
      {loading && <p className="muted">กำลังโหลด…</p>}
      {!loading && !widgets.length && <p className="muted">ยังไม่มีข้อมูลภาพรวมสำหรับบัญชีนี้ เลือกงานจากเมนูด้านซ้าย</p>}
      <div className="widgets" ref={grid}>
        {widgets.map(({ m, w }) => <WidgetCard key={`${m.module}.${w.id}`} m={m} w={w} data={data[`${m.module}${w.endpoint}`]} />)}
      </div>
    </div>
  );
}

function WidgetCard({ m, w, data }: { m: ModuleUi; w: Widget; data?: Data }) {
  return (
    <section className={`widget ${w.size ?? 'sm'}`} aria-label={w.title}>
      <div className="widget-head">
        <h2><ModuleIcon name={m.icon} glyph={m.glyph} size={16} />{w.title}</h2>
        <WidgetLink module={m.module} screen={w.href} />
      </div>
      {!data ? <p className="muted">กำลังโหลด…</p>
        : w.kind === 'kpi' ? <Kpi w={w} data={data} />
        : w.kind === 'bars' ? <Bars w={w} data={data} />
        : w.kind === 'trend' ? <Trend w={w} data={data} />
        : w.kind === 'pipeline' ? <Pipeline w={w} data={data} module={m.module} />
        : w.kind === 'feed' ? <Feed w={w} data={data} />
        : <Floor3D w={w} data={data} module={m.module} />}
    </section>
  );
}
