'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bot, CornerDownLeft, FileText, LayoutGrid, ListFilter, Loader2, Search, Sparkles, Zap } from 'lucide-react';
import {
  commandTarget, get, hasPerm, matchCommand, pickRecord,
  type CommandSpec, type ModuleUi, type SearchSpec,
} from '@erp/ui-schema';
import { api } from '@/lib/api';
import { gsap, reducedMotion } from '@/lib/motion';
import { screenHref } from '@/lib/nav';
import { useRegistry } from '@/lib/registry';
import { loadSession } from '@/lib/session';
import { ModuleIcon } from './Icon';
import { safeHref } from '@/lib/href';

/** Open the palette from anywhere: openCommandPalette('สต็อก ') or openCommandPalette('…', { ask: true }). */
export function openCommandPalette(text = '', opts: { ask?: boolean } = {}) {
  window.dispatchEvent(new CustomEvent('erp:command', { detail: { text, ask: !!opts.ask } }));
}

type Cmd = CommandSpec & { module: string };
interface Item { key: string; group: string; title: string; sub?: string; icon: React.ReactNode; run: () => void }
interface Chat { role: 'user' | 'assistant'; content: string; actions?: { label: string; href: string }[]; error?: boolean }

const withQuery = (href: string, q: Record<string, string>) => {
  const s = new URLSearchParams(q).toString();
  return s ? `${href}?${s}` : href;
};

/**
 * ⌘K — one box for everything: Thai commands ("แจ้งซ่อม PRESS-01 น้ำมันรั่ว"), jumping to screens,
 * finding records, and asking the AI assistant questions about live data.
 * Commands and searches come from each installed module's ui.ts, so new modules plug in by themselves.
 */
