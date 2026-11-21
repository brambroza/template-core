'use client';
/** Two-column frame of the sign-in pages (login, sign-up, password reset): the assembling factory on the left, the form on the right. */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { gsap, reducedMotion } from '@/lib/motion';
import { AiSpark, Wordmark } from './Brand';

/** Isometric blocks that assemble on load — the factory being built, in 2D. */
function FloorArt() {
  const ref = useRef<SVGSVGElement>(null);
  const blocks: [number, number, number, boolean][] = [];
  for (let gx = 0; gx < 6; gx++) for (let gy = 0; gy < 5; gy++) if ((gx * 7 + gy * 3) % 4 !== 0) blocks.push([gx, gy, 1 + ((gx + gy * 2) % 3), (gx * 5 + gy) % 9 === 0]);
  const iso = (x: number, y: number, z: number) => [300 + (x - y) * 34, 120 + (x + y) * 19 - z * 22] as const;
  useLayoutEffect(() => {
    if (!ref.current || reducedMotion()) return;
    gsap.fromTo(ref.current.querySelectorAll('.blk'), { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: 'back.out(1.4)', stagger: { each: 0.03, from: 'random' } });
    gsap.to(ref.current.querySelectorAll('.blk.hot'), { opacity: 0.55, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: 1.4 });
  }, []);
  return (
    <svg ref={ref} className="grid3d" viewBox="0 0 600 420" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id="hot-top" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6366F1" /><stop offset=".5" stopColor="#A78BFA" /><stop offset="1" stopColor="#22D3EE" /></linearGradient>
      </defs>
      {blocks.sort((a, b) => a[0] + a[1] - (b[0] + b[1])).map(([x, y, h, hot], i) => {
        const top = [iso(x, y, h), iso(x + 1, y, h), iso(x + 1, y + 1, h), iso(x, y + 1, h)];
        const left = [iso(x, y + 1, h), iso(x + 1, y + 1, h), iso(x + 1, y + 1, 0), iso(x, y + 1, 0)];
        const right = [iso(x + 1, y, h), iso(x + 1, y + 1, h), iso(x + 1, y + 1, 0), iso(x + 1, y, 0)];
        const pts = (p: readonly (readonly [number, number])[]) => p.map((q) => q.join(',')).join(' ');
        return (
          <g key={i} className={`blk${hot ? ' hot' : ''}`}>
            {/* plain blocks take their colours from CSS (--blk-*: light by default); AI-hue "hot" blocks keep the gradient */}
            <polygon points={pts(left)} className={hot ? undefined : 'f-left'} fill={hot ? '#4F46E5' : undefined} />
            <polygon points={pts(right)} className={hot ? undefined : 'f-right'} fill={hot ? '#7C5CF0' : undefined} />
            <polygon points={pts(top)} className={hot ? undefined : 'f-top'} fill={hot ? 'url(#hot-top)' : undefined} />
          </g>
        );
      })}
    </svg>
  );
}

export function AuthLayout({ children, title = 'โรงงานทั้งหมด ในหน้าจอเดียว', lead = 'เห็นเครื่องจักร สต็อก งานผลิต และเงินเข้าออกแบบสด พร้อมผู้ช่วยที่สั่งงานด้วยภาษาไทย' }: {
  children: ReactNode; title?: string; lead?: string;
}) {
  return (
    <main className="login">
      <section className="login-art">
        <FloorArt />
        <Wordmark size={34} by />
        <div style={{ position: 'relative' }}>
          <p className="ai-line"><AiSpark size={14} />ผู้ช่วย AI สั่งงานด้วยภาษาไทย</p>
          <h2>{title}</h2>
          <p>{lead}</p>
        </div>
      </section>
      {children}
    </main>
  );
}
