import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, type ModuleManifest } from '@erp/kernel';

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export interface Catalog {
  currency: string;
  platform: { id: string; name: string; nameTh: string; modules: string[]; price: number; description: string };
  modules: Record<string, { price: number }>;
  bundles: { id: string; nameTh: string; modules: string[]; price: number }[];
  updatePlanPct: number;
  services: Record<string, unknown>;
}

export function loadManifests(root = REPO_ROOT): ModuleManifest[] {
  const dir = join(root, 'services');
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'module.json')))
    .map((d) => {
      const m = JSON.parse(readFileSync(join(dir, d.name, 'module.json'), 'utf8')) as ModuleManifest;
      validateManifest(m);
      if (m.id !== d.name) throw new Error(`services/${d.name}/module.json has id "${m.id}" (must equal folder name)`);
      return m;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function loadCatalog(root = REPO_ROOT): Catalog {
  const path = join(root, 'catalog', 'catalog.json');
  if (!existsSync(path)) throw new Error('Pricing (catalog/catalog.json) is not part of this installation — ask GO Along for a quote');
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Expand a customer's picks: add core modules and every transitive `requires`. */
export function resolveSelection(picked: string[], manifests: ModuleManifest[]): string[] {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const out = new Set<string>();
  const visit = (id: string) => {
    const m = byId.get(id);
    if (!m) throw new Error(`Unknown module "${id}". Available: ${[...byId.keys()].join(', ')}`);
    if (out.has(id)) return;
    out.add(id);
    m.requires.forEach(visit);
  };
  manifests.filter((m) => m.tier === 'core').forEach((m) => visit(m.id));
  picked.forEach(visit);
  return [...out].sort((a, b) => (byId.get(a)!.tier === 'core' ? 0 : 1) - (byId.get(b)!.tier === 'core' ? 0 : 1) || a.localeCompare(b));
}

export interface Quote {
  lines: { label: string; price: number }[];
  total: number;
  yearlyUpdates: number;
  currency: string;
}

/** Cheapest combination of bundles + single modules covering the selected feature modules. */
export function quote(selected: string[], manifests: ModuleManifest[], catalog: Catalog): Quote {
  const features = resolveSelection(selected, manifests).filter((id) => manifests.find((m) => m.id === id)!.tier === 'feature');
  const missingPrice = features.filter((id) => !catalog.modules[id]);
  if (missingPrice.length) throw new Error(`No price in catalog.json for: ${missingPrice.join(', ')}`);
  let best: { lines: Quote['lines']; total: number } | null = null;
  const bundles = catalog.bundles.filter((b) => b.modules.every((m) => features.includes(m)));
  for (let mask = 0; mask < 1 << bundles.length; mask++) {
    const chosen = bundles.filter((_, i) => mask & (1 << i));
    const covered = chosen.flatMap((b) => b.modules);
    if (new Set(covered).size !== covered.length) continue; // bundles must not overlap
    const lines = [
      ...chosen.map((b) => ({ label: `Bundle: ${b.nameTh} (${b.modules.join(', ')})`, price: b.price })),
      ...features.filter((f) => !covered.includes(f)).map((f) => ({ label: `Module: ${f}`, price: catalog.modules[f].price })),
    ];
    const total = lines.reduce((a, l) => a + l.price, 0);
    if (!best || total < best.total) best = { lines, total };
  }
  const lines = [{ label: `${catalog.platform.nameTh} (${catalog.platform.modules.join(', ')})`, price: catalog.platform.price }, ...best!.lines];
  const total = lines.reduce((a, l) => a + l.price, 0);
  return { lines, total, yearlyUpdates: Math.round((total * catalog.updatePlanPct) / 100), currency: catalog.currency };
}
