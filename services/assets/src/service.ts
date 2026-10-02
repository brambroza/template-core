import { auth, badRequest, conflict, loadManifest, nextDocNo, one, parse, requirePerm, s, z, type Client, type Kernel, type ServiceDefinition } from '@erp/kernel';
import { fileURLToPath } from 'node:url';
import { bookValueAt, closedMonthIndex, depreciationIn, monthIndex, monthlyAmount, periodOf, round2, schedule } from './depreciation.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- input schemas ---------------- */

const text = (max: number) => z.string().trim().max(max);
const ListQuery = s.listQuery.extend({ limit: z.coerce.number().int().min(1).max(500).default(200) });
const IdParam = z.object({ id: s.uuid });
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM');
const Method = z.enum(['straight_line', 'none']);

const CategoryInput = z.object({
  code: s.code,
  name: s.name,
  usefulLifeYears: z.number().int().min(0).max(100).default(5),
  method: Method.default('straight_line'),
  salvagePct: z.number().finite().min(0).max(99.99).default(0),
});

const AssetInput = z.object({
  /** omit to get AS-2569-0001 */
  code: s.code.optional(),
  name: s.name,
  categoryId: s.uuid,
  serialNo: text(100).nullable().optional(),
  brand: text(100).nullable().optional(),
  model: text(100).nullable().optional(),
  location: text(200).nullable().optional(),
  purchaseDate: s.isoDate,
  cost: s.money,
  /** omit = cost × category salvage % */
  salvageValue: s.money.optional(),
  /** omit = the category's useful life */
  usefulLifeYears: z.number().int().min(0).max(100).optional(),
  supplierName: text(200).nullable().optional(),
  warrantyUntil: s.isoDate.nullable().optional(),
  custodianId: s.uuid.nullable().optional(),
  custodianName: text(200).nullable().optional(),
  note: text(2000).nullable().optional(),
});
const AssetPatch = z.object({
  name: s.name.optional(),
  serialNo: text(100).nullable().optional(),
  brand: text(100).nullable().optional(),
  model: text(100).nullable().optional(),
  supplierName: text(200).nullable().optional(),
  warrantyUntil: s.isoDate.nullable().optional(),
  note: text(2000).nullable().optional(),
});
const AssetList = ListQuery.extend({
  status: z.enum(['in_use', 'in_storage', 'in_repair', 'disposed', 'lost']).optional(),
  categoryId: s.uuid.optional(),
  location: z.string().optional(),
  custodianId: s.uuid.optional(),
  /** "true" = warranty ends within 30 days */
  warrantyExpiring: z.enum(['true', 'false']).optional(),
  /** "true" = hide disposed assets */
  active: z.enum(['true', 'false']).optional(),
});
const AssignInput = z.object({
  custodianId: s.uuid.nullable().optional(),
  custodianName: text(200).nullable().optional(),
  location: text(200).nullable().optional(),
  assignedOn: s.isoDate.optional(),
  note: text(1000).nullable().optional(),
});
const RepairInput = z.object({
  repairDate: s.isoDate.optional(),
  description: z.string().trim().min(1).max(2000),
  vendor: text(200).nullable().optional(),
  cost: s.money.default(0),
  /** true = log a repair that is already finished (asset status unchanged) */
  completed: z.boolean().default(false),
});
const CompleteRepairInput = z.object({ cost: s.money.optional(), completedOn: s.isoDate.optional(), vendor: text(200).nullable().optional() });
const DisposeInput = z.object({
  disposedOn: s.isoDate,
  method: z.enum(['sold', 'scrapped', 'donated']),
  price: s.money.default(0),
  note: text(1000).nullable().optional(),
});
const AuditInput = z.object({ location: z.string().trim().min(1).max(200), note: text(1000).nullable().optional() });

/* ---------------- helpers ---------------- */

const ASSET_SELECT = `select a.*, c.code as category_code, c.name as category_name from assets a join asset_categories c on c.id = a.category_id`;
const like = (q?: string) => (q ? `%${q}%` : null);
const today = async (c: Client): Promise<string> => (await c.query(`select current_date::text as d`)).rows[0].d;