export function CommandPalette() {
  const router = useRouter();
  const { modules } = useRegistry();
  const perms = loadSession()?.permissions ?? [];
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [resolved, setResolved] = useState<{ key: string; record: Record<string, unknown> | null; loading: boolean } | null>(null);
  const [records, setRecords] = useState<Item[]>([]);
  const [chat, setChat] = useState<Chat[] | null>(null);
  const [thinking, setThinking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const commands: Cmd[] = useMemo(
    () => modules.flatMap((m) => (m.commands ?? []).filter((c) => hasPerm(perms, c.perm) && hasPerm(perms, m.screens[c.screen]?.perm)).map((c) => ({ ...c, module: m.module }))),
    [modules, perms.join()],
  );
  const searches = useMemo(
    () => modules.flatMap((m) => (m.search ?? []).filter((s) => hasPerm(perms, s.perm)).map((s) => ({ ...s, module: m.module }))),
    [modules, perms.join()],
  );
  const ui = (id: string) => modules.find((m) => m.module === id) as ModuleUi;

  const close = useCallback(() => setOpen(false), []);

  // open/close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setText(''); setChat(null); setOpen((o) => !o); }
    };
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ text?: string; ask?: boolean }>).detail ?? {};
      setText(d.text ?? '');
      setChat(null);
      setOpen(true);
      if (d.ask && d.text) setTimeout(() => ask(d.text!), 0);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('erp:command', onOpen);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('erp:command', onOpen); };
  }, []);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    if (panel.current && !reducedMotion()) {
      gsap.fromTo(panel.current, { y: -14, opacity: 0, scale: 0.97 }, { y: 0, opacity: 1, scale: 1, duration: 0.32, ease: 'power3.out' });
      gsap.fromTo('.palette-backdrop', { opacity: 0 }, { opacity: 1, duration: 0.2 });
    }
  }, [open]);

  const match = useMemo(() => matchCommand(commands, text) as { command: Cmd; argText: string; rest: string } | null, [commands, text]);

  // resolve the command's argument ("PRESS-01") to a record while typing
  useEffect(() => {
    if (!match?.command.arg || !match.argText) { setResolved(null); return; }
    const key = `${match.command.module}:${match.command.id}:${match.argText}`;
    setResolved({ key, record: null, loading: true });
    const lk = match.command.arg.lookup;
    const t = setTimeout(() => {
      api<Record<string, unknown>[]>(lk.module ?? match.command.module, lk.path, { query: { ...lk.query, q: match.argText, limit: 50 } })
        .then((rows) => setResolved({ key, record: pickRecord(lk, Array.isArray(rows) ? rows : [], match.argText), loading: false }))
        .catch(() => setResolved({ key, record: null, loading: false }));
    }, 180);
    return () => clearTimeout(t);
  }, [match?.command.id, match?.command.module, match?.argText]);

  // find records
  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 2 || match) { setRecords([]); return; }
    const t = setTimeout(async () => {
      const found = await Promise.all(searches.map(async (s: SearchSpec & { module: string }) => {
        try {
          const rows = await api<Record<string, unknown>[]>(s.module, s.endpoint, { query: { ...s.query, q, limit: 20 } });
          const needle = q.toLowerCase();
          return (Array.isArray(rows) ? rows : [])
            .filter((r) => s.label.some((k) => String(get(r, k) ?? '').toLowerCase().includes(needle)))
            .slice(0, 3)
            .map<Item>((r) => ({
              key: `rec:${s.module}:${s.id}:${String(get(r, s.idFrom ?? 'id'))}`,
              group: 'ข้อมูล',
              title: String(get(r, s.label[0]) ?? ''),
              sub: `${s.title} · ${s.label.slice(1).map((k) => get(r, k)).filter(Boolean).join(' · ')}`,
              icon: <FileText size={16} aria-hidden />,
              run: () => go(screenHref(s.module, s.screen, get(r, s.idFrom ?? 'id'))),
            }));
        } catch { return []; }
      }));
      setRecords(found.flat());
    }, 220);
    return () => clearTimeout(t);
  }, [text, open, searches, !!match]);

  const go = (href: string) => { setOpen(false); router.push(href); };

  const runCommand = (c: Cmd, record: Record<string, unknown> | null, rest: string) => {
    const t = commandTarget(c, ui(c.module).screens[c.screen], record, rest);
    go(withQuery(screenHref(c.module, t.screen, t.id), t.query));
  };

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q) return;
    const session = loadSession();
    const history: Chat[] = [...(chat ?? []), { role: 'user', content: q }];
    setChat(history);
    setText('');
    setThinking(true);
    try {
      const res = await fetch('/assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
        body: JSON.stringify({ messages: history.filter((m) => !m.error).map(({ role, content }) => ({ role, content })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? 'ผู้ช่วย AI ไม่ตอบในตอนนี้');
      setChat((h) => [...(h ?? []), { role: 'assistant', content: data.reply, actions: data.actions, error: !!data.offline }]);
    } catch (e) {
      setChat((h) => [...(h ?? []), { role: 'assistant', content: e instanceof Error ? e.message : 'ผิดพลาด', error: true }]);
    } finally {
      setThinking(false);
    }
  };

  /** "ค้นหาด้วย AI": a Thai sentence -> one list screen with its filters (POST /assist/find). Opens it straight away. */
  const findWithAi = async (sentence: string) => {
    const q = sentence.trim();
    if (!q) return;
    const session = loadSession();
    setChat([{ role: 'user', content: `ค้นหา: ${q}` }]);
    setText('');
    setThinking(true);
    try {
      const res = await fetch('/assist/find', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
        body: JSON.stringify({ text: q }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? 'ค้นหาด้วย AI ไม่ได้ในตอนนี้');
      const href = safeHref(data.actions?.[0]?.href);
      if (href && !data.offline) { go(href); return; }
      setChat((h) => [...(h ?? []), { role: 'assistant', content: data.reply || 'ไม่พบหน้ารายการที่ตรงกับคำค้นนี้', error: !!data.offline }]);
    } catch (e) {
      setChat((h) => [...(h ?? []), { role: 'assistant', content: e instanceof Error ? e.message : 'ผิดพลาด', error: true }]);
    } finally {
      setThinking(false);
    }
  };

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: 'end' });
    const last = list.current?.querySelector('.bubble:last-of-type');
    if (last && !reducedMotion()) gsap.fromTo(last, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' });
  }, [chat?.length, thinking]);

  // build the result list
  const items: Item[] = [];
  const q = text.trim().toLowerCase();
  if (!chat) {
    if (match) {
      const c = match.command;
      const r = resolved?.key === `${c.module}:${c.id}:${match.argText}` ? resolved : null;
      const needArg = !!c.arg && !!match.argText;
      const sub = !c.arg ? (match.rest ? `“${match.rest}”` : ui(c.module).label)
        : !match.argText ? `พิมพ์ต่อ เช่น ${c.example}`
        : r?.loading || !r ? `กำลังค้นหา “${match.argText}”…`
        : r.record ? `→ ${c.arg.lookup.label.map((k) => get(r.record, k)).filter(Boolean).join('  ')}${match.rest ? ` · “${match.rest}”` : ''}`
        : c.arg.openId ? `ไม่พบ “${match.argText}”` : `ไม่พบ “${match.argText}” — เปิดหน้าว่างแทน`;
      items.push({
        key: `cmd:${c.module}:${c.id}`, group: 'คำสั่ง', title: c.label, sub,
        icon: <Zap size={16} aria-hidden />,
        run: () => {
          const record = needArg ? r?.record ?? null : null;
          if (c.arg?.openId && !record) { input.current?.focus(); return; } // nothing to open yet
          runCommand(c, record, c.arg ? match.rest : [match.argText, match.rest].filter(Boolean).join(' '));
        },
      });
    } else {
      const cmds = q ? commands.filter((c) => c.label.toLowerCase().includes(q) || c.keywords.some((k) => k.toLowerCase().includes(q) || q.startsWith(k.toLowerCase()))) : commands;
      for (const c of cmds.slice(0, q ? 4 : 6)) {
        items.push({
          key: `cmd:${c.module}:${c.id}`, group: q ? 'คำสั่ง' : 'ลองพิมพ์', title: c.example, sub: c.label,
          icon: <ModuleIcon name={ui(c.module)?.icon} glyph={ui(c.module)?.glyph ?? ''} size={16} />,
          run: () => { if (c.arg) { setText(`${c.keywords[0]} `); input.current?.focus(); } else runCommand(c, null, ''); },
        });
      }
    }
    if (q && !match) {
      for (const m of modules) {
        for (const mi of m.menu) {
          if (!hasPerm(perms, m.screens[mi.screen]?.perm)) continue;
          if (!(mi.label.toLowerCase().includes(q) || m.label.toLowerCase().includes(q) || m.screens[mi.screen]?.title.toLowerCase().includes(q))) continue;
          items.push({ key: `scr:${m.module}:${mi.screen}`, group: 'หน้าจอ', title: mi.label, sub: m.label, icon: <LayoutGrid size={16} aria-hidden />, run: () => go(screenHref(m.module, mi.screen)) });
        }
      }
    }
    items.push(...records);
    // a sentence that is not a command: let AI turn it into list filters ("ใบเบิกที่รออนุมัติเดือนนี้")
    if (q && !match && (q.includes(' ') || q.length >= 8)) items.push({ key: 'find', group: 'ผู้ช่วย AI', title: `ค้นหาด้วย AI: “${text.trim()}”`, sub: 'AI เลือกหน้ารายการและตั้งตัวกรองให้ เช่น “ใบสั่งซื้อรออนุมัติเดือนนี้”', icon: <ListFilter size={16} aria-hidden />, run: () => findWithAi(text) });
    if (q) items.push({ key: 'ask', group: 'ผู้ช่วย AI', title: `ถาม AI: “${text.trim()}”`, sub: 'ตอบจากข้อมูลจริงในระบบ เช่น “เดือนนี้ซื้อเหล็กไปเท่าไหร่”', icon: <Bot size={16} aria-hidden />, run: () => ask(text) });
  }
  // the AI rows stay reachable however many records matched
  const isAi = (i: Item) => i.key === 'find' || i.key === 'ask';
  const shown = [...items.filter((i) => !isAi(i)).slice(0, 12), ...items.filter(isAi)];
  useEffect(() => setActive(0), [text, !!chat]);

  useEffect(() => {
    if (!list.current || reducedMotion()) return;
    const rows = list.current.querySelectorAll('.pal-item');
    if (rows.length) gsap.fromTo(rows, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.2, stagger: 0.015, ease: 'power1.out', clearProps: 'opacity,transform' });
  }, [shown.map((i) => i.key).join('|')]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); if (chat) { setChat(null); setText(''); } else close(); return; }
    if (chat) { if (e.key === 'Enter' && !thinking) { e.preventDefault(); ask(text); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === 'Enter') { e.preventDefault(); shown[active]?.run(); }
  };

  let lastGroup = '';
  return (
    <div className="palette-root">
      <div className="palette-backdrop" onClick={close} aria-hidden />
      <div className="palette" ref={panel} role="dialog" aria-modal="true" aria-label="ผู้ช่วยสั่งงาน">
        <div className="pal-input">
          {chat ? <Bot size={18} className="spark" aria-hidden /> : <Sparkles size={18} className="spark" aria-hidden />}
          <input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={chat ? 'ถามต่อ…' : 'พิมพ์คำสั่ง ค้นหา หรือถามคำถาม เช่น “แจ้งซ่อม PRESS-01 น้ำมันรั่ว”'}
            aria-label="คำสั่งหรือคำถาม"
            role="combobox"
            aria-expanded={!chat}
            aria-controls="pal-list"
            aria-activedescendant={!chat && shown[active] ? `pal-${active}` : undefined}
          />
          <kbd>esc</kbd>
        </div>

        <div className="pal-body" ref={list} id="pal-list" role={chat ? undefined : 'listbox'}>
          {chat ? (
            <div className="chat">
              {chat.map((m, i) => (
                <div key={i} className={`bubble ${m.role}${m.error ? ' is-error' : ''}`}>
                  <p>{m.content}</p>
                  {!!m.actions?.length && (
                    <div className="bubble-actions">
                      {m.actions.filter((a) => safeHref(a.href)).map((a) => <button key={a.href} type="button" className="btn-primary" onClick={() => go(a.href)}>{a.label}<ArrowRight size={14} aria-hidden /></button>)}
                    </div>
                  )}
                </div>
              ))}
              {thinking && <div className="bubble assistant thinking"><Loader2 size={16} className="spin" aria-hidden /> กำลังดูข้อมูล…</div>}
              <div ref={chatEnd} />
            </div>
          ) : shown.length === 0 ? (
            <p className="pal-empty"><Search size={16} aria-hidden /> พิมพ์เพื่อเริ่ม</p>
          ) : (
            shown.map((it, i) => {
              const head = it.group !== lastGroup ? <p className="pal-group" key={`g-${it.group}`}>{it.group}</p> : null;
              lastGroup = it.group;
              return (
                <div key={it.key}>
                  {head}
                  <div id={`pal-${i}`} role="option" aria-selected={i === active} className={`pal-item${i === active ? ' is-active' : ''}`}
                    onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); it.run(); }}>
                    <span className="pal-icon">{it.icon}</span>
                    <span className="pal-text"><b>{it.title}</b>{it.sub && <span>{it.sub}</span>}</span>
                    {i === active && <CornerDownLeft size={14} className="pal-enter" aria-hidden />}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="pal-foot">
          {chat ? <span>Enter ส่ง · Esc กลับไปที่คำสั่ง · ผู้ช่วยอ่านข้อมูลได้อย่างเดียว ไม่บันทึกแทนคุณ</span>
            : <span>↑↓ เลือก · Enter ทำเลย · พิมพ์ภาษาไทยได้ทั้งหมด</span>}
        </div>
      </div>
    </div>
  );
}
