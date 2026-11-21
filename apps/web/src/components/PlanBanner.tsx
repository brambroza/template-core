'use client';
/**
 * Cloud plan reminder above every page: "ทดลองใช้แพ็กเกจ Factory เหลือ 5 วัน" during the trial, and a payment reminder in the last
 * week of a paid month (incl. the grace days). Nothing for self-hosted installs (no plan) or in showcase mode.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { planNotice, type PlanView } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { screenHref } from '@/lib/nav';
import { SHOWCASE } from '@/lib/showcase';

export function PlanBanner() {
  const [plan, setPlan] = useState<PlanView | null>(null);
  useEffect(() => {
    if (SHOWCASE) return;
    api<{ subscription: PlanView | null }>('identity', '/subscription').then((r) => setPlan(r.subscription)).catch(() => setPlan(null));
  }, []);
  const notice = planNotice(plan);
  if (!notice) return null;
  return (
    <p className={`plan-bar${notice.urgent ? ' is-urgent' : ''}`} role="note">
      <span>{notice.text}</span>
      <Link href={screenHref('identity', 'plan')}>ดูแพ็กเกจและวิธีชำระ</Link>
    </p>
  );
}
