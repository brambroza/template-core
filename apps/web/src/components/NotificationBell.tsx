'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { fillPath, hasPerm, type ModuleUi } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { gsap, reducedMotion } from '@/lib/motion';
import { useRegistry } from '@/lib/registry';
import { loadSession } from '@/lib/session';
import { toast, type ToastTone } from '@/lib/toast';
import { safeHref } from '@/lib/href';

interface Note { id: string; level: ToastTone; title: string; body?: string | null; link?: string | null; read_at: string | null; created_at: string; module: string }

const POLL_MS = 20_000;

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'เมื่อสักครู่';
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชม.ที่แล้ว`;
  return `${Math.floor(s / 86400)} วันที่แล้ว`;
}

/**
 * The bell in the top bar. Any installed module can feed it by declaring `notifications` in its ui.ts
 * (today: automation). New items since the last poll also pop up as toasts.
 */
export function NotificationBell() {
  const router = useRouter();
  const { modules } = useRegistry();
  const perms = loadSession()?.permissions ?? [];
  const sources = modules.filter((m): m is ModuleUi & { notifications: NonNullable<ModuleUi['notifications']> } => !!m.notifications && hasPerm(perms, m.notifications.perm));
  const [items, setItems] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const key = sources.map((s) => s.module).join(',');

  const load = useCallback(async () => {
    const all: Note[] = [];
    let count = 0;
    for (const m of sources) {
      try {
        const r = await api<{ unread: number; items: Omit<Note, 'module'>[] }>(m.module, m.notifications.endpoint);
        count += r.unread;
        all.push(...r.items.map((n) => ({ ...n, module: m.module })));
      } catch { /* a module being down must not break the shell */ }
    }
    all.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (seen.current) {
      const fresh = all.filter((n) => !seen.current!.has(n.id) && !n.read_at);
      fresh.slice(0, 3).forEach((n) => toast({ title: n.title, body: n.body ?? undefined, tone: n.level, href: safeHref(n.link) }));
      if (fresh.length && bell.current && !reducedMotion()) gsap.fromTo(bell.current, { rotate: -18 }, { rotate: 0, duration: 0.8, ease: 'elastic.out(1.2, 0.3)' });
    }
    seen.current = new Set(all.map((n) => n.id));
    setItems(all);
    setUnread(count);
  }, [key]);

  useEffect(() => {
    if (!sources.length) return;
    load();
    const t = setInterval(load, POLL_MS);
    const now = () => load();
    window.addEventListener('erp:notifications', now);
    return () => { clearInterval(t); window.removeEventListener('erp:notifications', now); };
  }, [load, sources.length]);

  useEffect(() => {
    if (!open) return;
    if (panel.current && !reducedMotion()) {
      gsap.fromTo(panel.current, { y: -6, opacity: 0 }, { y: 0, opacity: 1, duration: 0.22, ease: 'power2.out' });
      gsap.fromTo(panel.current.querySelectorAll('li'), { opacity: 0, x: 8 }, { opacity: 1, x: 0, duration: 0.3, stagger: 0.03, ease: 'power2.out' });
    }
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  if (!sources.length) return null;

  const spec = (module: string) => sources.find((s) => s.module === module)!.notifications;
  const openNote = async (n: Note) => {
    setOpen(false);
    if (!n.read_at) {
      api(n.module, fillPath(spec(n.module).readEndpoint, { id: n.id }), { method: 'POST' }).then(load).catch(() => {});
    }
    const href = safeHref(n.link);
    if (href) router.push(href);
  };
  const readAll = async () => {
    await Promise.all(sources.map((m) => api(m.module, m.notifications.readAllEndpoint, { method: 'POST' }).catch(() => {})));
    load();
  };

  return (
    <div className="bell" ref={box}>
      <button ref={bell} type="button" className="icon-btn" aria-label={`การแจ้งเตือน${unread ? ` (${unread} ยังไม่อ่าน)` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell size={19} strokeWidth={1.8} aria-hidden />
        {unread > 0 && <span className="dot">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" ref={panel} role="dialog" aria-label="การแจ้งเตือน">
          <header>
            <b>การแจ้งเตือน</b>
            {unread > 0 && <button type="button" className="btn-ghost" onClick={readAll}><CheckCheck size={15} aria-hidden />อ่านทั้งหมด</button>}
          </header>
          {items.length === 0 ? <p className="bell-empty">ยังไม่มีการแจ้งเตือน — ตั้งกฎใน “ระบบอัตโนมัติ” แล้วระบบจะเตือนที่นี่</p> : (
            <ul>
              {items.slice(0, 12).map((n) => (
                <li key={n.id} className={n.read_at ? '' : 'is-unread'}>
                  <button type="button" onClick={() => openNote(n)}>
                    <span className={`lvl tone-${n.level}`} aria-hidden />
                    <span className="bell-text"><b>{n.title}</b>{n.body && <span>{n.body}</span>}<time dateTime={n.created_at}>{ago(n.created_at)}</time></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
