'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { enterPage } from '@/lib/motion';

/** Re-mounted on every navigation: gives each page the same short entrance. */
export default function PageTemplate({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (ref.current) enterPage(ref.current); }, []);
  return <div ref={ref}>{children}</div>;
}
