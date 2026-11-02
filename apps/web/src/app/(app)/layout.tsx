'use client';

import type { ReactNode } from 'react';
import { MotionConfig } from 'motion/react';
import { Shell } from '@/components/Shell';
import { RegistryProvider } from '@/lib/registry';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <RegistryProvider>
        <Shell>{children}</Shell>
      </RegistryProvider>
    </MotionConfig>
  );
}
