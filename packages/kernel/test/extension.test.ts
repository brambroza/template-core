import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createService, mergeExtensionManifest, parseGuardKey, validateExtensionManifest, type ModuleManifest, type ServiceDefinition } from '../src/index.ts';
import { bootTestService, type TestService } from '../src/testing.ts';

/** The vendor module: knows nothing about the extension in fixture-ext/ext. */
const vendor: ModuleManifest = {
  id: 'notes', name: 'Notes', nameTh: 'โน้ต', version: '0.0.1', tier: 'feature', description: 'fixture',
  requires: [], enhancedBy: [], publishes: [], subscribes: ['master.item_upserted'], permissions: [{ key: 'notes.note.write', label: 'เขียนโน้ต' }],
};
const def: ServiceDefinition = {
  manifest: vendor,
  migrationsDir: fileURLToPath(new URL('./fixture-ext/migrations', import.meta.url)),
  routes(app, k) {
    app.post('/notes', async (req) => k.db.tx(auth(req).tenantId, async (c) => (await c.query('insert into notes(body) values ($1) returning *', [(req.body as { body: string }).body])).rows[0]));
    app.get('/notes', async (req) => k.db.tx(auth(req).tenantId, async (c) => (await c.query('select * from notes order by body')).rows));
  },
  handlers: {
    'master.item_upserted': async (data, ctx) => { await ctx.client.query('insert into notes(body) values ($1)', [`item ${data.code}`]); },
  },
};
const ENV = { DATABASE_URL: 'postgres://unused@127.0.0.1:1/x', JWT_SECRET: 'x', INTERNAL_TOKEN: 'x' };

let t: TestService;
beforeAll(async () => { t = await bootTestService(def); });
afterAll(async () => { await t?.close(); });

describe('customer extension (ext/)', () => {
  it('applies ext migrations after the vendor ones, tracked separately', async () => {
    const r = await t.svc.db.pool.query<{ name: string }>('select name from _migrations order by applied_at, name');
    expect(r.rows.map((x) => x.name)).toEqual(['001_notes.sql', 'ext/001_priority.sql']);
    expect(await t.svc.migrate()).toEqual([]);
  });

  it('serves ext permissions and events in the manifest, marked as extension', async () => {
    const m = (await t.svc.app.inject({ method: 'GET', url: '/_manifest' })).json() as ModuleManifest;
    expect(m.permissions.map((p) => p.key)).toEqual(expect.arrayContaining(['notes.note.write', 'notes.x_priority.write', 'notes.audit.read']));
    expect(m.subscribes).toEqual(['master.item_upserted', 'sales.invoiced']);
    expect(m.extension).toMatchObject({ permissions: ['notes.x_priority.write'], subscribes: ['master.item_upserted', 'sales.invoiced'] });
  });

  it('adds routes with their own permissions; ext tables are tenant-isolated', async () => {
    const note = (await t.api('POST', '/notes', { body: 'short' })).body;
    expect((await t.api('POST', `/x/notes/${note.id}/priority`, { priority: 3 }, { token: t.token(['notes.note.write']) })).status).toBe(403);
    const ok = await t.api('POST', `/x/notes/${note.id}/priority`, { priority: 3 }, { token: t.token(['notes.x_priority.write']) });
    expect(ok.status).toBe(200);
    expect(ok.body.priority).toBe(3);
    const other = await t.api('POST', `/x/notes/${note.id}/priority`, { priority: 4 }, { token: t.token(['*'], t.otherTenantId) });
    expect(other.body ?? null).toBeNull();
    expect((await t.svc.db.pool.query('select * from note_tags')).rowCount).toBe(0);
  });

  it('guards refuse requests on vendor routes before the vendor code runs', async () => {
    const res = await t.api('POST', '/notes', { body: 'x'.repeat(25) });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('20');
    expect((await t.api('GET', '/notes')).body.some((n: any) => n.body.length > 20)).toBe(false);
  });

  it('runs ext handlers after the vendor handler in the same transaction, and new subscriptions', async () => {
    const data = { itemId: crypto.randomUUID(), code: 'RM-9', name: 'Steel', type: 'raw', uom: 'kg' };
    expect((await t.deliver('master.item_upserted', data)).body.status).toBe('handled');
    const tags = await t.svc.db.tx(t.tenantId, async (c) => (await c.query('select tag from note_tags')).rows);
    expect(tags).toEqual([{ tag: 'item' }]);
    const inv = { invoiceId: crypto.randomUUID(), invoiceNo: 'IV-2569-0001', orderId: crypto.randomUUID(), net: 100, vat: 7, gross: 107 };
    expect((await t.deliver('sales.invoiced', inv)).body.status).toBe('handled');
    expect((await t.api('GET', '/notes')).body.find((n: any) => n.body === 'invoice IV-2569-0001')?.priority).toBe(5);
  });

  it('can be switched off to test the vendor base alone', async () => {
    const svc = createService({ ...def, extDir: false }, ENV);
    await svc.app.ready();
    expect(svc.manifest.extension).toBeUndefined();
    expect(svc.app.hasRoute({ method: 'POST', url: '/x/notes/:id/priority' })).toBe(false);
    await svc.close();
  });
});

