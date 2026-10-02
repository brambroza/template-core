import { auth, loadManifest, one, parse, requirePerm, s, z, type Client, type Kernel, type ServiceDefinition } from '@erp/kernel';
import { isValidThaiTaxId } from '@erp/thai';
import { fileURLToPath } from 'node:url';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const ItemInput = z.object({
  code: s.code,
  name: s.name,
  type: z.enum(['raw', 'semi', 'finished', 'spare', 'service']),
  uom: z.string().trim().min(1).max(20).default('pcs'),
  stdPrice: s.money.nullable().optional(),
  active: z.boolean().optional(),
});
const PartnerInput = z.object({
  code: s.code,
  name: s.name,
  kind: z.enum(['customer', 'supplier', 'both']),
  taxId: z.string().trim().refine(isValidThaiTaxId, 'invalid Thai tax ID').nullable().optional(),
  branch: z.string().regex(/^\d{5}$/).optional(),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().email().nullable().optional(),
  active: z.boolean().optional(),
});
const ListQuery = s.listQuery.extend({ type: z.string().optional(), kind: z.string().optional() });

const ITEM_COLS = { code: 'code', name: 'name', type: 'type', uom: 'uom', stdPrice: 'std_price', active: 'active' } as const;
const PARTNER_COLS = { code: 'code', name: 'name', kind: 'kind', taxId: 'tax_id', branch: 'branch', address: 'address', phone: 'phone', email: 'email', active: 'active' } as const;

/** Build "insert" / "update set" fragments from a validated body and a field->column map. */
function columns(body: Record<string, unknown>, map: Record<string, string>) {
  const keys = Object.keys(map).filter((k) => body[k] !== undefined);
  return { cols: keys.map((k) => map[k]), values: keys.map((k) => body[k]) };
}

async function emitItem(k: Kernel, c: Client, row: any) {
  await k.emit(c, 'master.item_upserted', { itemId: row.id, code: row.code, name: row.name, type: row.type, uom: row.uom });
}
async function emitPartner(k: Kernel, c: Client, row: any) {
  await k.emit(c, 'master.partner_upserted', { partnerId: row.id, code: row.code, name: row.name, kind: row.kind, taxId: row.tax_id });
}

/** Registers list/get/create/update for one master table. */
function crud(app: Parameters<ServiceDefinition['routes']>[0], k: Kernel, cfg: {
  path: string; table: string; perm: string; label: string; input: z.ZodObject<any>; map: Record<string, string>;
  filter: (q: z.infer<typeof ListQuery>) => [string, unknown] | null; publish: (k: Kernel, c: Client, row: any) => Promise<void>;
}) {
  app.get(cfg.path, async (req) => {
    const a = auth(req);
    requirePerm(a, `${cfg.perm}.read`);
    const q = parse(ListQuery, req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.q) { params.push(`%${q.q}%`); where.push(`(code ilike $${params.length} or name ilike $${params.length})`); }
    const f = cfg.filter(q);
    if (f) { params.push(f[1]); where.push(`${f[0]} = $${params.length}`); }
    params.push(q.limit, q.offset);
    return k.db.tx(a.tenantId, async (c) => (await c.query(
      `select * from ${cfg.table} ${where.length ? 'where ' + where.join(' and ') : ''} order by code limit $${params.length - 1} offset $${params.length}`, params)).rows);
  });

  app.get(`${cfg.path}/:id`, async (req) => {
    const a = auth(req);
    requirePerm(a, `${cfg.perm}.read`);
    const { id } = parse(z.object({ id: s.uuid }), req.params);
    return k.db.tx(a.tenantId, (c) => one(c, `select * from ${cfg.table} where id = $1`, [id], cfg.label));
  });

  app.post(cfg.path, async (req, reply) => {
    const a = auth(req);
    requirePerm(a, `${cfg.perm}.write`);
    const { cols, values } = columns(parse(cfg.input, req.body), cfg.map);
    reply.code(201);
    return k.db.tx(a.tenantId, async (c) => {
      const row = (await c.query(`insert into ${cfg.table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, values)).rows[0];
      await cfg.publish(k, c, row);
      return row;
    });
  });

  app.patch(`${cfg.path}/:id`, async (req) => {
    const a = auth(req);
    requirePerm(a, `${cfg.perm}.write`);
    const { id } = parse(z.object({ id: s.uuid }), req.params);
    const { cols, values } = columns(parse(cfg.input.partial(), req.body), cfg.map);
    return k.db.tx(a.tenantId, async (c) => {
      const set = [...cols.map((col, i) => `${col} = $${i + 2}`), 'updated_at = now()'].join(', ');
      const row = await one(c, `update ${cfg.table} set ${set} where id = $1 returning *`, [id, ...values], cfg.label);
      await cfg.publish(k, c, row);
      return row;
    });
  });
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'master.item.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select (select count(*)::int from items where active) as items, (select count(*)::int from partners where active and kind in ('customer', 'both')) as customers,
                (select count(*)::int from partners where active and kind in ('supplier', 'both')) as suppliers`)).rows[0]);
    });

    crud(app, k, { path: '/items', table: 'items', perm: 'master.item', label: 'Item', input: ItemInput, map: ITEM_COLS, filter: (q) => (q.type ? ['type', q.type] : null), publish: emitItem });
    crud(app, k, { path: '/partners', table: 'partners', perm: 'master.partner', label: 'Partner', input: PartnerInput, map: PARTNER_COLS, filter: (q) => (q.kind ? ['kind', q.kind] : null), publish: emitPartner });
  },
};
