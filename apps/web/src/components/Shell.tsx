'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, KeyRound, LogOut, Menu, Sparkles, Gauge } from 'lucide-react';
import { AiGradientDefs, AiSpark, LogoMark, isAiModule } from './Brand';
import { commandExample, groupByArea, hasPerm, moduleArea, type AreaId } from '@erp/ui-schema';
import { restoreNumberFormat } from '@/lib/number-format';
import { readPref, writePref } from '@/lib/prefs';
import { useRegistry } from '@/lib/registry';
import { clearSession, loadSession, logout, type Session } from '@/lib/session';
import { HOME, SHOWCASE, SHOWCASE_CONTACT } from '@/lib/showcase';
import { screenHref } from '@/lib/nav';
import { ModuleIcon } from './Icon';
import { CommandPalette, openCommandPalette } from './CommandPalette';
import { NotificationBell } from './NotificationBell';
import { PlanBanner } from './PlanBanner';
import { StarterBanner } from './StarterBanner';
import { SetupBanner } from './SetupBanner';
import { Toaster } from './Toaster';
import { BottomNav } from './BottomNav';
import { loadCompany } from './print/company';

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
    if (!s) { router.replace('/login'); return; }
    // numbers the way this company writes them: what the browser remembers first (no flash of the default),
    // then the company profile itself — api.ts takes the format from that answer
    restoreNumberFormat();
    setSession(s);
    void loadCompany();
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
  const example = commandExample(modules, perms);
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
      <AiGradientDefs />

      <div className="rail" aria-label="โมดูล" onMouseLeave={hideTip}>
        <Link href={HOME} className="rail-logo" aria-label="Factory OS — ภาพรวมวันนี้"><LogoMark size={36} /></Link>
        <div className="rail-scroll" onScroll={hideTip}>
          <Link href={HOME} className={path === HOME ? 'is-active' : undefined} aria-label="ภาพรวมวันนี้" onMouseEnter={showTip('ภาพรวมวันนี้')} onFocus={showTip('ภาพรวมวันนี้')} onBlur={hideTip}>
            <Gauge size={20} strokeWidth={1.8} aria-hidden />
          </Link>
          {areas.map((g) => (
            <Fragment key={g.area}>
              <span className="rail-sep" aria-hidden title={g.label} />
              {g.items.map(({ m, items }) => (
                <Link key={m.module} href={screenHref(m.module, items[0].screen)} className={[activeModule === m.module && 'is-active', isAiModule(m.module) && 'is-ai'].filter(Boolean).join(' ') || undefined} aria-label={m.label}
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
          <Link href={HOME}>{session.tenant.name}</Link>
          <span>{session.tenant.code}</span>
        </div>
        <nav>
          {loading && <p className="nav-note">กำลังโหลดเมนู…</p>}
          {error && <p className="nav-note">{error}</p>}
          {areas.map((g) => {
            const open = isOpen(g.area);
            const groups = g.items.map(({ m, items }) => (
              <div key={m.module} className={`nav-group${isAiModule(m.module) ? ' is-ai' : ''}`} id={`nav-${m.module}`}>
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
          <Link href={screenHref('identity', 'changePassword')} className="icon-btn" aria-label="เปลี่ยนรหัสผ่าน" title="เปลี่ยนรหัสผ่าน">
            <KeyRound size={18} aria-hidden />
          </Link>
          <button type="button" className="icon-btn" aria-label="ออกจากระบบ" title="ออกจากระบบ (ทุกอุปกรณ์)"
            onClick={async () => {
              // showcase: nothing to revoke — forget the persona and go back to the landing page
              if (SHOWCASE) { clearSession(); window.location.href = '/'; return; }
              const ok = await logout(); router.replace(ok ? '/login?logout=1' : '/login');
            }}>
            <LogOut size={18} aria-hidden />
          </button>
        </div>
      </aside>
      {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden />}

      <div className="main-col">
        {SHOWCASE && (
          <p className="showcase-bar" role="note">
            <span><b>โหมดตัวอย่าง</b> · ข้อมูลสมมติ · ไม่บันทึก</span>
            <a href={SHOWCASE_CONTACT}>ขอเดโมเต็ม</a>
          </p>
        )}
        <PlanBanner />
        <SetupBanner />
        <StarterBanner />
        <header className="topbar">
          <Link href={HOME} className="topbar-logo" aria-label="Factory OS — ภาพรวมวันนี้"><LogoMark size={34} /></Link>
          <button type="button" className="btn menu-toggle" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            <Menu size={18} aria-hidden /><span className="menu-label">เมนู</span>
          </button>
          <button type="button" className="cmd-trigger" onClick={() => openCommandPalette()} aria-label="ค้นหาหรือสั่งงาน">
            <AiSpark size={18} />
            <span>{example ? `พิมพ์ค้นหา หรือสั่งงาน เช่น “${example}”` : 'พิมพ์ค้นหาเมนู เอกสาร หรือสั่งงาน'}</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="topbar-right">
            <NotificationBell />
          </div>
        </header>
        <main id="main" className="content">{children}</main>
      </div>
      <BottomNav visible={visible} activeModule={activeModule} menuOpen={menuOpen} onMenu={() => setMenuOpen((o) => !o)} />
      <CommandPalette />
      <Toaster />
    </div>
  );
}