describe('extension mistakes fail loudly', () => {
  const tmpModule = (ext: Record<string, string>) => {
    const root = mkdtempSync(join(tmpdir(), 'ext-'));
    mkdirSync(join(root, 'migrations'));
    mkdirSync(join(root, 'ext'));
    for (const [f, body] of Object.entries(ext)) writeFileSync(join(root, 'ext', f), body);
    return { ...def, migrationsDir: join(root, 'migrations') } satisfies ServiceDefinition;
  };
  const kernelUrl = new URL('../src/index.ts', import.meta.url).href;

  it('a guard on a route that does not exist', async () => {
    const svc = createService(tmpModule({ 'index.ts': `import { defineExtension } from '${kernelUrl}';\nexport default defineExtension({ guards: { 'POST /notez': async () => {} } });\n` }), ENV);
    await expect(svc.app.ready()).rejects.toThrow(/guard "POST \/notez" matches no route/);
    await svc.close().catch(() => {});
  });

  it('handlers that do not match ext.json subscribes', async () => {
    const svc = createService(tmpModule({
      'ext.json': JSON.stringify({ subscribes: ['sales.invoiced'] }),
      'index.ts': `import { defineExtension } from '${kernelUrl}';\nexport default defineExtension({ handlers: {} });\n`,
    }), ENV);
    await expect(svc.app.ready()).rejects.toThrow(/must match ext handlers/);
    await svc.close().catch(() => {});
  });

  it('a route that overrides a vendor route', async () => {
    const svc = createService(tmpModule({ 'index.ts': `import { defineExtension } from '${kernelUrl}';\nexport default defineExtension({ routes(app) { app.post('/notes', async () => ({})); } });\n` }), ENV);
    await expect(svc.app.ready()).rejects.toThrow();
    await svc.close().catch(() => {});
  });

  it('bad ext.json: foreign prefix, duplicate vendor permission, unknown event, subscriptions without code', () => {
    expect(() => validateExtensionManifest({ permissions: [{ key: 'sales.x.write', label: 'x' }] }, vendor)).toThrow(/prefixed with "notes\."/);
    expect(() => validateExtensionManifest({ permissions: [{ key: 'notes.note.write', label: 'x' }] }, vendor)).toThrow(/already exists/);
    expect(() => validateExtensionManifest({ publishes: ['notes.made_up' as never] }, vendor)).toThrow(/unknown event/);
    expect(() => createService(tmpModule({ 'ext.json': JSON.stringify({ subscribes: ['sales.invoiced'] }) }), ENV)).toThrow(/no ext\/index.ts/);
    expect(() => parseGuardKey('approve purchase order')).toThrow(/METHOD \/path/);
    expect(mergeExtensionManifest(vendor, null)).toBe(vendor);
  });
});
