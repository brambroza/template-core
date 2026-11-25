'use client';
/**
 * Home "ต้องตัดสินใจวันนี้": what waits on the signed-in user across every installed module (POs, claims, leave, bookings,
 * repairs…), most pressing first, with the buttons to decide right there. Modules declare it as `todo` in their ui.ts.
 */
import Link from 'next/link';
import { CheckCircle2, ChevronDown, Clock, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNumberFormat } from '@/lib/number-format';
import { buildTodo, formatValue, listRows, rowLinkScreen, todoActions, todoSources, type ListScreen, type ModuleUi, type TodoItem, type TodoSpec } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { screenHref } from '@/lib/nav';
import { ActionButton } from './ActionButton';
import { ModuleIcon } from './Icon';

const REFRESH_MS = 30_000;
/** shown before "ดูเพิ่ม" — a short list is read, a long one is skipped */
const FIRST = 5;

export function DecisionInbox({ modules, perms }: { modules: ModuleUi[]; perms: string[] }) {
  const sources = useMemo(() => todoSources(modules, perms), [modules, perms.join()]);
  const [items, setItems] = useState<TodoItem[] | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);

  const load = useCallback(async () => {
    const groups = await Promise.all(sources.map(async ({ module, spec, screen }) => {
      const qs = new URLSearchParams(spec.query ?? {}).toString();
      try {
        const res = await api<unknown>(module.module, `${screen.endpoint}${qs ? `?${qs}` : ''}`);
        return { module: module.module, spec, rows: listRows(screen, res) };
      } catch { return { module: module.module, spec, rows: [] }; } // one module down must not hide the others
    }));
    setItems(buildTodo(groups));
  }, [sources]);

  useEffect(() => {
    if (!sources.length) return;
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load, sources.length]);

  if (!sources.length) return null;
  const open = (items ?? []).filter((i) => !done.has(i.key));
  const shown = all ? open : open.slice(0, FIRST);
  const counts = countByGroup(open);
  const pressing = open.filter((i) => i.overdue || i.urgent).length;

  // decided: fade the card out at once, then re-read so the list matches the server
  const decided = (key: string) => { setDone((d) => new Set(d).add(key)); setTimeout(load, 900); };

  return (
    <section className="decide" id="decide" aria-labelledby="decide-h">
      <header className="decide-head">
        <h2 id="decide-h">ต้องตัดสินใจวันนี้{items && open.length > 0 && <span className="decide-count">{open.length}</span>}</h2>
        {pressing > 0 && <span className="decide-alert">{pressing} เรื่องเร่งด่วน/เกินกำหนด</span>}
        <nav className="decide-groups" aria-label="ประเภทงานที่รอ">
          {counts.map((g) => (
            <Link key={g.key} className="chip-btn" href={`${screenHref(g.module, g.spec.screen)}${g.spec.query ? `?${new URLSearchParams(g.spec.query)}` : ''}`}>
              {g.spec.label} <b>{g.count}</b>
            </Link>
          ))}
        </nav>
      </header>

      {!items && <p className="decide-empty"><Loader2 size={16} className="spin" aria-hidden />กำลังดูว่ามีอะไรรอคุณอยู่…</p>}
      {items && !open.length && (
        <p className="decide-empty is-clear"><CheckCircle2 size={18} aria-hidden />ไม่มีเรื่องรอคุณตัดสินใจ — เคลียร์หมดแล้ว</p>
      )}
      {shown.length > 0 && (
        <ol className="decide-list">
          {shown.map((i) => <DecisionCard key={i.key} item={i} modules={modules} perms={perms} onDone={() => decided(i.key)} />)}
        </ol>
      )}
      {open.length > FIRST && (
        <button type="button" className="decide-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'ย่อ' : `ดูอีก ${open.length - FIRST} เรื่อง`}<ChevronDown size={16} aria-hidden style={{ transform: all ? 'rotate(180deg)' : undefined }} />
        </button>
      )}
    </section>
  );
}

function countByGroup(items: TodoItem[]) {
  const out = new Map<string, { key: string; module: string; spec: TodoSpec; count: number }>();
  for (const i of items) {
    const k = `${i.module}.${i.spec.id}`;
    const g = out.get(k) ?? { key: k, module: i.module, spec: i.spec, count: 0 };
    g.count++;
    out.set(k, g);
  }
  return [...out.values()];
}

function DecisionCard({ item, modules, perms, onDone }: { item: TodoItem; modules: ModuleUi[]; perms: string[]; onDone: () => void }) {
  useNumberFormat();
  const m = modules.find((x) => x.module === item.module)!;
  const screen = m.screens[item.spec.screen] as ListScreen;
  const actions = todoActions(item, screen, perms);
  const link = screen.rowLink ? screenHref(item.module, rowLinkScreen(screen.rowLink, item.row), item.row[screen.rowLink.idFrom ?? 'id']) : undefined;
  const tone = item.overdue ? 'is-overdue' : item.urgent ? 'is-urgent' : '';
  return (
    <li className={`decide-card ${tone}`}>
      <div className="decide-main">
        <span className="decide-kind"><ModuleIcon name={m.icon} glyph={m.glyph} size={14} />{item.spec.label}</span>
        {link ? <Link className="decide-title" href={link}>{item.title || '—'}</Link> : <span className="decide-title">{item.title || '—'}</span>}
        {item.subtitle && <span className="decide-sub">{item.subtitle}</span>}
      </div>
      <div className="decide-meta">
        {item.amount !== undefined && <span className="decide-amount">{formatValue(item.amount, 'money')} ฿</span>}
        {item.dueText && <span className={`decide-due${item.overdue ? ' is-late' : ''}`}>{item.dueText}</span>}
        {item.waiting && <span className="decide-wait"><Clock size={12} aria-hidden />{item.waiting}</span>}
      </div>
      <div className="decide-actions">
        {actions.length
          ? actions.map((a) => <ActionButton key={a.id} action={a} module={item.module} params={item.row} onDone={onDone} />)
          : link && <Link className="btn" href={link}>เปิดดู</Link>}
      </div>
    </li>
  );
}
