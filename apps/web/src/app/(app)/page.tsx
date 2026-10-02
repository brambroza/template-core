'use client';

import Link from 'next/link';
import { hasPerm } from '@erp/ui-schema';
import { useRegistry } from '@/lib/registry';
import { loadSession } from '@/lib/session';
import { screenHref } from '@/lib/nav';

export default function Home() {
  const { modules, catalog, loading } = useRegistry();
  const perms = loadSession()?.permissions ?? [];
  if (loading) return <p className="muted">กำลังโหลด…</p>;
  return (
    <div className="screen home">
      <header className="screen-head"><h1>เริ่มทำงาน</h1></header>
      <div className="home-grid">
        {modules.map((m) => {
          const items = m.menu.filter((i) => hasPerm(perms, m.screens[i.screen]?.perm));
          if (!items.length) return null;
          const info = catalog.find((c) => c.id === m.module);
          return (
            <section key={m.module} className="home-module">
              <h2><span className="glyph" aria-hidden>{m.glyph}</span>{m.label}</h2>
              <ul>{items.map((i) => <li key={i.screen}><Link href={screenHref(m.module, i.screen)}>{i.label}</Link></li>)}</ul>
              {info && <p className="home-version">รุ่น {info.version}</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
