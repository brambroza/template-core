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
const defs = new Map<string, ServiceDefinition>();

beforeAll(async () => {
  for (const id of ids) {
    const { definition } = (await import(`${SERVICES}/${id}/src/service.ts`)) as { definition: ServiceDefinition };
    const svc = createService(definition, { DATABASE_URL: 'postgres://unused@127.0.0.1:1/x', JWT_SECRET: 'x', INTERNAL_TOKEN: 'x' });
    await svc.app.ready();
    services.set(id, svc);
    defs.set(id, definition);
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
    const used = Object.values(ui.screens).flatMap((s) => [s.perm, ...(s.kind !== 'form' ? (s.actions ?? []).map((a) => a.perm) : []), ...(s.kind === 'list' ? [...(s.rowActions ?? []).map((a) => a.perm), s.import?.perm] : []), s.kind === 'detail' ? s.attachments?.perm : undefined])
      .concat((ui.todo ?? []).flatMap((t) => [t.perm, ...(t.actions ?? []).map((a) => a.perm)]));
    expect(used.filter((p) => p && !declared.has(p))).toEqual([]);
  });

  it('imports into a real POST route of the module itself', () => {
    const ui = uis.get(id);
    if (!ui) return;
    const svc = services.get(id)!;
    const bad = Object.entries(ui.screens).flatMap(([sid, s]) => (s.kind === 'list' && s.import ? [[sid, s.import] as const] : []))
      .filter(([, imp]) => !imp.endpoint.startsWith('/') || !svc.app.hasRoute({ method: 'POST', url: imp.endpoint }))
      .map(([sid, imp]) => `${id}.${sid}.import: POST /${id}${imp.endpoint}`);
    expect(bad).toEqual([]);
  });

  it('shows attachments only for entities the module opted in to', () => {
    const ui = uis.get(id);
    if (!ui) return;
    const entities = Object.keys(defs.get(id)!.attachments?.entities ?? {});
    const bad = Object.entries(ui.screens).flatMap(([sid, s]) => {
      if (s.kind !== 'detail' || !s.attachments) return [];
      if (!entities.includes(s.attachments.entity)) return [`${id}.${sid}: entity "${s.attachments.entity}" is not in the service's attachments.entities [${entities.join(', ')}]`];
      // the record id comes from the screen's id, which fills the endpoint's first :param
      if (!/:[A-Za-z]/.test(s.endpoint)) return [`${id}.${sid}: attachments need an endpoint with a :param (the record id)`];
      return [];
    });
    expect(bad).toEqual([]);
  });

  it('has no broken screen links', () => {
    const ui = uis.get(id);
    if (!ui) return;
    expect(brokenLinks(ui)).toEqual([]);
    expect(ui.menu.length).toBeGreaterThan(0);
  });
});
