'use client';
/**
 * Phone navigation (≤ 760 px, CSS shows it): five thumb-reach buttons fixed to the bottom of the screen, above the iPhone home bar.
 *   หน้าแรก · the module being worked in (or the last one) · ค้นหา/สั่งงาน (⌘K palette) · งานรอ (the decision inbox on home) · เมนู (the drawer)
 * Desktop and tablet keep the rail + menu panel; nothing here renders differently, it is only hidden there.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Gauge, LayoutGrid, ListChecks, Menu, Search } from 'lucide-react';
import type { ModuleUi } from '@erp/ui-schema';
import { readPref, writePref } from '@/lib/prefs';
import { screenHref } from '@/lib/nav';
import { HOME } from '@/lib/showcase';
import { ModuleIcon } from './Icon';
import { openCommandPalette } from './CommandPalette';

interface Entry { m: ModuleUi; items: { screen: string; label: string }[] }

export function BottomNav({ visible, activeModule, menuOpen, onMenu }: { visible: Entry[]; activeModule: string | null; menuOpen: boolean; onMenu: () => void }) {
  const path = usePathname();
  const [last, setLast] = useState<string | null>(null);
  // remember the module last worked in, so the second button brings you back to it from home
  useEffect(() => {
    if (activeModule) { writePref('nav.lastModule', activeModule); setLast(activeModule); }
    else setLast(readPref<string | null>('nav.lastModule', null));
  }, [activeModule]);
  const current = visible.find((x) => x.m.module === (activeModule ?? last)) ?? null;
  const onHome = path === HOME;

  return (
    <nav className="bottom-nav" aria-label="เมนูลัด">
      <Link href={HOME} className={onHome ? 'is-active' : undefined} aria-current={onHome ? 'page' : undefined}>
        <Gauge size={22} strokeWidth={1.8} aria-hidden /><span>หน้าแรก</span>
      </Link>
      {current ? (
        <Link href={screenHref(current.m.module, current.items[0]!.screen)} className={activeModule === current.m.module ? 'is-active' : undefined}>
          <ModuleIcon name={current.m.icon} glyph={current.m.glyph} size={22} /><span>{current.m.label}</span>
        </Link>
      ) : (
        <button type="button" onClick={onMenu}><LayoutGrid size={22} strokeWidth={1.8} aria-hidden /><span>โมดูล</span></button>
      )}
      <button type="button" className="bottom-nav-cmd" onClick={() => openCommandPalette()} aria-label="ค้นหาหรือสั่งงาน">
        <span className="bottom-nav-cmd-dot"><Search size={22} strokeWidth={2} aria-hidden /></span><span>ค้นหา/สั่งงาน</span>
      </button>
      <Link href={`${HOME}#decide`} onClick={() => { if (onHome) document.getElementById('decide')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
        <ListChecks size={22} strokeWidth={1.8} aria-hidden /><span>งานรอ</span>
      </Link>
      <button type="button" className={menuOpen ? 'is-active' : undefined} aria-expanded={menuOpen} onClick={onMenu}>
        <Menu size={22} strokeWidth={1.8} aria-hidden /><span>เมนู</span>
      </button>
    </nav>
  );
}
