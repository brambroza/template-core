'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { hasPerm } from '@erp/ui-schema';
import { useRegistry } from '@/lib/registry';
import { clearSession, loadSession, type Session } from '@/lib/session';
import { screenHref } from '@/lib/nav';

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

  return (
    <div className={`shell${menuOpen ? ' menu-open' : ''}`}>
      <a className="skip" href="#main">ข้ามไปเนื้อหา</a>
      <aside className="sidebar" aria-label="เมนูหลัก">
        <div className="brand">
          <Link href="/">{session.tenant.name}</Link>
        </div>
        <nav>
          {loading && <p className="nav-note">กำลังโหลดเมนู…</p>}
          {error && <p className="nav-note">{error}</p>}
          {modules.map((m) => {
            const items = m.menu.filter((i) => hasPerm(perms, m.screens[i.screen]?.perm));
            if (!items.length) return null;
            return (
              <div key={m.module} className="nav-group">
                <p className="nav-group-title"><span className="glyph" aria-hidden>{m.glyph}</span>{m.label}</p>
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
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <p className="who">{session.user.name}<span>{session.user.email}</span></p>
          <button type="button" className="btn-quiet" onClick={() => { clearSession(); router.replace('/login'); }}>ออกจากระบบ</button>
        </div>
      </aside>
      <div className="main-col">
        <header className="topbar">
          <button type="button" className="menu-toggle" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>เมนู</button>
          <span className="topbar-company">{session.tenant.name}</span>
        </header>
        <main id="main" className="content">{children}</main>
      </div>
    </div>
  );
}
