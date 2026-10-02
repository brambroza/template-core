import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createService, type Service, type ServiceDefinition } from '@erp/kernel';
import { brokenLinks, endpointsOf, type ModuleUi } from '@erp/ui-schema';

/**
 * UI <-> API contract for every module in this repo (works in a customer's package too):
 * each screen calls a route that really exists, with a permission the module declares,
 * and only looks data up from itself or a core module — so the module stays sellable on its own.
 */
const SERVICES = fileURLToPath(new URL('../../services', import.meta.url));
const ids = readdirSync(SERVICES).filter((d) => existsSync(`${SERVICES}/${d}/src/service.ts`)).sort();
const services = new Map<string, Service>();
const uis = new Map<string, ModuleUi>();

beforeAll(async () => {
  for (const id of ids) {
    const { definition } = (await import(`${SERVICES}/${id}/src/service.ts`)) as { definition: ServiceDefinition };
    const svc = createService(definition, { DATABASE_URL: 'postgres://unused@127.0.0.1:1/x', JWT_SECRET: 'x', INTERNAL_TOKEN: 'x' });
    await svc.app.ready();
    services.set(id, svc);
    if (existsSync(`${SERVICES}/${id}/src/ui.ts`)) uis.set(id, (await import(`${SERVICES}/${id}/src/ui.ts`)).default as ModuleUi);
  }
});
afterAll(async () => { for (const s of services.values()) await s.close(); });

describe.each(ids)('%s screens', (id) => {
  it('module id matches the folder', () => { if (uis.has(id)) expect(uis.get(id)!.module).toBe(id); });

  it('calls only routes that exist', () => {
    const ui = uis.get(id);
    if (!ui) return;
    const missing = endpointsOf(ui).filter((e) => !services.get(e.module)?.app.hasRoute({ method: e.method as 'GET', url: e.path }));
    expect(missing.map((e) => `${e.where}: ${e.method} /${e.module}${e.path}`)).toEqual([]);
  });

  it('looks up data only from itself or core modules', () => {
    const ui = uis.get(id);
    if (!ui) return;
    const own = services.get(id)!.manifest;
    expect(endpointsOf(ui).filter((e) => e.module !== id && !own.requires.includes(e.module)).map((e) => e.where)).toEqual([]);
  });

  it('uses only declared permissions', () => {
    const ui = uis.get(id);
    if (!ui) return;
    const declared = new Set(services.get(id)!.manifest.permissions.map((p) => p.key));
    const used = Object.values(ui.screens).flatMap((s) => [s.perm, ...(s.kind !== 'form' ? (s.actions ?? []).map((a) => a.perm) : []), ...(s.kind === 'list' ? (s.rowActions ?? []).map((a) => a.perm) : [])]);
    expect(used.filter((p) => p && !declared.has(p))).toEqual([]);
  });

  it('has no broken screen links', () => {
    const ui = uis.get(id);
    if (!ui) return;
    expect(brokenLinks(ui)).toEqual([]);
    expect(ui.menu.length).toBeGreaterThan(0);
  });
});
