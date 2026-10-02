'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ModuleUi } from '@erp/ui-schema';
import { moduleUis } from '../modules.generated';
import { api } from './api';

export interface CatalogModule {
  id: string;
  name: string;
  nameTh: string;
  version: string;
  tier: 'core' | 'feature';
  permissions: { key: string; label: string }[];
}

/** Business order of the menu; anything else goes before the core modules. */
const ORDER = ['crm', 'sales', 'purchasing', 'inventory', 'production', 'quality', 'maintenance', 'costing', 'projects', 'helpdesk', 'approvals', 'expense', 'hr', 'assets', 'booking', 'automation'];
const CORE_LAST = ['master-data', 'identity'];

interface Registry {
  /** installed (per gateway) AND shipped with screens (per this build) */
  modules: ModuleUi[];
  catalog: CatalogModule[];
  loading: boolean;
  error: string | null;
  ui(id: string): ModuleUi | undefined;
  installed(id: string): boolean;
}

const Ctx = createContext<Registry | null>(null);

export function RegistryProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<CatalogModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ modules: CatalogModule[] }>('_catalog', '')
      .then((r) => setCatalog(r.modules))
      .catch(() => setError('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบว่า gateway ทำงานอยู่'))
      .finally(() => setLoading(false));
  }, []);

  const ids = new Set(catalog.map((m) => m.id));
  const rank = (id: string) => (CORE_LAST.includes(id) ? 100 + CORE_LAST.indexOf(id) : ORDER.includes(id) ? ORDER.indexOf(id) : 50);
  const modules = moduleUis.filter((m) => ids.has(m.module)).sort((a, b) => rank(a.module) - rank(b.module));

  return (
    <Ctx.Provider value={{ modules, catalog, loading, error, ui: (id) => modules.find((m) => m.module === id), installed: (id) => ids.has(id) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useRegistry(): Registry {
  const r = useContext(Ctx);
  if (!r) throw new Error('RegistryProvider missing');
  return r;
}
