'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Info, OctagonAlert, TriangleAlert, X } from 'lucide-react';
import { gsap, reducedMotion } from '@/lib/motion';
import type { ToastMsg } from '@/lib/toast';

type Item = ToastMsg & { id: number };
const ICON = { info: Info, ok: CheckCircle2, warn: TriangleAlert, stop: OctagonAlert };

/** Corner messages: action results, new notifications. Slide in with GSAP, leave by themselves. */
export function Toaster() {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<ToastMsg>).detail;
      const id = ++seq.current;
      setItems((xs) => [...xs.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === 'stop' ? 10000 : 6000);
    };
    window.addEventListener('erp:toast', on);
    return () => window.removeEventListener('erp:toast', on);
  }, []);

  const dismiss = (id: number) => {
    const el = document.querySelector<HTMLElement>(`[data-toast="${id}"]`);
    const drop = () => setItems((xs) => xs.filter((x) => x.id !== id));
    if (!el || reducedMotion()) return drop();
    gsap.to(el, { x: 40, opacity: 0, duration: 0.25, ease: 'power2.in', onComplete: drop });
  };

  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <ToastCard key={t.id} t={t} onClose={() => dismiss(t.id)} />)}
    </div>
  );
}

function ToastCard({ t, onClose }: { t: Item; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && !reducedMotion()) gsap.fromTo(ref.current, { x: 48, opacity: 0, scale: 0.96 }, { x: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(1.6)' });
  }, []);
  const tone = t.tone ?? 'info';
  const Icon = ICON[tone];
  return (
    <div ref={ref} className={`toast tone-${tone}`} data-toast={t.id}>
      <Icon size={18} className="toast-icon" aria-hidden />
      <div className="toast-text">
        <b>{t.title}</b>
        {t.body && <span>{t.body}</span>}
        {t.href && <Link href={t.href} onClick={onClose}>เปิดดู</Link>}
      </div>
      <button type="button" className="icon-btn" aria-label="ปิด" onClick={onClose}><X size={14} aria-hidden /></button>
    </div>
  );
}
