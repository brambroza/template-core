'use client';
/** "ตั้งค่าเริ่มต้น 2/5 — ทำต่อ" until a new cloud company finishes or closes the wizard (GET /api/identity/onboarding). */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { api } from '@/lib/api';
import { SHOWCASE } from '@/lib/showcase';

export function SetupBanner() {
  const path = usePathname();
  const [left, setLeft] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => {
    if (SHOWCASE) return;
    api<{ onboarding: { steps: unknown[]; doneCount: number; completed: boolean } | null }>('identity', '/onboarding')
      .then((r) => setLeft(r.onboarding && !r.onboarding.completed ? { done: r.onboarding.doneCount, total: r.onboarding.steps.length } : null))
      .catch(() => setLeft(null));
  }, [path]);
  if (!left || path === '/setup') return null;
  return (
    <p className="setup-bar" role="note">
      <ListChecks size={16} aria-hidden />
      <span>ตั้งค่าเริ่มต้นแล้ว {left.done}/{left.total} ขั้น</span>
      <Link href="/setup">ทำต่อ</Link>
    </p>
  );
}
