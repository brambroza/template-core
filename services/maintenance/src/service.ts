import { auth, conflict, loadManifest, nextDocNo, one, parse, requirePerm, s, TODAY_SQL, z, type Client, type ServiceDefinition } from '@erp/kernel';
import { fileURLToPath } from 'node:url';
import { statusTh } from '@erp/ui-schema';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const MachineInput = z.object({ code: s.code, name: s.name, location: z.string().max(200).optional() });
const PlanInput = z.object({ machineId: s.uuid, title: s.name, intervalDays: z.number().int().positive(), firstDueOn: s.isoDate });
const BreakdownInput = z.object({ machineId: s.uuid, title: s.name, description: z.string().max(2000).optional() });
const CompleteInput = z.object({
  resolution: z.string().min(1).max(2000),
  downtimeMinutes: z.number().int().min(0).optional(),
  /** omit = the tenant's default parts warehouse (settings, 'SPARE' when never set) */
  warehouseCode: s.code.optional(),
  parts: z.array(s.itemLine).default([]),
  doneOn: s.isoDate.optional(),
});
const IdParam = z.object({ id: s.uuid });
const SettingsInput = z.object({ defaultPartsWarehouse: s.code });

async function readSettings(c: Client) {
  const r = (await c.query('select default_parts_warehouse from settings')).rows[0];
  return { defaultPartsWarehouse: (r?.default_parts_warehouse as string | undefined) ?? 'SPARE' };
}