/** Add live depreciation numbers (as of `asOf`) to an asset row. */
function withBook(a: any, asOf: string) {
  const rows = schedule(a);
  const { accumulated, book_value } = bookValueAt(a, asOf, rows);
  const monthsTotal = a.method === 'straight_line' ? a.useful_life_years * 12 : 0;
  const closed = closedMonthIndex(asOf);
  const used = rows.filter((r) => monthIndex(`${r.period}-01`) <= closed).length;
  return {
    ...a, accumulated, book_value: a.status === 'disposed' ? 0 : book_value, monthly_depreciation: monthlyAmount(a),
    months_left: Math.max(0, monthsTotal - used), warranty_active: !!a.warranty_until && a.warranty_until >= asOf,
  };
}

async function loadAsset(c: Client, id: string, lock = false) {
  if (lock) await one(c, 'select id from assets where id = $1 for update', [id], 'Asset');
  const a = await one(c, `${ASSET_SELECT} where a.id = $1`, [id], 'Asset');
  return detail(c, a);
}

async function detail(c: Client, a: any) {
  const out: any = withBook(a, await today(c));
  out.assignments = (await c.query('select * from asset_assignments where asset_id = $1 order by assigned_on desc, created_at desc', [a.id])).rows;
  out.repairs = (await c.query('select * from asset_repairs where asset_id = $1 order by repair_date desc, created_at desc', [a.id])).rows;
  out.repair_cost_total = round2(out.repairs.reduce((n: number, r: any) => n + r.cost, 0));
  out.open_repairs = out.repairs.filter((r: any) => r.status === 'open').length;
  return out;
}

function assertWorkable(a: { code: string; status: string }, what: string, allowLost = false) {
  if (a.status === 'disposed') throw conflict(`Cannot ${what} ${a.code}: asset is disposed`);
  if (a.status === 'lost' && !allowLost) throw conflict(`Cannot ${what} ${a.code}: asset is lost`);
}

async function reportRepair(k: Kernel, c: Client, assetId: string, b: z.infer<typeof RepairInput>, userId: string) {
  const a = await one(c, 'select id, code, name, status from assets where id = $1 for update', [assetId], 'Asset');
  assertWorkable(a, 'repair');
  const date = b.repairDate ?? (await today(c));
  if (b.completed) {
    await c.query(
      `insert into asset_repairs (asset_id, repair_date, description, vendor, cost, status, completed_on, reported_by) values ($1,$2,$3,$4,$5,'done',$2,$6)`,
      [assetId, date, b.description, b.vendor ?? null, b.cost, userId]);
  } else {
    const prev = a.status === 'in_repair'
      ? (await c.query(`select prev_status from asset_repairs where asset_id = $1 and status = 'open' order by created_at limit 1`, [assetId])).rows[0]?.prev_status ?? 'in_storage'
      : a.status;
    await c.query(
      `insert into asset_repairs (asset_id, repair_date, description, vendor, cost, prev_status, reported_by) values ($1,$2,$3,$4,$5,$6,$7)`,
      [assetId, date, b.description, b.vendor ?? null, b.cost, prev, userId]);
    await c.query(`update assets set status = 'in_repair' where id = $1`, [assetId]);
    await k.emit(c, 'assets.repair_reported', { assetId: a.id, code: a.code, name: a.name, description: b.description });
  }
  return loadAsset(c, assetId);
}

