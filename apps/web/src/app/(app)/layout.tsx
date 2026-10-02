'use client';

import type { ReactNode } from 'react';
import { Shell } from '@/components/Shell';
import { RegistryProvider } from '@/lib/registry';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RegistryProvider>
      <Shell>{children}</Shell>
    </RegistryProvider>
  );
}
