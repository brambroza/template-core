'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { LogOut, Menu, Sparkles, Gauge } from 'lucide-react';
import { hasPerm } from '@erp/ui-schema';
import { useRegistry } from '@/lib/registry';
import { clearSession, loadSession, type Session } from '@/lib/session';
import { screenHref } from '@/lib/nav';
import { ModuleIcon } from './Icon';
import { CommandPalette, openCommandPalette } from './CommandPalette';
import { NotificationBell } from './NotificationBell';
import { Toaster } from './Toaster';

export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { modules, loading, error } = useRegistry();
  const [session, setSession] = useState<Session | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const s = loadSession();
    if (!s) router.replace('/login');
    else setSession(s);
  }, [router]);
  useEffect(() => setMenuOpen(false), [path]);

  if (!session) return null;
  const perms = session.permissions;
  const visible = modules
    .map((m) => ({ m, items: m.menu.filter((i) => hasPerm(perms, m.screens[i.screen]?.perm)) }))
    .filter((x) => x.items.length);
  const activeModule = path.startsWith('/m/') ? path.split('/')[2] : null;
  const initials = (session.user.name || session.user.email).trim().slice(0, 1).toUpperCase();

  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <a className="skip" href="#main">ข้ามไปเนื้อหา</a>

      <div className="rail" aria-label="โมดูล">
        <div className="rail-logo" aria-hidden />
        <Link href="/" className={path === '/' ? 'is-active' : undefined} aria-label="ภาพรวมโรงงาน">
          <Gauge size={20} strokeWidth={1.8} aria-hidden /><span className="tip">ภาพรวมโรงงาน</span>
        </Link>
        {visible.map(({ m, items }) => (
          <Link key={m.module} href={screenHref(m.module, items[0].screen)} className={activeModule === m.module ? 'is-active' : undefined} aria-label={m.label}>
            <ModuleIcon name={m.icon} glyph={m.glyph} size={20} /><span className="tip">{m.label}</span>
          </Link>
        ))}
        <div className="rail-spacer" />
        <button type="button" onClick={() => openCommandPalette()} aria-label="ผู้ช่วยสั่งงาน">
          <Sparkles size={20} strokeWidth={1.8} aria-hidden /><span className="tip">ผู้ช่วยสั่งงาน (⌘K)</span>
        </button>
      </div>

      <aside className="panel-nav" aria-label="เมนูหลัก">
        <div className="brand">
          <Link href="/">{session.tenant.name}</Link>
          <span>{session.tenant.code}</span>
        </div>
        <nav>
          {loading && <p className="nav-note">กำลังโหลดเมนู…</p>}
          {error && <p className="nav-note">{error}</p>}
          {visible.map(({ m, items }) => (
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
          ))}
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
