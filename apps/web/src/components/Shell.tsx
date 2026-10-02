'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, LogOut, Menu, Sparkles, Gauge } from 'lucide-react';
import { groupByArea, hasPerm, moduleArea, type AreaId } from '@erp/ui-schema';
import { readPref, writePref } from '@/lib/prefs';
import { useRegistry } from '@/lib/registry';
import { clearSession, loadSession, type Session } from '@/lib/session';
import { screenHref } from '@/lib/nav';
import { ModuleIcon } from './Icon';
import { CommandPalette, openCommandPalette } from './CommandPalette';
import { NotificationBell } from './NotificationBell';
import { Toaster } from './Toaster';

/** With more modules than this, menu areas start collapsed (except the one being worked in) until the user chooses. */
const AUTO_COLLAPSE_OVER = 10;

export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { modules, loading, error } = useRegistry();
  const [session, setSession] = useState<Session | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** areas the user collapsed (saved per user); null = never chosen, use the default */
  const [userCollapsed, setUserCollapsed] = useState<AreaId[] | null>(null);
  const [tip, setTip] = useState<{ label: string; top: number } | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (!s) router.replace('/login');
    else setSession(s);
  }, [router]);
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => { if (session) setUserCollapsed(readPref<AreaId[] | null>('nav.collapsed', null)); }, [session]);
  const activeModule = path.startsWith('/m/') ? path.split('/')[2] : null;
  // keep the module being worked in visible in the panel (rail click, ⌘K, links from other modules)
  useEffect(() => {
    if (!activeModule) return;
    const t = setTimeout(() => document.getElementById(`nav-${activeModule}`)?.scrollIntoView({ block: 'nearest' }), 50);
    return () => clearTimeout(t);
  }, [activeModule]);

  if (!session) return null;
  const perms = session.permissions;
  const visible = modules
    .map((m) => ({ m, items: m.menu.filter((i) => hasPerm(perms, m.screens[i.screen]?.perm)) }))
    .filter((x) => x.items.length);
  const areas = groupByArea(visible, (x) => x.m);
  const activeEntry = visible.find((x) => x.m.module === activeModule);
  const activeArea = activeEntry ? moduleArea(activeEntry.m) : null;
  const collapsed = userCollapsed
    ?? (visible.length > AUTO_COLLAPSE_OVER ? areas.map((a) => a.area).filter((a) => a !== (activeArea ?? areas[0]?.area)) : []);
  const isOpen = (a: AreaId) => a === activeArea || !collapsed.includes(a);
  const toggleArea = (a: AreaId) => {
    const next = isOpen(a) ? [...collapsed.filter((x) => x !== a), a] : collapsed.filter((x) => x !== a);
    setUserCollapsed(next);
    writePref('nav.collapsed', next);
  };
  const showTip = (label: string) => (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2 });
  };
  const hideTip = () => setTip(null);
  const initials = (session.user.name || session.user.email).trim().slice(0, 1).toUpperCase();

  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <a className="skip" href="#main">ข้ามไปเนื้อหา</a>

      <div className="rail" aria-label="โมดูล" onMouseLeave={hideTip}>
        <div className="rail-logo" aria-hidden />
        <div className="rail-scroll" onScroll={hideTip}>
          <Link href="/" className={path === '/' ? 'is-active' : undefined} aria-label="ภาพรวมวันนี้" onMouseEnter={showTip('ภาพรวมวันนี้')} onFocus={showTip('ภาพรวมวันนี้')} onBlur={hideTip}>
            <Gauge size={20} strokeWidth={1.8} aria-hidden />
          </Link>
          {areas.map((g) => (
            <Fragment key={g.area}>
              <span className="rail-sep" aria-hidden title={g.label} />
              {g.items.map(({ m, items }) => (
                <Link key={m.module} href={screenHref(m.module, items[0].screen)} className={activeModule === m.module ? 'is-active' : undefined} aria-label={m.label}
                  onMouseEnter={showTip(m.label)} onFocus={showTip(m.label)} onBlur={hideTip}>
                  <ModuleIcon name={m.icon} glyph={m.glyph} size={20} />
                </Link>
              ))}
            </Fragment>
          ))}
        </div>
        <button type="button" className="rail-cmd" onClick={() => openCommandPalette()} aria-label="ผู้ช่วยสั่งงาน (⌘K)" onMouseEnter={showTip('ผู้ช่วยสั่งงาน (⌘K)')} onFocus={showTip('ผู้ช่วยสั่งงาน (⌘K)')} onBlur={hideTip}>
          <Sparkles size={20} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      {tip && <span className="rail-tip" style={{ top: tip.top }} aria-hidden>{tip.label}</span>}

      <aside className="panel-nav" aria-label="เมนูหลัก">
        <div className="brand">
          <Link href="/">{session.tenant.name}</Link>
          <span>{session.tenant.code}</span>
        </div>
        <nav>
          {loading && <p className="nav-note">กำลังโหลดเมนู…</p>}
          {error && <p className="nav-note">{error}</p>}
          {areas.map((g) => {
            const open = isOpen(g.area);
            const groups = g.items.map(({ m, items }) => (
              <div key={m.module} className="nav-group" id={`nav-${m.module}`}>
                <p className="nav-group-title"><ModuleIcon name={m.icon} glyph={m.glyph} size={14} />{m.label}</p>
                <ul>
                  {items.map((i) => {
                    const href = screenHref(m.module, i.screen);
                    const active = path === href || path.startsWith(`${href}/`);
                    return (
                      <li key={i.screen}>
                        <Link href={href} className={active ? 'is-active' : undefined} aria-current={active ? 'page' : undefined}>{i.label}</Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ));
            // one area (small installation): no area headings, just the modules
            if (areas.length < 2) return <Fragment key={g.area}>{groups}</Fragment>;
            return (
              <div key={g.area} className={`nav-area${open ? ' is-open' : ''}`}>
                <button type="button" className="nav-area-title" aria-expanded={open} aria-controls={`area-${g.area}`} onClick={() => toggleArea(g.area)}>
                  <span>{g.label}</span>
                  {!open && <span className="nav-area-mods">{g.items.map((x) => x.m.label).join(' · ')}</span>}
                  <ChevronDown size={16} aria-hidden className="chev" />
                </button>
                {open && <div id={`area-${g.area}`}>{groups}</div>}
              </div>
            );
          })}
        </nav>
        <div className="panel-foot">
          <span className="avatar" aria-hidden>{initials}</span>
          <span className="who"><b>{session.user.name}</b><span>{session.user.email}</span></span>
          <button type="button" className="icon-btn" aria-label="ออกจากระบบ" title="ออกจากระบบ" onClick={() => { clearSession(); router.replace('/login'); }}>
            <LogOut size={18} aria-hidden />
          </button>
        </div>
      </aside>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden />}

      <div className="main-col">
        <header className="topbar">
          <button type="button" className="btn menu-toggle" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            <Menu size={18} aria-hidden />เมนู
          </button>
          <button type="button" className="cmd-trigger" onClick={() => openCommandPalette()} aria-label="ค้นหาหรือสั่งงาน">
            <Sparkles size={18} className="spark" aria-hidden />
            <span>พิมพ์ค้นหา หรือสั่งงาน เช่น “สต็อก RM-STEEL”</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="topbar-right">
            <NotificationBell />
          </div>
        </header>
        <main id="main" className="content">{children}</main>
      </div>
      <CommandPalette />
      <Toaster />
    </div>
  );
}
