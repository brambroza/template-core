import { auth, badRequest, loadManifest, one, parse, requirePerm, s, z, type Client, type Kernel, type ServiceDefinition } from '@erp/kernel';
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

export const IMPORT_MAX_ROWS = 2000;
const ImportBody = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(IMPORT_MAX_ROWS),
  dryRun: z.boolean().optional(),
});

/** Exported lists show Thai names for codes; accept them back on import. */
const ITEM_TYPE_TH: Record<string, string> = { 'วัตถุดิบ': 'raw', 'กึ่งสำเร็จรูป': 'semi', 'สินค้าสำเร็จรูป': 'finished', 'อะไหล่': 'spare', 'บริการ': 'service' };
const KIND_TH: Record<string, string> = { 'ลูกค้า': 'customer', 'ผู้ขาย': 'supplier', 'ลูกค้าและผู้ขาย': 'both' };
const fromThai = (map: Record<string, string>, v: unknown) => (typeof v === 'string' ? map[v.trim()] ?? v : v);

function normalizeItem(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, type: fromThai(ITEM_TYPE_TH, row.type) };
}

/** Partner cells as Excel tends to mangle them: leading zeros dropped, tax ID typed with dashes. */
function normalizePartner(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row, kind: fromThai(KIND_TH, row.kind) };
  if (typeof out.taxId === 'string') {
    const digits = out.taxId.replace(/[\s-]/g, '');
    out.taxId = /^\d{12}$/.test(digits) ? `0${digits}` : digits;
  }
  if (typeof out.branch === 'string' && /^\d{1,5}$/.test(out.branch.trim())) out.branch = out.branch.trim().padStart(5, '0');
  return out;
}

/** The base type behind optional/nullable/default/effects wrappers. */
function baseType(t: z.ZodTypeAny): z.ZodTypeAny {
  let cur: any = t;
  while (cur?._def?.innerType || cur?._def?.schema) cur = cur._def.innerType ?? cur._def.schema;
  return cur;
}

const TRUE = new Set(['true', '1', 'yes', 'y', 'ใช่', 'ใช้งาน', 'x', '✓']);
const FALSE = new Set(['false', '0', 'no', 'n', 'ไม่ใช่', 'ไม่ใช้งาน', 'เลิกใช้']);

/**
 * A row from a CSV file has text in every cell: turn it into what the create schema expects
 * (blank -> absent, "1,250.50" -> 1250.5, ใช่/ไม่ใช่ -> boolean). Anything unparseable is left as is so validation reports it.
 */
function coerceRow(schema: z.ZodObject<any>, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, type] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    let v = raw[key];
    if (typeof v === 'string') {
      v = v.trim();
      const base = baseType(type);
      if (v === '') v = undefined;
      else if (base instanceof z.ZodNumber) { const n = Number(String(v).replace(/,/g, '')); if (Number.isFinite(n)) v = n; }
      else if (base instanceof z.ZodBoolean) { const b = String(v).toLowerCase(); if (TRUE.has(b)) v = true; else if (FALSE.has(b)) v = false; }
      else if (base instanceof z.ZodEnum) v = (base.options as string[]).find((o) => o.toLowerCase() === String(v).toLowerCase()) ?? v;
    }
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Thai wording for the validation problems a person can fix in their spreadsheet. */
function thaiIssue(issue: z.ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type': return issue.received === 'undefined' ? 'ต้องกรอก' : 'รูปแบบไม่ถูกต้อง';
    case 'invalid_enum_value': return `ต้องเป็นหนึ่งใน ${issue.options.join(', ')}`;
    case 'too_small': return issue.type === 'string' ? 'ต้องกรอก' : `ต้องไม่น้อยกว่า ${issue.minimum}`;
    case 'too_big': return issue.type === 'string' ? `ยาวเกิน ${issue.maximum} ตัวอักษร` : `ต้องไม่เกิน ${issue.maximum}`;
    case 'invalid_string': return issue.validation === 'email' ? 'อีเมลไม่ถูกต้อง' : 'รูปแบบไม่ถูกต้อง';
    case 'custom': return issue.message === 'invalid Thai tax ID' ? 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง' : issue.message;
    default: return issue.message;
  }
}

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
  normalize?: (row: Record<string, unknown>) => Record<string, unknown>;
}) {
  /**
   * Bulk upsert by code from a spreadsheet: every row is validated with the create schema; a dry run only reports
   * (errors + how many rows would be created/updated); a real run writes all rows in one transaction or none.
   */
  app.post(`${cfg.path}/import`, async (req) => {
    const a = auth(req);
    requirePerm(a, `${cfg.perm}.write`);
    const body = parse(ImportBody, req.body);
    const errors: { row: number; field?: string; message: string }[] = [];
    const valid: { data: Record<string, any>; provided: string[] }[] = [];
    const seen = new Map<string, number>();
    body.rows.forEach((raw, i) => {
      const row = i + 1;
      const input = coerceRow(cfg.input, cfg.normalize ? cfg.normalize(raw) : raw);
      const r = cfg.input.safeParse(input);
      if (!r.success) {
        for (const issue of r.error.issues) errors.push({ row, ...(issue.path.length ? { field: issue.path.join('.') } : {}), message: thaiIssue(issue) });
        return;
      }
      const first = seen.get(r.data.code);
      if (first) return void errors.push({ row, field: 'code', message: `รหัสซ้ำกับแถวที่ ${first}` });
      seen.set(r.data.code, row);
      valid.push({ data: r.data, provided: Object.keys(input) });
    });
    if (!body.dryRun && errors.length) throw badRequest(`Import rejected: ${errors.length} problem(s) in the file, nothing was saved`, { errors });

    return k.db.tx(a.tenantId, async (c) => {
      const existing = new Set((await c.query(`select code from ${cfg.table} where code = any($1)`, [valid.map((v) => v.data.code)])).rows.map((r) => r.code));
      const updated = valid.filter((v) => existing.has(v.data.code)).length;
      const result = { dryRun: !!body.dryRun, total: body.rows.length, created: valid.length - updated, updated, errors };
      if (body.dryRun) return result;
      for (const v of valid) {
        const { cols, values } = columns(v.data, cfg.map);
        // an existing record only changes in the columns the file actually filled (defaults don't overwrite)
        const set = [...Object.keys(cfg.map).filter((f) => f !== 'code' && v.provided.includes(f)).map((f) => `${cfg.map[f]} = excluded.${cfg.map[f]}`), 'updated_at = now()'];
        const row = (await c.query(
          `insert into ${cfg.table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
           on conflict (tenant_id, code) do update set ${set.join(', ')} returning *`, values)).rows[0];
        await cfg.publish(k, c, row);
      }
      return result;
    });
  });

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

    crud(app, k, { path: '/items', table: 'items', perm: 'master.item', label: 'Item', input: ItemInput, map: ITEM_COLS, filter: (q) => (q.type ? ['type', q.type] : null), publish: emitItem, normalize: normalizeItem });
    crud(app, k, { path: '/partners', table: 'partners', perm: 'master.partner', label: 'Partner', input: PartnerInput, map: PARTNER_COLS, filter: (q) => (q.kind ? ['kind', q.kind] : null), publish: emitPartner, normalize: normalizePartner });
  },
};
