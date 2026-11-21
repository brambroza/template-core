import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, conflict, hasPerm, parse, z, type ServiceDefinition } from '../src/index.ts';
import { bootTestService, type TestService } from '../src/testing.ts';

/** A module that publishes and consumes master.item_upserted, with a dry-runnable route and an impact describer. */
const def: ServiceDefinition = {
  manifest: {
    id: 'notes', name: 'Notes', nameTh: 'โน้ต', version: '0.0.1', tier: 'feature', description: 'fixture',
    requires: [], enhancedBy: [], publishes: ['master.item_upserted'], subscribes: ['master.item_upserted'],
    permissions: [{ key: 'notes.read', label: 'อ่านโน้ต' }],
  },
  migrationsDir: fileURLToPath(new URL('./fixture/migrations', import.meta.url)),
  routes(app, k) {
    app.post('/notes', { config: { dryRun: true } }, async (req) => {
      const a = auth(req);
      const body = parse(z.object({ body: z.string() }), req.body);
      return k.db.tx(a.tenantId, async (c) => {
        if (body.body === 'dup' && (await c.query(`select 1 from notes where body = 'dup'`)).rowCount) throw conflict('มีโน้ตนี้แล้ว');
        const row = (await c.query('insert into notes(body) values ($1) returning *', [body.body])).rows[0];
        await k.emit(c, 'master.item_upserted', { itemId: row.id, code: body.body, name: body.body, type: 'raw', uom: 'pcs' });
        return row;
      });
    });
    // not opted in: ?_dryRun=1 is ignored, the note is saved
    app.post('/plain', async (req) => k.db.tx(auth(req).tenantId, async (c) => (await c.query(`insert into notes(body) values ('plain') returning *`)).rows[0]));
    app.get('/notes', async (req) => k.db.tx(auth(req).tenantId, async (c) => (await c.query('select body from notes order by body')).rows.map((r) => r.body)));
  },
  handlers: {
    'master.item_upserted': async (data, ctx) => { await ctx.client.query('insert into notes(body) values ($1)', [`item ${data.code}`]); },
  },
  impact: {
    'master.item_upserted': async (data, ctx) => {
      if (!hasPerm(ctx.auth, 'notes.read')) return [];
      const before = (await ctx.client.query('select count(*)::int as n from notes')).rows[0].n;
      await ctx.run();
      const after = (await ctx.client.query('select count(*)::int as n from notes')).rows[0].n;
      return [{ text: `โน้ต ${before} → ${after} (เพิ่ม "item ${data.code}")`, tone: 'ok' }];
    },
  },
};

let t: TestService;
beforeAll(async () => { t = await bootTestService(def); });
afterAll(async () => { await t?.close(); });

describe('impact preview', () => {
  it('dry-runs an opted-in route: same answer and checks, captured events, nothing saved, nothing published, no audit', async () => {
    const dry = await t.api('POST', '/notes?_dryRun=1', { body: 'first' });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, result: { body: 'first' }, events: [{ type: 'master.item_upserted', data: { code: 'first' } }] });
    expect((await t.api('GET', '/notes')).body).toEqual([]);
    expect(await t.published('master.item_upserted')).toEqual([]);
    const audit = await t.svc.db.tx(t.tenantId, async (c) => (await c.query(`select route from _audit`)).rows.map((r) => r.route));
    expect(audit).toEqual([]);

    // validation and business rules run as usual
    expect((await t.api('POST', '/notes?_dryRun=1', {})).status).toBe(400);
    await t.api('POST', '/notes', { body: 'dup' });
    const refused = await t.api('POST', '/notes?_dryRun=1', { body: 'dup' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toBe('มีโน้ตนี้แล้ว');

    // a route that did not opt in ignores the flag
    expect((await t.api('POST', '/plain?_dryRun=1')).body).toMatchObject({ body: 'plain' });
    expect((await t.api('GET', '/notes')).body).toEqual(['dup', 'plain']);
  });

  it('describes what the module would do with an event, rolled back, within the caller\'s permissions', async () => {
    const event = { type: 'master.item_upserted', data: { itemId: '00000000-0000-4000-8000-000000000001', code: 'X1', name: 'X1', type: 'raw', uom: 'pcs' } };
    const r = await t.api('POST', '/_impact', event);
    expect(r.body).toEqual({ module: 'notes', lines: [{ text: 'โน้ต 2 → 3 (เพิ่ม "item X1")', tone: 'ok' }] });
    expect((await t.api('GET', '/notes')).body).toEqual(['dup', 'plain']);
    expect(await t.svc.db.tx(t.tenantId, async (c) => (await c.query(`select count(*)::int as n from _audit where route like '/_impact%'`)).rows[0].n)).toBe(0);
    expect((await t.api('POST', '/_impact', event, { token: t.token(['other.read']) })).body.lines).toEqual([]);
    expect((await t.api('POST', '/_impact', { type: 'sales.invoiced', data: {} })).body).toEqual({ module: 'notes', lines: [] });
    expect((await t.api('POST', '/_impact', { type: 'nope', data: {} })).status).toBe(400);
    expect((await t.api('POST', '/_impact', { type: 'master.item_upserted', data: { code: 1 } })).status).toBe(400);
  });
});