async function loadWo(c: Client, id: string, lock = false) {
  const wo = await one(c, `select w.*, m.code as machine_code, m.name as machine_name from work_orders w join machines m on m.id = w.machine_id where w.id = $1 ${lock ? 'for update of w' : ''}`, [id], 'Work order');
  wo.parts = (await c.query('select * from wo_parts where work_order_id = $1', [id])).rows;
  // where parts were (or, while open, will by default be) issued from
  wo.parts_warehouse = wo.parts_warehouse_code ?? (await readSettings(c)).defaultPartsWarehouse;
  return wo;
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  // photos of breakdowns / repairs and machine documents (manuals, certificates)
  attachments: {
    read: 'maintenance.machine.read',
    write: ['maintenance.wo.report', 'maintenance.wo.work', 'maintenance.machine.write'],
    entities: {
      'work-order': 'work_orders',
      machine: { table: 'machines', write: ['maintenance.machine.write', 'maintenance.wo.work'] },
    },
  },
  routes(app, k) {
    app.post('/machines', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.machine.write');
      const b = parse(MachineInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query('insert into machines (code, name, location) values ($1,$2,$3) returning *', [b.code, b.name, b.location ?? null])).rows[0]);
    });

    app.get('/machines', async (req) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.machine.read');
      const q = parse(z.object({ status: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from machines where ($1::text is null or status = $1) order by code', [q.status ?? null])).rows);
    });

    /** QR code on the machine encodes its code -> mobile app calls this. */
    app.get('/machines/by-code/:code', async (req) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.machine.read');
      const { code } = parse(z.object({ code: s.code }), req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const m = await one(c, 'select * from machines where code = $1', [code], 'Machine');
        m.openWorkOrders = (await c.query(`select id, no, kind, title, status from work_orders where machine_id = $1 and status in ('open','in_progress') order by reported_at`, [m.id])).rows;
        return m;
      });
    });

    /** Dashboard numbers + every machine with its live status (drives the 3D floor). */
    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.machine.read');
      return k.db.tx(a.tenantId, async (c) => {
        const machines = (await c.query(
          `select m.id, m.code, m.name, coalesce(m.location, '') as location, m.status,
                  count(w.id) filter (where w.status in ('open', 'in_progress'))::int as open_work_orders
           from machines m left join work_orders w on w.machine_id = m.id
           where m.status <> 'retired' group by m.id order by m.location nulls last, m.code`)).rows;
        const n = (await c.query(
          `select count(*) filter (where status in ('open', 'in_progress'))::int as open_wo,
                  coalesce(sum(downtime_minutes) filter (where date_trunc('month', completed_at) = date_trunc('month', now())), 0)::int as downtime_month
           from work_orders`)).rows[0];
        const pmDue = (await c.query(`select count(*)::int as n from pm_plans where active and next_due_on <= current_date + 7`)).rows[0].n;
        return { machines, running: machines.filter((m: any) => m.status === 'running').length, down: machines.filter((m: any) => m.status === 'down').length, openWorkOrders: n.open_wo, downtimeMonth: n.downtime_month, pmDue7d: pmDue };
      });
    });

    app.get('/machines/:id/history', async (req) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.machine.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const m = await one(c, 'select * from machines where id = $1', [id], 'Machine');
        const wos = (await c.query('select * from work_orders where machine_id = $1 order by reported_at desc', [id])).rows;
        const downtime = wos.reduce((sum: number, w: any) => sum + (w.downtime_minutes ?? 0), 0);
        return { machine: m, workOrders: wos, totalDowntimeMinutes: downtime, breakdowns: wos.filter((w: any) => w.kind === 'breakdown').length };
      });
    });

    app.post('/pm-plans', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.machine.write');
      const b = parse(PlanInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        'insert into pm_plans (machine_id, title, interval_days, next_due_on) values ($1,$2,$3,$4) returning *', [b.machineId, b.title, b.intervalDays, b.firstDueOn])).rows[0]);
    });

    app.get('/pm-plans', async (req) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.machine.read');
      const q = parse(z.object({ dueBy: s.isoDate.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select p.*, m.code as machine_code from pm_plans p join machines m on m.id = p.machine_id
         where p.active and ($1::date is null or p.next_due_on <= $1) order by p.next_due_on`, [q.dueBy ?? null])).rows);
    });

    /** Create PM work orders for every plan due on/before `asOf` (idempotent; run daily by a scheduler). */
    app.post('/pm-plans/generate', async (req) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.machine.write');
      const b = parse(z.object({ asOf: s.isoDate }), req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const due = (await c.query('select * from pm_plans where active and next_due_on <= $1', [b.asOf])).rows;
        const created = [];
        for (const p of due) {
          const exists = await c.query('select 1 from work_orders where pm_plan_id = $1 and due_on = $2', [p.id, p.next_due_on]);
          if (exists.rowCount) continue;
          const no = await nextDocNo(c, 'WO');
          created.push((await c.query(
            `insert into work_orders (no, machine_id, kind, pm_plan_id, due_on, title, reported_by) values ($1,$2,'pm',$3,$4,$5,$6) returning *`,
            [no, p.machine_id, p.id, p.next_due_on, p.title, a.userId])).rows[0]);
        }
        return { created };
      });
    });

    app.post('/work-orders', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.wo.report');
      const b = parse(BreakdownInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from machines where id = $1', [b.machineId], 'Machine');
        const no = await nextDocNo(c, 'WO');
        const wo = (await c.query(
          `insert into work_orders (no, machine_id, kind, title, description, reported_by) values ($1,$2,'breakdown',$3,$4,$5) returning id`,
          [no, b.machineId, b.title, b.description ?? null, a.userId])).rows[0];
        await c.query(`update machines set status = 'down' where id = $1`, [b.machineId]);
        const full = await loadWo(c, wo.id);
        await k.emit(c, 'maintenance.breakdown_reported', {
          workOrderId: full.id, workOrderNo: full.no, machineId: full.machine_id, machineCode: full.machine_code, machineName: full.machine_name,
          title: full.title, description: full.description,
        });
        return full;
      });
    });

    app.get('/work-orders', async (req) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.machine.read');
      const q = parse(z.object({ status: z.string().optional(), machineId: s.uuid.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select w.*, m.code as machine_code from work_orders w join machines m on m.id = w.machine_id
         where ($1::text is null or w.status = $1) and ($2::uuid is null or w.machine_id = $2) order by w.reported_at desc`,
        [q.status ?? null, q.machineId ?? null])).rows);
    });

    app.get('/work-orders/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.machine.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadWo(c, id));
    });

    app.post('/work-orders/:id/start', async (req) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.wo.work');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const wo = await loadWo(c, id, true);
        if (wo.status !== 'open') throw conflict(`เริ่มงาน ${wo.no} ไม่ได้ — อยู่ในสถานะ "${statusTh(wo.status)}"`);
        await c.query(`update work_orders set status = 'in_progress', started_at = now() where id = $1`, [id]);
        return loadWo(c, id);
      });
    });

    app.get('/settings', async (req) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.machine.read');
      return k.db.tx(a.tenantId, readSettings);
    });

    app.put('/settings', async (req) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.settings.write');
      const b = parse(SettingsInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await c.query(
          `insert into settings (tenant_id, default_parts_warehouse) values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1)
           on conflict (tenant_id) do update set default_parts_warehouse = excluded.default_parts_warehouse`, [b.defaultPartsWarehouse.toUpperCase()]);
        return readSettings(c);
      });
    });

    app.post('/work-orders/:id/complete', async (req) => {
      const a = auth(req);
      requirePerm(a, 'maintenance.wo.work');
      const { id } = parse(IdParam, req.params);
      const b = parse(CompleteInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const wo = await loadWo(c, id, true);
        if (!['open', 'in_progress'].includes(wo.status)) throw conflict(`ปิดงาน ${wo.no} ไม่ได้ — อยู่ในสถานะ "${statusTh(wo.status)}"`);
        const warehouseCode = b.warehouseCode ?? (await readSettings(c)).defaultPartsWarehouse;
        await c.query(
          `update work_orders set status = 'done', completed_at = now(), started_at = coalesce(started_at, now()), resolution = $2, downtime_minutes = $3 where id = $1`,
          [id, b.resolution, b.downtimeMinutes ?? null]);
        if (b.parts.length) await c.query('update work_orders set parts_warehouse_code = $2 where id = $1', [id, warehouseCode]);
        for (const p of b.parts) {
          await c.query('insert into wo_parts (work_order_id, item_id, item_code, item_name, qty) values ($1,$2,$3,$4,$5)', [id, p.itemId, p.itemCode, p.itemName ?? null, p.qty]);
        }
        const stillOpen = await c.query(`select 1 from work_orders where machine_id = $1 and kind = 'breakdown' and status in ('open','in_progress')`, [wo.machine_id]);
        if (!stillOpen.rowCount) await c.query(`update machines set status = 'running' where id = $1 and status = 'down'`, [wo.machine_id]);
        if (wo.pm_plan_id) {
          await c.query(
            `update pm_plans set last_done_on = coalesce($2::date, ${TODAY_SQL}), next_due_on = coalesce($2::date, ${TODAY_SQL}) + interval_days where id = $1`,
            [wo.pm_plan_id, b.doneOn ?? null]);
        }
        await k.emit(c, 'maintenance.work_completed', { workOrderId: wo.id, workOrderNo: wo.no, machineCode: wo.machine_code, kind: wo.kind, downtimeMinutes: b.downtimeMinutes ?? null });
        if (b.parts.length) {
          await k.emit(c, 'maintenance.parts_used', { workOrderId: wo.id, workOrderNo: wo.no, machineCode: wo.machine_code, warehouseCode, parts: b.parts });
        }
        return loadWo(c, id);
      });
    });
  },
};
