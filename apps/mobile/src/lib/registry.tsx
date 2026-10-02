import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ModuleUi } from '@erp/ui-schema';
import { moduleUis } from '../modules.generated';
import { api } from './api';

interface Registry {
  modules: ModuleUi[];
  loading: boolean;
  error: string | null;
  ui(id: string): ModuleUi | undefined;
  reload(): void;
}

const ORDER = ['approvals', 'hr', 'maintenance', 'quality', 'inventory', 'helpdesk', 'booking', 'expense', 'production', 'purchasing', 'sales', 'crm', 'projects', 'assets', 'costing', 'automation', 'master-data', 'identity'];
const Ctx = createContext<Registry | null>(null);

/** Installed modules (from the gateway catalog) that this app build has screens for. */
export function RegistryProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setLoading(true);
    api<{ modules: { id: string }[] }>('_catalog', '')
      .then((r) => { setIds(r.modules.map((m) => m.id)); setError(null); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tick]);
  const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : 50);
  const modules = moduleUis.filter((m) => ids.includes(m.module)).sort((a, b) => rank(a.module) - rank(b.module));
  return <Ctx.Provider value={{ modules, loading, error, ui: (id) => modules.find((m) => m.module === id), reload: () => setTick((t) => t + 1) }}>{children}</Ctx.Provider>;
}

export function useRegistry(): Registry {
  const r = useContext(Ctx);
  if (!r) throw new Error('RegistryProvider missing');
  return r;
}
