import { auth, badRequest, conflict, defineExtension, notFound, parse, requirePerm, z, type Client } from '@erp/kernel';

/**
 * Example customer extension of `purchasing` (copy to services/purchasing/ext/ to use it).
 * - x_budgets: budget codes with an amount; "used" = gross of approved / received POs carrying the code
 * - a budget code on a draft PO (vendor table + x_ column added by ext/migrations)
 * - company rule (guard): a PO above 50,000 baht needs a budget code with enough room left before it can be approved
 * Nothing in services/purchasing/src changes.
 */
export const BUDGET_REQUIRED_ABOVE = 50_000;

const BudgetInput = z.object({ code: z.string().trim().min(1).max(30), name: z.string().trim().min(1).max(200), amount: z.coerce.number().min(0) });
const AssignInput = z.object({ code: z.string().trim().min(1).max(30) });
const IdParam = z.object({ id: z.string().uuid() });

async function budgetRows(c: Client, code?: string) {
  return (await c.query(
    `select b.code, b.name, b.amount,
            coalesce((select sum(p.gross) from purchase_orders p
                      where p.x_budget_code = b.code and p.status in ('approved', 'partially_received', 'received')), 0) as used
     from x_budgets b where ($1::text is null or b.code = $1) order by b.code`, [code ?? null],
  )).rows.map((r) => ({ ...r, id: r.code, remaining: Number(r.amount) - Number(r.used) }));
}

export default defineExtension({
  routes(app, k) {
    app.get('/x/budgets', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.read');
      return k.db.tx(a.tenantId, (c) => budgetRows(c));
    });

    app.post('/x/budgets', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.x_budget.write');
      const b = parse(BudgetInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await c.query(
          `insert into x_budgets (tenant_id, code, name, amount) values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1, $2, $3)
           on conflict (tenant_id, code) do update set name = $2, amount = $3`, [b.code, b.name, b.amount]);
        return (await budgetRows(c, b.code))[0];
      });
    });

    app.post('/x/purchase-orders/:id/budget', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.x_budget.write');
      const { id } = parse(IdParam, req.params);
      const { code } = parse(AssignInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const po = (await c.query('select id, status from purchase_orders where id = $1 for update', [id])).rows[0];
        if (!po) throw notFound('Purchase order');
        if (po.status !== 'draft') throw conflict('ระบุรหัสงบได้เฉพาะใบสั่งซื้อที่ยังเป็นร่าง');
        if (!(await budgetRows(c, code)).length) throw badRequest(`ไม่พบรหัสงบ "${code}"`);
        return (await c.query('update purchase_orders set x_budget_code = $2 where id = $1 returning *', [id, code])).rows[0];
      });
    });
  },

  guards: {
    // company rule on the vendor's approve route: refuse with a Thai message, otherwise let the vendor code run
    'POST /purchase-orders/:id/approve': async (req, { k }) => {
      const a = auth(req);
      const { id } = parse(IdParam, req.params);
      await k.db.tx(a.tenantId, async (c) => {
        const po = (await c.query('select no, gross, x_budget_code, status from purchase_orders where id = $1', [id])).rows[0];
        if (!po || po.status !== 'draft' || Number(po.gross) <= BUDGET_REQUIRED_ABOVE) return; // vendor answers 404 / 409 / approves
        if (!po.x_budget_code) throw badRequest(`ใบสั่งซื้อ ${po.no} ยอดเกิน ${BUDGET_REQUIRED_ABOVE.toLocaleString('en-US')} บาท ต้องระบุรหัสงบประมาณก่อนอนุมัติ`);
        const [b] = await budgetRows(c, po.x_budget_code);
        if (!b || b.remaining < Number(po.gross)) {
          throw conflict(`งบ ${po.x_budget_code} เหลือ ${(b?.remaining ?? 0).toLocaleString('en-US')} บาท ไม่พอสำหรับใบสั่งซื้อ ${po.no} (${Number(po.gross).toLocaleString('en-US')} บาท)`);
        }
      });
    },
  },
});
