'use client';

import { useLayoutEffect, useRef } from 'react';
import { flowPosition, type StatusFlow } from '@erp/ui-schema';
import { gsap, reducedMotion } from '@/lib/motion';

/** Where a document is in its life: a horizontal stepper whose progress line draws in. */
export function FlowStepper({ flow, record }: { flow: StatusFlow; record: Record<string, unknown> }) {
  const ref = useRef<HTMLOListElement>(null);
  const { index, exit } = flowPosition(flow, record);
  const n = flow.steps.length;
  const pct = n > 1 && index > 0 ? (index / (n - 1)) * 100 : 0;
  useLayoutEffect(() => {
    const fill = ref.current?.querySelector<HTMLElement>('.flow-fill');
    if (!fill) return;
    const target = `calc((100% - 40px - (100% - 40px) / ${n}) * ${pct / 100})`;
    if (reducedMotion()) { fill.style.width = target; return; }
    gsap.fromTo(fill, { width: 0 }, { width: target, duration: 0.9, ease: 'power3.inOut' });
    gsap.fromTo(ref.current!.querySelectorAll('.flow-dot'), { scale: 0.6 }, { scale: 1, duration: 0.5, ease: 'back.out(2)', stagger: 0.08 });
  }, [index, n]);
  return (
    <ol className="flow" ref={ref} style={{ ['--n' as string]: n, listStyle: 'none' }} aria-label={`สถานะ: ${exit ? exit.label : flow.steps[index]?.label ?? '-'}`}>
      <span className="flow-track" aria-hidden />
      <span className="flow-fill" aria-hidden />
      {flow.steps.map((st, i) => {
        const state = exit ? (i === 0 ? 'done' : '') : i < index ? 'done' : i === index ? 'current' : '';
        return (
          <li key={st.value} className={`flow-step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="flow-dot">{state === 'done' ? '✓' : i + 1}</span>
            <span>{st.label}</span>
          </li>
        );
      })}
      {exit && <li className="flow-exit">{exit.label}</li>}
    </ol>
  );
}