async function loadAudit(c: Client, id: string, lock = false) {
  const au = await one(c, `select * from asset_audits where id = $1 ${lock ? 'for update' : ''}`, [id], 'Audit');
  au.lines = (await c.query(
    `select l.*, case when l.result is not null then l.result when not l.expected then 'unexpected' when l.scanned_at is not null then 'found' else 'pending' end as state
     from asset_audit_lines l where l.audit_id = $1 order by l.expected desc, l.asset_code`, [id])).rows;
  const n = (st: string) => au.lines.filter((l: any) => l.state === st).length;
  au.expected_count = au.lines.filter((l: any) => l.expected).length;
  au.found_count = n('found');
  au.missing_count = n('missing');
  au.pending_count = n('pending');
  au.unexpected_count = n('unexpected');
  au.lost_count = au.lines.filter((l: any) => l.marked_lost).length;
  return au;
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    /* ---------------- categories ---------------- */

    app.get('/categories', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.read');
      const q = parse(ListQuery, req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select c.*, (select count(*)::int from assets x where x.category_id = c.id and x.status <> 'disposed') as asset_count
         from asset_categories c where ($1::text is null or c.code ilike $1 or c.name ilike $1) order by c.code limit $2 offset $3`,
        [like(q.q), q.limit, q.offset])).rows);
    });

    app.post('/categories', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.write');
      const b = parse(CategoryInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        'insert into asset_categories (code, name, useful_life_years, method, salvage_pct) values ($1,$2,$3,$4,$5) returning *',
        [b.code, b.name, b.usefulLifeYears, b.method, b.salvagePct])).rows[0]);
    });

    app.get('/categories/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => one(c, 'select * from asset_categories where id = $1', [id], 'Category'));
    });

    /** Changes apply to assets registered afterwards; existing assets keep their own life/method. */
    app.patch('/categories/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(CategoryInput.partial(), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from asset_categories where id = $1 for update', [id], 'Category');
        const map: Record<string, string> = { code: 'code', name: 'name', usefulLifeYears: 'useful_life_years', method: 'method', salvagePct: 'salvage_pct' };
        const keys = Object.keys(map).filter((key) => (b as any)[key] !== undefined);
        if (keys.length) await c.query(`update asset_categories set ${keys.map((key, i) => `${map[key]} = $${i + 2}`).join(', ')} where id = $1`, [id, ...keys.map((key) => (b as any)[key])]);
        return (await c.query('select * from asset_categories where id = $1', [id])).rows[0];
      });
    });

    /* ---------------- assets ---------------- */

    app.post('/assets', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.write');
      const b = parse(AssetInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const cat = await one(c, 'select * from asset_categories where id = $1', [b.categoryId], 'Category');
        const salvage = b.salvageValue ?? round2(b.cost * cat.salvage_pct / 100);
        if (salvage > b.cost) throw badRequest('Salvage value exceeds cost', { fieldErrors: { salvageValue: ['มูลค่าซากต้องไม่เกินราคาทุน'] } });
        const code = b.code ?? (await nextDocNo(c, 'AS', new Date(b.purchaseDate)));
        const status = b.custodianId ? 'in_use' : 'in_storage';
        const row = (await c.query(
          `insert into assets (code, name, category_id, serial_no, brand, model, location, purchase_date, cost, salvage_value, useful_life_years, method,
             supplier_name, warranty_until, custodian_id, custodian_name, status, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id`,
          [code, b.name, b.categoryId, b.serialNo ?? null, b.brand ?? null, b.model ?? null, b.location ?? null, b.purchaseDate, b.cost, salvage,
            b.usefulLifeYears ?? cat.useful_life_years, cat.method, b.supplierName ?? null, b.warrantyUntil ?? null, b.custodianId ?? null,
            b.custodianName ?? null, status, b.note ?? null, a.userId])).rows[0];
        if (b.custodianId || b.location) {
          await c.query(
            `insert into asset_assignments (asset_id, custodian_id, custodian_name, location, assigned_on, note, created_by) values ($1,$2,$3,$4,$5,'ลงทะเบียน',$6)`,
            [row.id, b.custodianId ?? null, b.custodianName ?? null, b.location ?? null, b.purchaseDate, a.userId]);
        }
        return loadAsset(c, row.id);
      });
    });

    app.get('/assets', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.read');
      const q = parse(AssetList, req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const d = await today(c);
        const rows = (await c.query(
          `${ASSET_SELECT}
           where ($1::text is null or a.code ilike $1 or a.name ilike $1 or a.serial_no ilike $1 or a.custodian_name ilike $1)
             and ($2::text is null or a.status = $2) and ($3::uuid is null or a.category_id = $3)
             and ($4::text is null or lower(trim(a.location)) = lower(trim($4))) and ($5::uuid is null or a.custodian_id = $5)
             and ($6::text is null or ($6 = 'true') = (a.warranty_until is not null and a.warranty_until between $9::date and $9::date + 30 and a.status <> 'disposed'))
             and ($7::text is null or ($7 = 'true') = (a.status <> 'disposed'))
           order by a.code limit $8 offset $10`,
          [like(q.q), q.status ?? null, q.categoryId ?? null, q.location || null, q.custodianId ?? null, q.warrantyExpiring ?? null, q.active ?? null, q.limit, d, q.offset])).rows;
        return rows.map((r: any) => withBook(r, d));
      });
    });

    /** The QR label on the asset encodes its code -> the phone calls this after a scan. */
    app.get('/assets/by-code/:code', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.read');
      const { code } = parse(z.object({ code: s.code }), req.params);
      return k.db.tx(a.tenantId, async (c) => detail(c, await one(c, `${ASSET_SELECT} where a.code = $1`, [code], 'Asset')));
    });

    /** Distinct locations with how many assets sit there (for audits and filters). */
    app.get('/locations', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.read');
      const q = parse(ListQuery, req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select trim(location) as location, count(*)::int as asset_count from assets
         where location is not null and trim(location) <> '' and status not in ('disposed', 'lost') and ($1::text is null or location ilike $1)
         group by trim(location) order by 1 limit $2 offset $3`, [like(q.q), q.limit, q.offset])).rows);
    });

    /** Dashboard: register size, cost and book value, repairs, warranties, value by category, 6 months of depreciation. */
    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.read');
      return k.db.tx(a.tenantId, async (c) => {
        const d = await today(c);
        const all = (await c.query(ASSET_SELECT)).rows.map((r: any) => withBook(r, d));
        const live = all.filter((r: any) => r.status !== 'disposed' && r.status !== 'lost');
        const cats = new Map<string, any>();
        for (const r of live) {
          const x = cats.get(r.category_id) ?? { category: `${r.category_code} ${r.category_name}`, category_code: r.category_code, count: 0, cost: 0, book_value: 0 };
          x.count++; x.cost = round2(x.cost + r.cost); x.book_value = round2(x.book_value + r.book_value);
          cats.set(r.category_id, x);
        }
        const cur = monthIndex(d);
        const months = [];
        for (let i = cur - 5; i <= cur; i++) {
          const m = periodOf(i);
          months.push({
            month: m,
            depreciation: round2(all.reduce((n: number, r: any) => n + depreciationIn(r, m), 0)),
            acquisitions: round2(all.filter((r: any) => r.purchase_date.startsWith(m)).reduce((n: number, r: any) => n + r.cost, 0)),
          });
        }
        const expiring = live.filter((r: any) => r.warranty_until && r.warranty_until >= d && r.warranty_until <= periodPlus(d, 30));
        const feed = [
          ...all.filter((r: any) => r.status === 'in_repair').map((r: any) => ({ title: `${r.code} ส่งซ่อมอยู่`, body: r.name, time: r.created_at, level: 'warn', link: `/m/assets/assetDetail/${r.id}` })),
          ...expiring.map((r: any) => ({ title: `${r.code} ประกันหมด ${r.warranty_until}`, body: r.name, time: r.warranty_until, level: 'info', link: `/m/assets/assetDetail/${r.id}` })),
        ];
        return {
          count: live.length,
          totalCost: round2(live.reduce((n: number, r: any) => n + r.cost, 0)),
          bookValue: round2(live.reduce((n: number, r: any) => n + r.book_value, 0)),
          inRepair: all.filter((r: any) => r.status === 'in_repair').length,
          lost: all.filter((r: any) => r.status === 'lost').length,
          warrantyExpiring30d: expiring.length,
          depreciationMonth: months[5].depreciation,
          byCategory: [...cats.values()].sort((x, y) => y.book_value - x.book_value),
          months, rows: feed,
        };
      });
    });

    app.get('/assets/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadAsset(c, id));
    });

    app.patch('/assets/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(AssetPatch, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const cur = await one(c, 'select id, code, status from assets where id = $1 for update', [id], 'Asset');
        assertWorkable(cur, 'edit', true);
        const map: Record<string, string> = { name: 'name', serialNo: 'serial_no', brand: 'brand', model: 'model', supplierName: 'supplier_name', warrantyUntil: 'warranty_until', note: 'note' };
        const keys = Object.keys(map).filter((key) => (b as any)[key] !== undefined);
        if (keys.length) await c.query(`update assets set ${keys.map((key, i) => `${map[key]} = $${i + 2}`).join(', ')} where id = $1`, [id, ...keys.map((key) => (b as any)[key])]);
        return loadAsset(c, id);
      });
    });

    /** Hand over / move: new custodian and/or location. No custodian = back to storage. A lost asset assigned again is "found". */
    app.post('/assets/:id/assign', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(AssignInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const cur = await one(c, 'select * from assets where id = $1 for update', [id], 'Asset');
        assertWorkable(cur, 'assign', true);
        const location = b.location ?? cur.location;
        const status = cur.status === 'in_repair' ? 'in_repair' : b.custodianId ? 'in_use' : 'in_storage';
        await c.query(
          `update assets set custodian_id = $2, custodian_name = $3, location = $4, status = $5, lost_on = null where id = $1`,
          [id, b.custodianId ?? null, b.custodianId ? b.custodianName ?? null : null, location, status]);
        await c.query(
          `insert into asset_assignments (asset_id, custodian_id, custodian_name, location, assigned_on, note, created_by) values ($1,$2,$3,$4,coalesce($5::date, current_date),$6,$7)`,
          [id, b.custodianId ?? null, b.custodianId ? b.custodianName ?? null : null, location, b.assignedOn ?? null, b.note ?? (cur.status === 'lost' ? 'พบทรัพย์สินที่สูญหาย' : null), a.userId]);
        return loadAsset(c, id);
      });
    });

    /** Monthly straight-line schedule over the whole life (cut at the disposal month). */
    app.get('/assets/:id/schedule', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.read');
      const { id } = parse(IdParam, req.params);
      const q = parse(z.object({ asOf: s.isoDate.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const asset = await one(c, `${ASSET_SELECT} where a.id = $1`, [id], 'Asset');
        const d = q.asOf ?? (await today(c));
        const rows = schedule(asset);
        const { accumulated, book_value } = bookValueAt(asset, d, rows);
        return {
          id: asset.id, code: asset.code, name: asset.name, category_name: asset.category_name, method: asset.method, cost: asset.cost,
          salvage_value: asset.salvage_value, useful_life_years: asset.useful_life_years, purchase_date: asset.purchase_date, status: asset.status,
          monthly_depreciation: monthlyAmount(asset), as_of: d, accumulated, book_value, rows,
        };
      });
    });

    app.post('/assets/:id/repairs', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'assets.repair.report');
      const { id } = parse(IdParam, req.params);
      const b = parse(RepairInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, (c) => reportRepair(k, c, id, b, a.userId));
    });

    /** Same as /assets/:id/repairs, with the asset in the body (form with a QR-scannable asset lookup). */
    app.post('/repairs', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'assets.repair.report');
      const b = parse(RepairInput.extend({ assetId: s.uuid }), req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, (c) => reportRepair(k, c, b.assetId, b, a.userId));
    });

    app.get('/repairs', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.read');
      const q = parse(ListQuery.extend({ status: z.enum(['open', 'done']).optional(), assetId: s.uuid.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select r.*, a.code as asset_code, a.name as asset_name, a.location from asset_repairs r join assets a on a.id = r.asset_id
         where ($1::text is null or a.code ilike $1 or a.name ilike $1 or r.description ilike $1 or r.vendor ilike $1)
           and ($2::text is null or r.status = $2) and ($3::uuid is null or r.asset_id = $3)
         order by r.status = 'done', r.repair_date desc, r.created_at desc limit $4 offset $5`,
        [like(q.q), q.status ?? null, q.assetId ?? null, q.limit, q.offset])).rows);
    });

    /** Finish an open repair; when it was the last one the asset goes back to its previous status. */
    app.post('/repairs/:id/complete', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.repair.report');
      const { id } = parse(IdParam, req.params);
      const b = parse(CompleteRepairInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const r = await one(c, 'select * from asset_repairs where id = $1 for update', [id], 'Repair');
        if (r.status !== 'open') throw conflict('Repair is already done');
        const asset = await one(c, 'select id, code, status from assets where id = $1 for update', [r.asset_id], 'Asset');
        assertWorkable(asset, 'complete a repair of');
        await c.query(
          `update asset_repairs set status = 'done', completed_on = coalesce($2::date, current_date), cost = coalesce($3, cost), vendor = coalesce($4, vendor) where id = $1`,
          [id, b.completedOn ?? null, b.cost ?? null, b.vendor ?? null]);
        const open = await c.query(`select 1 from asset_repairs where asset_id = $1 and status = 'open'`, [r.asset_id]);
        if (!open.rowCount && asset.status === 'in_repair') {
          await c.query('update assets set status = $2 where id = $1', [r.asset_id, r.prev_status ?? 'in_storage']);
        }
        return (await c.query(
          `select r.*, a.code as asset_code, a.name as asset_name, a.status as asset_status from asset_repairs r join assets a on a.id = r.asset_id where r.id = $1`, [id])).rows[0];
      });
    });

    /** Sell / scrap / donate. Gain or loss = price − book value at the disposal date (depreciated through that month). */
    app.post('/assets/:id/dispose', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.dispose');
      const { id } = parse(IdParam, req.params);
      const b = parse(DisposeInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const asset = await one(c, 'select * from assets where id = $1 for update', [id], 'Asset');
        assertWorkable(asset, 'dispose', true);
        if (b.disposedOn < asset.purchase_date) throw badRequest('Disposal date is before the purchase date', { fieldErrors: { disposedOn: ['วันที่ตัดจำหน่ายก่อนวันที่ซื้อ'] } });
        const rows = schedule({ ...asset, disposed_on: b.disposedOn });
        const book = round2(asset.cost - (rows.at(-1)?.accumulated ?? 0));
        await c.query(
          `update assets set status = 'disposed', disposed_on = $2, disposal_method = $3, disposal_price = $4, disposal_book_value = $5, disposal_gain_loss = $6, disposal_note = $7
           where id = $1`, [id, b.disposedOn, b.method, b.price, book, round2(b.price - book), b.note ?? null]);
        await c.query(`update asset_repairs set status = 'done', completed_on = $2 where asset_id = $1 and status = 'open'`, [id, b.disposedOn]);
        return loadAsset(c, id);
      });
    });

    /* ---------------- depreciation report ---------------- */

    /** Depreciation of one month for every asset, with accumulated and book value at month end, plus totals by category. */
    app.get('/depreciation', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.read');
      const q = parse(z.object({ month: Month.optional(), categoryId: s.uuid.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const month = q.month ?? (await today(c)).slice(0, 7);
        const idx = monthIndex(`${month}-01`);
        const assets = (await c.query(
          `${ASSET_SELECT} where ($1::uuid is null or a.category_id = $1) and a.purchase_date < ($2::date + interval '1 month')
             and (a.disposed_on is null or a.disposed_on >= $2::date) order by c.code, a.code`, [q.categoryId ?? null, `${month}-01`])).rows;
        const rows = assets.map((x: any) => {
          const sch = schedule(x);
          let accumulated = 0;
          for (const r of sch) if (monthIndex(`${r.period}-01`) <= idx) accumulated = r.accumulated;
          return {
            id: x.id, code: x.code, name: x.name, category_code: x.category_code, category_name: x.category_name, method: x.method, status: x.status,
            purchase_date: x.purchase_date, cost: x.cost, depreciation: depreciationIn(x, month, sch), accumulated, book_value: round2(x.cost - accumulated),
          };
        });
        const cats = new Map<string, any>();
        for (const r of rows) {
          const x = cats.get(r.category_code) ?? { category_code: r.category_code, category_name: r.category_name, count: 0, cost: 0, depreciation: 0, accumulated: 0, book_value: 0 };
          x.count++;
          for (const f of ['cost', 'depreciation', 'accumulated', 'book_value'] as const) x[f] = round2(x[f] + r[f]);
          cats.set(r.category_code, x);
        }
        const sum = (f: 'cost' | 'depreciation' | 'accumulated' | 'book_value') => round2(rows.reduce((n: number, r: any) => n + r[f], 0));
        return { month, rows, byCategory: [...cats.values()], totals: { cost: sum('cost'), depreciation: sum('depreciation'), accumulated: sum('accumulated'), book_value: sum('book_value') } };
      });
    });

    /* ---------------- physical audit ---------------- */

    app.post('/audits', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'assets.audit.run');
      const b = parse(AuditInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const no = await nextDocNo(c, 'AU');
        const au = (await c.query('insert into asset_audits (no, location, note, created_by) values ($1,$2,$3,$4) returning id', [no, b.location, b.note ?? null, a.userId])).rows[0];
        await c.query(
          `insert into asset_audit_lines (audit_id, asset_id, asset_code, asset_name, registered_location, expected)
           select $1, id, code, name, location, true from assets
           where lower(trim(location)) = lower(trim($2)) and status not in ('disposed', 'lost')`, [au.id, b.location]);
        return loadAudit(c, au.id);
      });
    });

    app.get('/audits', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.read');
      const q = parse(ListQuery.extend({ status: z.enum(['open', 'closed']).optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select au.*,
           count(l.id) filter (where l.expected)::int as expected_count,
           count(l.id) filter (where l.expected and l.scanned_at is not null)::int as found_count,
           count(l.id) filter (where l.result = 'missing')::int as missing_count,
           count(l.id) filter (where not l.expected)::int as unexpected_count
         from asset_audits au left join asset_audit_lines l on l.audit_id = au.id
         where ($1::text is null or au.no ilike $1 or au.location ilike $1) and ($2::text is null or au.status = $2)
         group by au.id order by au.created_at desc limit $3 offset $4`, [like(q.q), q.status ?? null, q.limit, q.offset])).rows);
    });

    app.get('/audits/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.asset.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadAudit(c, id));
    });

    /** Scan a QR during an open audit. Answers with `result` (found | duplicate | unexpected | unknown) and a Thai `message`. */
    app.post('/audits/:id/scan', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.audit.run');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ code: s.code }), req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const au = await one(c, 'select * from asset_audits where id = $1 for update', [id], 'Audit');
        if (au.status !== 'open') throw conflict(`Audit ${au.no} is closed`);
        const line = (await c.query('select * from asset_audit_lines where audit_id = $1 and asset_code = $2', [id, b.code])).rows[0];
        let result: string;
        let message: string;
        if (line?.scanned_at) {
          result = 'duplicate';
          message = `สแกน ${b.code} ไปแล้ว`;
        } else if (line) {
          await c.query('update asset_audit_lines set scanned_at = now() where id = $1', [line.id]);
          result = 'found';
          message = `พบ ${b.code} ${line.asset_name ?? ''}`.trim();
        } else {
          const asset = (await c.query('select id, code, name, location, status from assets where code = $1', [b.code])).rows[0];
          await c.query(
            `insert into asset_audit_lines (audit_id, asset_id, asset_code, asset_name, registered_location, expected, scanned_at, result) values ($1,$2,$3,$4,$5,false,now(),'unexpected')`,
            [id, asset?.id ?? null, b.code, asset?.name ?? null, asset?.location ?? null]);
          result = asset ? 'unexpected' : 'unknown';
          message = asset ? `${b.code} ไม่อยู่ในรายการของ ${au.location} (ทะเบียนอยู่ที่ ${asset.location ?? 'ไม่ระบุ'})` : `ไม่พบรหัส ${b.code} ในทะเบียน`;
        }
        const audit = await loadAudit(c, id);
        return { result, message, code: b.code, audit, id: audit.id, found_count: audit.found_count, pending_count: audit.pending_count };
      });
    });

    /** Close the count: every expected asset not scanned becomes "missing". */
    app.post('/audits/:id/close', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.audit.run');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const au = await one(c, 'select * from asset_audits where id = $1 for update', [id], 'Audit');
        if (au.status !== 'open') throw conflict(`Audit ${au.no} is already closed`);
        await c.query(`update asset_audit_lines set result = case when scanned_at is null then 'missing' else 'found' end where audit_id = $1 and expected`, [id]);
        await c.query(`update asset_audits set status = 'closed', closed_at = now() where id = $1`, [id]);
        return loadAudit(c, id);
      });
    });

    /** Write off every missing asset of a closed audit as lost. */
    app.post('/audits/:id/mark-lost', async (req) => {
      const a = auth(req);
      requirePerm(a, 'assets.audit.run');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const au = await one(c, 'select * from asset_audits where id = $1 for update', [id], 'Audit');
        if (au.status !== 'closed') throw conflict(`Close audit ${au.no} before marking assets lost`);
        const missing = (await c.query(`select * from asset_audit_lines where audit_id = $1 and result = 'missing' and not marked_lost`, [id])).rows;
        if (!missing.length) throw conflict(`Audit ${au.no} has no missing assets to mark lost`);
        for (const l of missing) {
          await c.query(`update assets set status = 'lost', lost_on = current_date where id = $1 and status not in ('disposed', 'lost')`, [l.asset_id]);
          await c.query('update asset_audit_lines set marked_lost = true where id = $1', [l.id]);
        }
        return loadAudit(c, id);
      });
    });
  },
};

/** YYYY-MM-DD + n days. */
function periodPlus(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
