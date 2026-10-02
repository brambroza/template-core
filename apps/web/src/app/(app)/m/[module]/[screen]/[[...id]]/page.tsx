'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { hasPerm } from '@erp/ui-schema';
import { DetailView } from '@/components/DetailView';
import { FormView } from '@/components/FormView';
import { ListView } from '@/components/ListView';
import { useRegistry } from '@/lib/registry';
import { loadSession } from '@/lib/session';

export default function ScreenPage() {
  const p = useParams<{ module: string; screen: string; id?: string[] }>();
  const { ui, loading } = useRegistry();
  if (loading) return <p className="muted">กำลังโหลด…</p>;
  const mod = ui(p.module);
  if (!mod) return <Notice title="ยังไม่ได้ติดตั้งโมดูลนี้" text="ติดต่อผู้ดูแลระบบหากต้องการใช้งานโมดูลนี้" />;
  const screen = mod.screens[p.screen];
  if (!screen) return <Notice title="ไม่พบหน้านี้" text="ลิงก์อาจไม่ถูกต้อง กลับไปเลือกจากเมนู" />;
  if (!hasPerm(loadSession()?.permissions ?? [], screen.perm)) return <Notice title="ไม่มีสิทธิ์เข้าหน้านี้" text="ขอสิทธิ์จากผู้ดูแลระบบของบริษัท" />;
  const id = p.id?.[0] ? decodeURIComponent(p.id[0]) : undefined;
  const key = `${p.module}/${p.screen}/${id ?? ''}`;
  return (
    <Suspense fallback={<p className="muted">กำลังโหลด…</p>}>
      {screen.kind === 'list' && <ListView key={key} module={p.module} screen={screen} id={id} />}
      {screen.kind === 'form' && <FormView key={key} module={p.module} screen={screen} id={id} />}
      {screen.kind === 'detail' && <DetailView key={key} module={p.module} screen={screen} id={id} />}
    </Suspense>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return <div className="notice"><h1>{title}</h1><p>{text}</p></div>;
}
