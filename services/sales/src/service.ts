import { auth, badRequest, conflict, guardLockDate, hasPerm, loadManifest, lockThroughPeriod, nextDocNo, one, parse, readLock, requirePerm, s, setLockDate, thaiToday, unlockPeriod, z, type Client, type ServiceDefinition } from '@erp/kernel';
import type { EventData } from '@erp/contracts';
import { bahtText, calcVat, documentTotals, formatThaiDate, isValidThaiTaxId, promptPayPayload, round } from '@erp/thai';
import { fileURLToPath } from 'node:url';
import { statusTh } from '@erp/ui-schema';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/** A stock item line (itemId + itemCode) or a service/description line without a stock item (not issued from stock). */
const OrderLine = z.object({
  itemId: s.uuid.nullable().optional(),
  itemCode: z.string().trim().min(1).max(50).optional(),
  itemName: z.string().max(200).optional(),
  description: z.string().max(1000).optional(),
  qty: s.positiveQty,
  unitPrice: s.money,
  discountPct: z.number().min(0).max(100).default(0),
})
  .refine((l) => !l.itemId || l.itemCode, { message: 'itemCode is required with itemId', path: ['itemCode'] })
  .refine((l) => l.itemId || l.description || l.itemName, { message: 'item or description is required', path: ['description'] });
type OrderLine = z.infer<typeof OrderLine>;

const OrderInput = z.object({
  customerId: s.uuid.nullable().optional(),
  customerName: s.name,
  customerTaxId: z.string().refine(isValidThaiTaxId, 'invalid Thai tax ID').optional(),
  customerBranch: z.string().regex(/^\d{5}$/).optional(),
  customerAddress: z.string().max(500).optional(),
  warehouseCode: s.code.default('MAIN'),
  orderDate: s.isoDate.optional(),
  vatMode: z.enum(['exclusive', 'inclusive']).default('exclusive'),
  /** credit term: invoice due date = issue date + creditDays */
  creditDays: z.coerce.number().int().min(0).max(365).default(0),
  /** reference document, e.g. the customer's PO or our quotation no. */
  ref: z.string().trim().max(100).optional(),
  note: z.string().max(1000).optional(),
  lines: z.array(OrderLine).min(1),
});
const IdParam = z.object({ id: s.uuid });
const InvoiceInput = z.object({
  issueDate: s.isoDate.optional(),
  dueDate: s.isoDate.optional(),
  /**
   * wave 8 (C2): deposits with VAT (ใบกำกับภาษีเงินมัดจำ) to deduct on this tax invoice; no amount = as much as remains and is due.
   * Omitted: every open VAT deposit taken against this order (dated on/before the invoice) is deducted, unless `applyDeposits` is false.
   */
  deposits: z.array(z.object({ depositId: s.uuid, amount: z.coerce.number().finite().positive().optional() })).optional(),
  applyDeposits: z.boolean().default(true),
  /** needed (with perm sales.lock.override) to date the invoice on/before the lock date */
  lockOverrideReason: z.string().trim().max(500).optional(),
});

const METHODS = ['cash', 'transfer', 'cheque', 'card'] as const;
const METHOD_TH: Record<string, string> = { cash: 'เงินสด', transfer: 'โอนเงิน', cheque: 'เช็ค', card: 'บัตรเครดิต' };
const WHT_RATES = [0, 1, 2, 3, 5];

const ReceiptInput = z.object({
  customerId: s.uuid.nullable().optional(),
  customerName: s.name.optional(),
  customerTaxId: z.string().max(20).optional(),
  customerBranch: z.string().max(20).optional(),
  customerAddress: z.string().max(500).optional(),
  receiptDate: s.isoDate.optional(),
  method: z.enum(METHODS),
  reference: z.string().trim().max(200).optional(),
  note: z.string().max(1000).optional(),
  /** invoices settled by this receipt; `amount` includes the part withheld (WHT) and the part covered by deposits */
  lines: z.array(z.object({
    invoiceId: s.uuid, amount: z.coerce.number().finite().positive(),
    /**
     * C4: the income the customer withheld tax on (ฐานเงินได้ ตาม 50 ทวิ, before VAT). Default: the service lines' pre-VAT part of the
     * amount paid when the invoice has service lines (no stock item), else the pre-VAT part of the amount paid.
     */
    whtBase: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().finite().min(0).optional()),
  })).default([]),
  /** deposits (มัดจำ) applied to the invoices above; no amount = as much as the deposit and the amount due allow */
  deposits: z.array(z.object({ depositId: s.uuid, amount: z.coerce.number().finite().positive().optional() })).default([]),
  /** a deposit receipt (no invoice): the amount received in advance, optionally against a sales order */
  depositAmount: z.coerce.number().finite().positive().optional(),
  /**
   * wave 8 (C2): VAT basis of `depositAmount` — `inclusive` (default: the money received, VAT inside), `exclusive` (amount before VAT;
   * the customer pays amount + 7%), `none` (not part of the price, e.g. a refundable guarantee — no tax point)
   */
  depositVatMode: z.enum(['inclusive', 'exclusive', 'none']).default('inclusive'),
  orderId: s.uuid.optional(),
  whtPct: z.coerce.number().refine((v) => WHT_RATES.includes(v), 'whtPct must be 0, 1, 2, 3 or 5').default(0),
  /** single-deposit shorthand for forms: same as deposits: [{ depositId, amount }] */
  applyDepositId: s.uuid.optional(),
  applyDepositAmount: z.coerce.number().finite().positive().optional(),
  /** wave 8: needed (with perm sales.lock.override) to date a receipt on/before the lock date */
  lockOverrideReason: z.string().trim().max(500).optional(),
}).transform(({ applyDepositId, applyDepositAmount, ...b }) => {
  if (applyDepositId) b.deposits = [...b.deposits, { depositId: applyDepositId, amount: applyDepositAmount }];
  return b;
});

const PAY_STATUS = `case when i.paid_amount >= i.gross then 'paid' when i.paid_amount > 0 then 'partially_paid' else 'outstanding' end`;
const INVOICE_SELECT = `select i.*, i.gross - i.paid_amount as outstanding, ${PAY_STATUS} as payment_status,
  o.no as order_no, o.ref as order_ref, o.customer_id, o.customer_name, o.customer_tax_id, o.customer_branch, o.customer_address
  from invoices i join sales_orders o on o.id = i.order_id`;

/** Line amounts after discount; VAT via @erp/thai — the same arithmetic as CRM quotations, so totals match to the satang. */
export function orderTotals(lines: { qty: number; unitPrice: number; discountPct?: number }[], vatMode: 'exclusive' | 'inclusive') {
  const t = documentTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice * (1 - (l.discountPct ?? 0) / 100) })), vatMode);
  const subtotal = round(lines.reduce((sum, l) => sum + round(l.qty * l.unitPrice), 0));
  const afterDiscount = round(t.amounts.reduce((a, b) => a + b, 0));
  return { ...t, subtotal, discount: round(subtotal - afterDiscount) };
}

interface NewOrder {
  customerId?: string | null; customerName: string; customerTaxId?: string | null; customerBranch?: string | null; customerAddress?: string | null;
  warehouseCode: string; orderDate?: string | null; vatMode: 'exclusive' | 'inclusive'; creditDays: number; ref?: string | null; note?: string | null;
  quotationId?: string | null; lines: OrderLine[];
}

async function insertOrder(c: Client, b: NewOrder, createdBy: string | null): Promise<string> {
  const t = orderTotals(b.lines, b.vatMode);
  const orderDate = b.orderDate ?? bangkokToday();
  const no = await nextDocNo(c, 'SO', new Date(orderDate));
  const o = (await c.query(
    `insert into sales_orders (no, customer_id, customer_name, customer_tax_id, customer_branch, customer_address, warehouse_code, order_date, vat_mode,
       subtotal, discount, net, vat, gross, note, created_by, ref, quotation_id, credit_days)
     values ($1,$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id`,
    [no, b.customerId ?? null, b.customerName, b.customerTaxId ?? null, b.customerBranch ?? null, b.customerAddress ?? null, b.warehouseCode, orderDate,
      b.vatMode, t.subtotal, t.discount, t.net, t.vat, t.gross, b.note ?? null, createdBy, b.ref ?? null, b.quotationId ?? null, b.creditDays],
  )).rows[0];
  for (const [i, l] of b.lines.entries()) {
    await c.query(
      `insert into so_lines (order_id, line_no, item_id, item_code, item_name, description, qty, unit_price, discount_pct, amount)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [o.id, i + 1, l.itemId ?? null, l.itemId ? l.itemCode : (l.itemCode ?? null), l.itemName ?? null, l.description ?? null, l.qty, l.unitPrice, l.discountPct ?? 0, t.amounts[i]],
    );
  }
  return o.id;
}

async function loadOrder(c: Client, id: string, lock = false) {
  const o = await one(c, `select * from sales_orders where id = $1 ${lock ? 'for update' : ''}`, [id], 'Sales order');
  o.lines = (await c.query('select * from so_lines where order_id = $1 order by line_no', [id])).rows;
  const inv = (await c.query(`select i.id, i.no, i.due_date, i.gross - i.paid_amount as outstanding, ${PAY_STATUS} as payment_status from invoices i where i.order_id = $1`, [id])).rows[0];
  o.invoice_id = inv?.id ?? null;
  o.invoice_no = inv?.no ?? null;
  o.payment_status = inv?.payment_status ?? null;
  o.outstanding = inv?.outstanding ?? null;
  o.deposits = (await c.query(`select id, no, receipt_date, total, deposit_remaining from receipts where kind = 'deposit' and order_id = $1 order by receipt_date, no`, [id])).rows;
  return o;
}

/**
 * C4: share of an order's value that is services (lines without a stock item), 0–1. An order with no service line → 1
 * (the whole pre-VAT amount is the WHT base, e.g. a customer that withholds on everything); a goods-only order with service lines mixed in → their share.
 */
async function serviceShare(c: Client, orderId: string): Promise<number> {
  const r = (await c.query(
    `select coalesce(sum(amount) filter (where item_id is null), 0) as service, coalesce(sum(amount), 0) as total, count(*) filter (where item_id is null)::int as n
     from so_lines where order_id = $1`, [orderId])).rows[0];
  if (!r.n || !(Number(r.total) > 0)) return 1;
  return Number(r.service) / Number(r.total);
}

/** Only lines with a stock item travel in stock events; service/description lines are not issued from stock. */
const stockLines = (o: { lines: any[] }) => o.lines.filter((l) => l.item_id);

function assertStatus(o: { status: string; no: string }, allowed: string[], action: string) {
  if (!allowed.includes(o.status)) throw conflict(`ทำรายการนี้กับ ${o.no} ไม่ได้ — อยู่ในสถานะ "${statusTh(o.status)}"`);
}

const fieldError = (field: string, message: string) => badRequest(message, { fieldErrors: { [field]: [message] } });

/** Same customer: by partner id when both sides have one, otherwise by name. */
function sameCustomer(a: { customer_id?: string | null; customer_name: string }, b: { customer_id?: string | null; customer_name: string }) {
  if (a.customer_id && b.customer_id) return a.customer_id === b.customer_id;
  return a.customer_name.trim() === b.customer_name.trim();
}

const asOfQuery = z.object({ asOf: s.isoDate.optional() });
/**
 * Open invoices AS OF a date ($1): issued on or before it, less only the receipts dated on or before it — a report for the end of
 * last month must not show invoices issued since, nor hide ones paid since (bugs-0.4 SAL-02). Columns: invoice `i` + order `o` + `open_amt`.
 */
const OPEN_AS_OF = `select i.*, o.customer_id, o.customer_name,
    i.gross - coalesce((select sum(rl.amount) from receipt_lines rl join receipts p on p.id = rl.receipt_id where rl.invoice_id = i.id and p.receipt_date <= $1::date), 0) as open_amt
  from invoices i join sales_orders o on o.id = i.order_id where i.issue_date <= $1::date`;
/** deposits received on or before $1 with what remained unapplied on that date (used by receipts dated, or deducted on invoices issued, on/before it) */
const DEPOSITS_AS_OF = `select d.customer_id, d.customer_name,
    d.total - coalesce((select sum(da.amount) from deposit_applications da left join receipts p on p.id = da.receipt_id left join invoices iv on iv.id = da.invoice_id
                        where da.deposit_id = d.id and coalesce(p.receipt_date, iv.issue_date) <= $1::date), 0) as remaining
  from receipts d where d.kind = 'deposit' and d.receipt_date <= $1::date`;
/** Today in Thailand (kernel business clock — the database runs in UTC). */
const bangkokToday = () => thaiToday();

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    app.post('/orders', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.write');
      const b = parse(OrderInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => loadOrder(c, await insertOrder(c, b, a.userId)));
    });

    app.get('/orders', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.read');
      const q = parse(s.listQuery.extend({ status: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from sales_orders where ($1::text is null or status = $1) and ($2::text is null or no ilike $2 or customer_name ilike $2 or ref ilike $2)
         order by created_at desc limit $3 offset $4`, [q.status ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    });

    /** Dashboard numbers: orders to act on, invoiced revenue per month, receivables (readable by sales or by accounts). */
    app.get('/summary', async (req) => {
      const a = auth(req);
      if (!hasPerm(a, 'sales.order.read')) requirePerm(a, 'sales.receivable.read');
      const today = bangkokToday();
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select count(*) filter (where status = 'draft')::int as to_confirm,
                  count(*) filter (where status = 'confirmed')::int as to_deliver,
                  count(*) filter (where status = 'delivered')::int as to_invoice from sales_orders`)).rows[0];
        const revenue = (await c.query(`select coalesce(sum(gross), 0) as total from invoices where date_trunc('month', issue_date) = date_trunc('month', $1::date)`, [today])).rows[0].total;
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month, coalesce(sum(i.gross), 0) as total
           from generate_series(date_trunc('month', $1::date) - interval '5 months', date_trunc('month', $1::date), interval '1 month') m left join invoices i on date_trunc('month', i.issue_date) = m group by m order by m`, [today])).rows;
        const rows = (await c.query(`select id, no, customer_name, status, gross from sales_orders where status <> 'cancelled' order by created_at desc limit 24`)).rows;
        const ar = (await c.query(
          `select coalesce(sum(gross - paid_amount), 0) as outstanding,
                  coalesce(sum(gross - paid_amount) filter (where due_date < $1::date), 0) as overdue,
                  count(*) filter (where due_date < $1::date)::int as overdue_count
           from invoices where paid_amount < gross`, [today])).rows[0];
        const rc = (await c.query(
          `select coalesce(sum(received) filter (where date_trunc('month', receipt_date) = date_trunc('month', $1::date)), 0) as received_month,
                  coalesce(sum(deposit_remaining) filter (where kind = 'deposit'), 0) as deposits from receipts`, [today])).rows[0];
        return {
          toConfirm: n.to_confirm, toDeliver: n.to_deliver, toInvoice: n.to_invoice, revenueMonth: revenue, months, rows,
          outstanding: ar.outstanding, overdue: ar.overdue, overdueCount: ar.overdue_count, receivedMonth: rc.received_month, unappliedDeposits: rc.deposits,
        };
      });
    });

    app.get('/orders/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadOrder(c, id));
    });

    app.post('/orders/:id/confirm', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOrder(c, id, true);
        assertStatus(o, ['draft'], 'confirm');
        await c.query(`update sales_orders set status = 'confirmed' where id = $1`, [id]);
        await k.emit(c, 'sales.order_confirmed', {
          orderId: o.id, orderNo: o.no, customerId: o.customer_id, customerName: o.customer_name, total: o.gross,
          lines: stockLines(o).map((l: any) => ({ itemId: l.item_id, itemCode: l.item_code, itemName: l.item_name ?? undefined, qty: l.qty, unitPrice: l.unit_price })),
        });
        return loadOrder(c, id);
      });
    });

    app.post('/orders/:id/deliver', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.deliver');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOrder(c, id, true);
        assertStatus(o, ['confirmed'], 'deliver');
        await c.query(`update sales_orders set status = 'delivered' where id = $1`, [id]);
        const lines = stockLines(o);
        // a service-only order has nothing to issue from stock
        if (lines.length) {
          await k.emit(c, 'sales.delivered', {
            orderId: o.id, orderNo: o.no, warehouseCode: o.warehouse_code,
            lines: lines.map((l: any) => ({ itemId: l.item_id, itemCode: l.item_code, itemName: l.item_name ?? undefined, qty: l.qty })),
          });
        }
        return loadOrder(c, id);
      });
    });

    app.post('/orders/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOrder(c, id, true);
        assertStatus(o, ['draft', 'confirmed'], 'cancel');
        await c.query(`update sales_orders set status = 'cancelled' where id = $1`, [id]);
        return loadOrder(c, id);
      });
    });

    app.post('/orders/:id/invoice', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'sales.invoice.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(InvoiceInput, req.body ?? {});
      if (b.dueDate && b.issueDate && b.dueDate < b.issueDate) throw fieldError('dueDate', 'วันครบกำหนดต้องไม่ก่อนวันที่ใบกำกับ');
      // the tax point is the Thai calendar day (the database runs in UTC: before 07:00 its current_date is yesterday) — bugs-0.4 SAL-03
      const issueDate = b.issueDate ?? bangkokToday();
      if (issueDate > bangkokToday()) throw fieldError('issueDate', 'ลงวันที่ใบกำกับภาษีล่วงหน้าไม่ได้');
      if (new Set(b.deposits?.map((d) => d.depositId)).size !== (b.deposits?.length ?? 0)) throw fieldError('deposits', 'ใบมัดจำซ้ำ');
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOrder(c, id, true);
        assertStatus(o, ['confirmed', 'delivered'], 'invoice');
        // C5: no tax invoice into a closed VAT month
        await guardLockDate(c, a, { module: 'sales', date: issueDate, what: 'ใบกำกับภาษี', overrideReason: b.lockOverrideReason });
        const no = await nextDocNo(c, 'INV', new Date(issueDate));
        const ded = await depositDeductions(c, o, issueDate, b.deposits, b.applyDeposits);
        const dn = round(ded.reduce((x, d) => x + d.net, 0));
        const dv = round(ded.reduce((x, d) => x + d.vat, 0));
        const dg = round(ded.reduce((x, d) => x + d.gross, 0));
        // this tax invoice charges only what the deposit tax invoices did not: base and VAT net of the deposits (C2)
        const vat = Math.max(0, round(o.vat - dv));
        const gross = round(o.gross - dg);
        const net = round(gross - vat);
        const inv = (await c.query(
          `insert into invoices (no, order_id, issue_date, due_date, net, vat, gross, deposit_net, deposit_vat, deposit_gross)
           values ($1, $2, $3::date, coalesce($4::date, $3::date + $5::int), $6, $7, $8, $9, $10, $11) returning id, issue_date, due_date`,
          [no, o.id, issueDate, b.dueDate ?? null, o.credit_days, net, vat, gross, dn, dv, dg],
        )).rows[0];
        for (const d of ded) {
          await c.query('insert into deposit_applications (invoice_id, invoice_no, deposit_id, deposit_no, amount, net, vat) values ($1,$2,$3,$4,$5,$6,$7)',
            [inv.id, no, d.depositId, d.depositNo, d.gross, d.net, d.vat]);
          await c.query('update receipts set deposit_remaining = deposit_remaining - $2, deposit_vat_remaining = deposit_vat_remaining - $3 where id = $1', [d.depositId, d.gross, d.vat]);
        }
        await c.query(`update sales_orders set status = 'invoiced' where id = $1`, [id]);
        await k.emit(c, 'sales.invoiced', {
          invoiceId: inv.id, invoiceNo: no, orderId: o.id, net, vat, gross,
          customerId: o.customer_id, customerName: o.customer_name, dueDate: isoDay(inv.due_date),
          issueDate: isoDay(inv.issue_date), vatMode: o.vat_mode,
          // C7: buyer's tax ID / branch for the sales VAT register
          customerTaxId: o.customer_tax_id ?? null, customerBranch: o.customer_branch ?? null,
          ...(ded.length ? { depositApplied: { net: dn, vat: dv, gross: dg, deposits: ded } } : {}),
        });
        return printableInvoice(c, inv.id, k.env);
      });
    });

    /** Invoices with payment status. `status` = outstanding | partially_paid | paid | open (not fully paid); `overdue=1` = open and past due. */
    app.get('/invoices', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.read');
      const q = parse(s.listQuery.extend({
        status: z.enum(['outstanding', 'partially_paid', 'paid', 'open']).optional(),
        overdue: z.enum(['0', '1', 'true', 'false']).optional(),
        customerId: s.uuid.optional(),
      }), req.query);
      const overdue = q.overdue === '1' || q.overdue === 'true';
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from (${INVOICE_SELECT}) x
         where ($1::text is null or ($1 = 'open' and payment_status <> 'paid') or payment_status = $1)
           and (not $2 or (payment_status <> 'paid' and due_date < $7::date))
           and ($3::uuid is null or customer_id = $3)
           and ($4::text is null or no ilike $4 or order_no ilike $4 or customer_name ilike $4 or order_ref ilike $4)
         order by due_date, no limit $5 offset $6`,
        [q.status ?? null, overdue, q.customerId ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset, bangkokToday()])).rows.map(withDaysOverdue));
    });

    app.get('/invoices/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => printableInvoice(c, id, k.env));
    });

    /* ---------------- receipts & deposits ---------------- */

    app.post('/receipts', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'sales.receipt.write');
      const b = parse(ReceiptInput, req.body);
      const isDeposit = b.depositAmount !== undefined;
      if (isDeposit && b.lines.length) throw fieldError('depositAmount', 'ใบรับมัดจำไม่ผูกใบกำกับ — ส่ง depositAmount หรือ lines อย่างใดอย่างหนึ่ง');
      if (!isDeposit && !b.lines.length) throw fieldError('lines', 'ระบุใบกำกับที่รับชำระอย่างน้อย 1 ใบ หรือ depositAmount สำหรับรับมัดจำ');
      if (isDeposit && b.deposits.length) throw fieldError('deposits', 'ใช้เงินมัดจำได้เฉพาะตอนรับชำระใบกำกับ');
      if (isDeposit && b.whtPct) throw fieldError('whtPct', 'บันทึกหัก ณ ที่จ่ายตอนรับชำระใบกำกับ');
      if (new Set(b.lines.map((l) => l.invoiceId)).size !== b.lines.length) throw fieldError('lines', 'ใบกำกับซ้ำในใบเสร็จเดียวกัน');
      if (new Set(b.deposits.map((d) => d.depositId)).size !== b.deposits.length) throw fieldError('deposits', 'ใบมัดจำซ้ำ');
      // Thai calendar day, not the database's UTC day; no future-dated receipts (bugs-0.4 SAL-01/SAL-03)
      const receiptDate = b.receiptDate ?? bangkokToday();
      if (receiptDate > bangkokToday()) throw fieldError('receiptDate', 'ลงวันที่ใบเสร็จล่วงหน้าไม่ได้');
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        let customer: { customer_id: string | null; customer_name: string; customer_tax_id: string | null; customer_branch: string | null; customer_address: string | null } | null =
          b.customerName ? { customer_id: b.customerId ?? null, customer_name: b.customerName, customer_tax_id: b.customerTaxId ?? null, customer_branch: b.customerBranch ?? null, customer_address: b.customerAddress ?? null } : null;
        await guardLockDate(c, a, { module: 'sales', date: receiptDate, what: isDeposit ? 'ใบรับเงินมัดจำ' : 'ใบเสร็จ', overrideReason: b.lockOverrideReason });
        const no = await nextDocNo(c, 'RC', new Date(receiptDate));

        if (isDeposit) {
          let orderId: string | null = null;
          if (b.orderId) {
            const o = await one(c, 'select * from sales_orders where id = $1', [b.orderId], 'Sales order');
            if (o.status === 'cancelled') throw conflict(`${o.no} ถูกยกเลิกแล้ว`);
            if (customer && !sameCustomer(customer, o)) throw fieldError('customerName', `ลูกค้าไม่ตรงกับใบสั่งขาย ${o.no}`);
            customer ??= o;
            orderId = o.id;
          }
          if (!customer) throw fieldError('customerName', 'ระบุลูกค้า');
          // C2: a deposit that is part of the price is a tax point — split VAT and issue a deposit tax invoice (DT-…) on the receipt date
          const v = b.depositVatMode === 'none' ? null : calcVat(b.depositAmount!, b.depositVatMode);
          const amount = v ? v.gross : round(b.depositAmount!);
          const taxInvoiceNo = v && v.vat > 0 ? await nextDocNo(c, 'DT', new Date(receiptDate)) : null;
          const r = (await c.query(
            `insert into receipts (no, kind, customer_id, customer_name, customer_tax_id, customer_branch, customer_address, order_id, receipt_date, method, reference,
               total, received, deposit_remaining, note, created_by, created_by_name, vat_mode, net, vat, tax_invoice_no, deposit_vat_remaining)
             values ($1,'deposit',$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11,$11,$11,$12,$13,$14,$15,$16,$17,$18,$17) returning id`,
            [no, customer.customer_id, customer.customer_name, customer.customer_tax_id, customer.customer_branch, customer.customer_address, orderId,
              receiptDate, b.method, b.reference ?? null, amount, b.note ?? null, a.userId, a.userName ?? null,
              b.depositVatMode, v?.net ?? null, v?.vat ?? 0, taxInvoiceNo],
          )).rows[0];
          await k.emit(c, 'sales.payment_received', {
            receiptId: r.id, receiptNo: no, receiptDate, kind: 'deposit', customerId: customer.customer_id, customerName: customer.customer_name, method: b.method,
            total: amount, whtAmount: 0, depositApplied: 0, received: amount, invoices: [],
            ...(v ? { net: v.net, vat: v.vat, taxInvoiceNo } : {}), customerTaxId: customer.customer_tax_id, customerBranch: customer.customer_branch,
          });
          return printableReceipt(c, r.id);
        }

        // payment against invoices
        const settled: { invoiceId: string; invoiceNo: string; amount: number; whtBase: number; outstanding: number }[] = [];
        for (const l of b.lines) {
          const inv = await one(c, `${INVOICE_SELECT} where i.id = $1 for update of i`, [l.invoiceId], 'Invoice');
          if (receiptDate < isoDay(inv.issue_date)) throw fieldError('receiptDate', `วันที่รับชำระต้องไม่ก่อนวันที่ใบกำกับ ${inv.no} (${formatThaiDate(inv.issue_date)})`);
          if (customer && !sameCustomer(customer, inv)) throw fieldError('lines', `${inv.no} เป็นของ ${inv.customer_name} ไม่ใช่ลูกค้าในใบเสร็จนี้`);
          customer ??= inv;
          const amount = round(l.amount);
          const outstanding = round(inv.gross - inv.paid_amount);
          if (amount > outstanding) throw fieldError('lines', `รับชำระ ${amount.toFixed(2)} เกินยอดค้าง ${outstanding.toFixed(2)} ของ ${inv.no}`);
          // C4: WHT is on services (and other income types), not on goods — default base = the service part of the amount paid, before VAT
          const preVat = inv.gross > 0 ? round((amount * inv.net) / inv.gross) : 0;
          const share = await serviceShare(c, inv.order_id);
          const whtBase = l.whtBase ?? round(preVat * share);
          if (whtBase > preVat + 0.01) throw fieldError('lines', `ฐานภาษีหัก ณ ที่จ่ายของ ${inv.no} (${whtBase.toFixed(2)}) เกินยอดก่อน VAT ของส่วนที่รับชำระ (${preVat.toFixed(2)})`);
          settled.push({ invoiceId: inv.id, invoiceNo: inv.no, amount, whtBase: round(whtBase), outstanding: round(outstanding - amount) });
        }
        const total = round(settled.reduce((x, l) => x + l.amount, 0));
        const whtBase = round(settled.reduce((x, l) => x + l.whtBase, 0));
        const whtAmount = round((whtBase * b.whtPct) / 100);

        const applied: { depositId: string; depositNo: string; amount: number }[] = [];
        for (const d of b.deposits) {
          const dep = await one(c, `select * from receipts where id = $1 and kind = 'deposit' for update`, [d.depositId], 'Deposit');
          if (!sameCustomer(customer!, dep)) throw fieldError('deposits', `มัดจำ ${dep.no} เป็นของ ${dep.customer_name}`);
          // C2: VAT on a deposit was charged on its deposit tax invoice — it is deducted on the final tax invoice, not on a receipt
          if (dep.vat_mode !== 'none') throw fieldError('deposits', `มัดจำ ${dep.no} ออกใบกำกับภาษีเงินมัดจำ ${dep.tax_invoice_no ?? ''} แล้ว — หักมัดจำในใบกำกับภาษีตอนออกใบกำกับ (ภาษีขายคิดเฉพาะส่วนที่เหลือ)`);
          const due = round(total - whtAmount - applied.reduce((x, y) => x + y.amount, 0));
          const amount = round(d.amount ?? Math.max(0, Math.min(Number(dep.deposit_remaining), due)));
          if (amount <= 0) throw fieldError('deposits', `มัดจำ ${dep.no} ไม่มียอดคงเหลือให้ใช้`);
          if (amount > Number(dep.deposit_remaining)) throw fieldError('deposits', `ใช้มัดจำ ${amount.toFixed(2)} เกินยอดคงเหลือ ${Number(dep.deposit_remaining).toFixed(2)} ของ ${dep.no}`);
          applied.push({ depositId: dep.id, depositNo: dep.no, amount });
        }
        const depositApplied = round(applied.reduce((x, d) => x + d.amount, 0));
        const received = round(total - whtAmount - depositApplied);
        if (received < 0) throw fieldError('deposits', `ใช้มัดจำ ${depositApplied.toFixed(2)} เกินยอดที่ต้องชำระหลังหัก ณ ที่จ่าย ${(total - whtAmount).toFixed(2)}`);

        const cu = customer!;
        const r = (await c.query(
          `insert into receipts (no, kind, customer_id, customer_name, customer_tax_id, customer_branch, customer_address, receipt_date, method, reference,
             total, wht_pct, wht_amount, deposit_applied, received, note, created_by, created_by_name)
           values ($1,'payment',$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
          [no, cu.customer_id, cu.customer_name, cu.customer_tax_id, cu.customer_branch, cu.customer_address, receiptDate, b.method, b.reference ?? null,
            total, b.whtPct, whtAmount, depositApplied, received, b.note ?? null, a.userId, a.userName ?? null],
        )).rows[0];
        for (const [i, l] of settled.entries()) {
          await c.query('insert into receipt_lines (receipt_id, line_no, invoice_id, invoice_no, amount, wht_base) values ($1,$2,$3,$4,$5,$6)', [r.id, i + 1, l.invoiceId, l.invoiceNo, l.amount, l.whtBase]);
          await c.query('update invoices set paid_amount = paid_amount + $2 where id = $1', [l.invoiceId, l.amount]);
        }
        for (const d of applied) {
          await c.query('insert into deposit_applications (receipt_id, deposit_id, deposit_no, amount) values ($1,$2,$3,$4)', [r.id, d.depositId, d.depositNo, d.amount]);
          await c.query('update receipts set deposit_remaining = deposit_remaining - $2 where id = $1', [d.depositId, d.amount]);
        }
        await k.emit(c, 'sales.payment_received', {
          receiptId: r.id, receiptNo: no, receiptDate, kind: 'payment', customerId: cu.customer_id, customerName: cu.customer_name, method: b.method,
          total, whtAmount, depositApplied, received,
          invoices: settled.map((l) => ({ invoiceId: l.invoiceId, invoiceNo: l.invoiceNo, amount: l.amount, outstanding: l.outstanding })),
          // C4: the income the WHT was computed on (accounting keeps it as the base of ภาษีถูกหัก ณ ที่จ่าย)
          ...(whtAmount > 0 ? { whtBase } : {}),
        });
        return printableReceipt(c, r.id);
      });
    });

    /** `kind` = payment | deposit; `open=1` = deposits with a remaining balance. */
    app.get('/receipts', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.receivable.read');
      const q = parse(s.listQuery.extend({
        kind: z.enum(['payment', 'deposit']).optional(),
        open: z.enum(['0', '1', 'true', 'false']).optional(),
        customerId: s.uuid.optional(),
      }), req.query);
      const open = q.open === '1' || q.open === 'true';
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select r.*, case r.kind when 'deposit' then 'มัดจำ' else 'รับชำระ' end as kind_label,
                case r.method when 'cash' then 'เงินสด' when 'transfer' then 'โอนเงิน' when 'cheque' then 'เช็ค' else 'บัตรเครดิต' end as method_label
         from receipts r
         where ($1::text is null or kind = $1) and (not $2 or (kind = 'deposit' and deposit_remaining > 0))
           and ($3::uuid is null or customer_id = $3)
           and ($4::text is null or no ilike $4 or customer_name ilike $4 or reference ilike $4)
         order by receipt_date desc, no desc limit $5 offset $6`,
        [q.kind ?? null, open, q.customerId ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    });

    app.get('/receipts/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.receivable.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => printableReceipt(c, id));
    });

    /* ---------------- lock date (C5) ---------------- */

    /** Tax invoices and receipts dated on/before `lockDate` are refused (409) unless `sales.lock.override` + `lockOverrideReason`. */
    app.get('/lock', async (req) => {
      const a = auth(req);
      if (!hasPerm(a, 'sales.lock.write') && !hasPerm(a, 'sales.invoice.write') && !hasPerm(a, 'sales.receipt.write')) requirePerm(a, 'sales.receivable.read');
      return k.db.tx(a.tenantId, async (c) => ({ id: 'lock', ...(await readLock(c)) }));
    });

    /** Set the lock date by hand (`null` clears it). Accounting's period close moves it forward automatically. */
    app.post('/lock', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.lock.write');
      const b = parse(z.object({ lockDate: z.preprocess((v) => (v === '' || v === undefined ? null : v), s.isoDate.nullable()) }), req.body ?? {});
      if (b.lockDate && b.lockDate > bangkokToday()) throw fieldError('lockDate', 'วันที่ปิดงวดต้องไม่เกินวันนี้');
      return k.db.tx(a.tenantId, async (c) => ({ id: 'lock', ...(await setLockDate(c, b.lockDate, a.userName ?? null)) }));
    });

    /* ---------------- receivables ---------------- */

    /** Outstanding (not fully paid) invoices by customer, with overdue amount and unapplied deposits. */
    app.get('/receivables', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.receivable.read');
      const { asOf = bangkokToday() } = parse(asOfQuery, req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const rows = (await c.query(
          `select coalesce(x.customer_id::text, x.customer_name) as key, (array_agg(x.customer_id))[1] as customer_id, max(x.customer_name) as customer_name,
                  count(*)::int as invoices, sum(x.open_amt) as outstanding,
                  coalesce(sum(x.open_amt) filter (where x.due_date < $1::date), 0) as overdue,
                  min(x.due_date) as oldest_due, greatest(max($1::date - x.due_date), 0) as max_days_overdue
           from (${OPEN_AS_OF}) x where x.open_amt > 0 group by 1 order by overdue desc, outstanding desc`, [asOf])).rows;
        const deposits = (await c.query(
          `select coalesce(customer_id::text, customer_name) as key, (array_agg(customer_id))[1] as customer_id, max(customer_name) as customer_name, sum(remaining) as deposits
           from (${DEPOSITS_AS_OF}) d where remaining > 0 group by 1`, [asOf])).rows;
        const byKey = new Map(rows.map((r) => [r.key, { ...r, deposits: 0 }]));
        for (const d of deposits) {
          const r = byKey.get(d.key);
          if (r) r.deposits = d.deposits;
          else byKey.set(d.key, { key: d.key, customer_id: d.customer_id, customer_name: d.customer_name, invoices: 0, outstanding: 0, overdue: 0, oldest_due: null, max_days_overdue: 0, deposits: d.deposits });
        }
        const list = [...byKey.values()].map((r) => ({ ...r, net_outstanding: round(Number(r.outstanding) - Number(r.deposits)) }));
        const sum = (f: string) => round(list.reduce((x, r: any) => x + Number(r[f]), 0));
        return { asOf, totals: { outstanding: sum('outstanding'), overdue: sum('overdue'), deposits: sum('deposits'), customers: list.length }, rows: list };
      });
    });

    /** Aging by due date: current (not yet due), 1–30, 31–60, 61–90, >90 days overdue. */
    app.get('/receivables/aging', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.receivable.read');
      const { asOf = bangkokToday() } = parse(asOfQuery, req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const rows = (await c.query(
          `with x as (select coalesce(v.customer_id::text, v.customer_name) as key, v.customer_id, v.customer_name, v.open_amt as amt, $1::date - v.due_date as days
                      from (${OPEN_AS_OF}) v where v.open_amt > 0)
           select key, (array_agg(customer_id))[1] as customer_id, max(customer_name) as customer_name,
                  coalesce(sum(amt) filter (where days <= 0), 0) as current,
                  coalesce(sum(amt) filter (where days between 1 and 30), 0) as d1_30,
                  coalesce(sum(amt) filter (where days between 31 and 60), 0) as d31_60,
                  coalesce(sum(amt) filter (where days between 61 and 90), 0) as d61_90,
                  coalesce(sum(amt) filter (where days > 90), 0) as over_90,
                  sum(amt) as total
           from x group by key order by over_90 desc, d61_90 desc, d31_60 desc, d1_30 desc, total desc`, [asOf])).rows;
        const buckets = ['current', 'd1_30', 'd31_60', 'd61_90', 'over_90', 'total'] as const;
        const totals = Object.fromEntries(buckets.map((b) => [b, round(rows.reduce((x, r) => x + Number(r[b]), 0))]));
        return { asOf, totals, rows };
      });
    });
  },

  handlers: {
    /** Accounting closed a period → documents dated up to its last day are locked here too (forward only). */
    'accounting.period_closed': async (e, { client }) => { await lockThroughPeriod(client, e.period, e.closedByName ?? 'ฝ่ายบัญชี (ปิดงวด)'); },
    /** Accounting reopened a period → an accounting lock steps back before it. */
    'accounting.period_reopened': async (e, { client }) => { await unlockPeriod(client, e.period, e.reopenedByName ?? 'ฝ่ายบัญชี (เปิดงวด)'); },
    /** CRM accepted a quotation → draft sales order with the same lines, discounts and VAT mode (once per quotation). */
    'crm.quotation_accepted': async (e, { client }) => {
      if (!e.lines?.length) return; // older CRM without line data: nothing to copy
      const exists = (await client.query('select 1 from sales_orders where quotation_id = $1', [e.quotationId])).rowCount;
      if (exists) return;
      const lines: OrderLine[] = e.lines.map((l) => ({
        itemId: l.itemId ?? null, itemCode: l.itemCode ?? undefined, itemName: l.itemName ?? undefined, description: l.description ?? undefined,
        qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct ?? 0,
      }));
      await insertOrder(client, {
        customerId: e.partnerId ?? null, customerName: e.customerName, customerTaxId: e.customerTaxId ?? null, customerBranch: e.customerBranch ?? null,
        customerAddress: e.customerAddress ?? null, warehouseCode: 'MAIN', vatMode: e.vatMode ?? 'exclusive', creditDays: 0,
        ref: e.no, quotationId: e.quotationId, note: `สร้างจากใบเสนอราคา ${e.no}`, lines,
      }, null);
    },
    /** Contracts sent an installment due for invoicing → draft service order for billing staff to confirm and invoice. */
    'contracts.installment_due': async (e, { client }) => draftInstallmentOrder(client, e),
  },
};

interface Deduction { depositId: string; depositNo: string; taxInvoiceNo: string | null; net: number; vat: number; gross: number }

/**
 * Deposits (with VAT) deducted on a tax invoice of order `o`, capped at the order's gross. The VAT part of a partial use is pro rata
 * to the deposit; the last use takes exactly what is left, so the deposit's VAT is reversed to the satang.
 */
async function depositDeductions(c: Client, o: any, issueDate: string, explicit: { depositId: string; amount?: number }[] | undefined, auto: boolean): Promise<Deduction[]> {
  let wanted: { dep: any; amount?: number }[];
  if (explicit) {
    wanted = [];
    for (const d of explicit) {
      const dep = await one(c, `select * from receipts where id = $1 and kind = 'deposit' for update`, [d.depositId], 'Deposit');
      if (!sameCustomer(o, dep)) throw fieldError('deposits', `มัดจำ ${dep.no} เป็นของ ${dep.customer_name}`);
      if (dep.vat_mode === 'none') throw fieldError('deposits', `มัดจำ ${dep.no} ไม่มีภาษีขาย — หักตอนรับชำระ (ใบเสร็จ) แทน`);
      if (isoDay(dep.receipt_date) > issueDate) throw fieldError('deposits', `มัดจำ ${dep.no} ลงวันที่หลังใบกำกับ`);
      wanted.push({ dep, amount: d.amount });
    }
  } else if (auto) {
    wanted = (await c.query(
      `select * from receipts where kind = 'deposit' and order_id = $1 and vat_mode <> 'none' and deposit_remaining > 0 and receipt_date <= $2::date
       order by receipt_date, no for update`, [o.id, issueDate])).rows.map((dep) => ({ dep }));
  } else return [];
  const out: Deduction[] = [];
  let left = round(Number(o.gross));
  for (const { dep, amount } of wanted) {
    const remaining = round(Number(dep.deposit_remaining));
    const use = round(amount ?? Math.min(remaining, left));
    if (amount !== undefined && use > remaining) throw fieldError('deposits', `หักมัดจำ ${use.toFixed(2)} เกินยอดคงเหลือ ${remaining.toFixed(2)} ของ ${dep.no}`);
    if (use > left) throw fieldError('deposits', `หักมัดจำ ${dep.no} ${use.toFixed(2)} เกินยอดใบกำกับที่เหลือ ${left.toFixed(2)}`);
    if (use <= 0) continue;
    const vat = use === remaining ? round(Number(dep.deposit_vat_remaining)) : round((use * Number(dep.vat)) / Number(dep.total));
    out.push({ depositId: dep.id, depositNo: dep.no, taxInvoiceNo: dep.tax_invoice_no ?? null, net: round(use - vat), vat, gross: use });
    left = round(left - use);
  }
  return out;
}

/** `contracts.installment_due` → one draft service order (amount before VAT, VAT exclusive), ref = contract no + installment. Once per installment. */
export async function draftInstallmentOrder(c: Client, e: EventData<'contracts.installment_due'>) {
  if (!(e.amount > 0)) return;
  if ((await c.query('select 1 from sales_orders where contract_installment_id = $1', [e.installmentId])).rowCount) return;
  const th = (d: string | null) => (d ? formatThaiDate(d) : null);
  const period = e.periodFrom && e.periodTo ? ` ช่วง ${th(e.periodFrom)} – ${th(e.periodTo)}` : '';
  const id = await insertOrder(c, {
    customerId: e.customerId, customerName: e.customerName, warehouseCode: 'MAIN', vatMode: 'exclusive', creditDays: 0,
    ref: `${e.contractNo} งวด ${e.seq}/${e.count}`.slice(0, 100),
    note: `สร้างจากงวดสัญญาบริการ ${e.contractNo} (ถึงกำหนด ${th(e.dueDate)}) — ตรวจสอบแล้วยืนยันและออกใบกำกับภาษี จากนั้นบันทึกเลขที่ใบกำกับในงวดสัญญา`,
    lines: [{ description: `ค่าบริการบำรุงรักษา (MA) ${e.title} ตามสัญญา ${e.contractNo} งวดที่ ${e.seq}/${e.count}${period}`.slice(0, 1000), qty: 1, unitPrice: e.amount, discountPct: 0 }],
  }, null);
  await c.query('update sales_orders set contract_installment_id = $2 where id = $1', [id, e.installmentId]);
}

const isoDay = (d: unknown) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : String(d).slice(0, 10));

function withDaysOverdue(r: any) {
  const due = isoDay(r.due_date);
  const days = r.payment_status === 'paid' ? 0 : Math.max(0, Math.round((Date.parse(bangkokToday()) - Date.parse(due)) / 86400000));
  return { ...r, days_overdue: days };
}

/** Everything a Thai tax invoice template needs, already formatted. */
async function printableInvoice(c: Client, id: string, env: NodeJS.ProcessEnv) {
  const inv = await one(c, `select i.*, i.gross - i.paid_amount as outstanding, ${PAY_STATUS} as payment_status from invoices i where i.id = $1`, [id], 'Invoice');
  const order = await loadOrder(c, inv.order_id);
  const receipts = (await c.query(
    `select r.id, r.no, r.receipt_date, l.amount from receipt_lines l join receipts r on r.id = l.receipt_id where l.invoice_id = $1 order by r.receipt_date, r.no`, [id])).rows;
  return {
    ...inv,
    issueDateTh: formatThaiDate(inv.issue_date),
    dueDateTh: formatThaiDate(inv.due_date),
    amountText: bahtText(inv.gross),
    customer: { id: order.customer_id, name: order.customer_name, taxId: order.customer_tax_id, branch: order.customer_branch, address: order.customer_address },
    orderNo: order.no,
    orderRef: order.ref,
    subtotal: order.subtotal,
    discount: order.discount,
    lines: order.lines,
    receipts,
    /** wave 8 (C2): deposits deducted on this tax invoice — the goods' full value is `net + deposit_net` (VAT `vat + deposit_vat`) */
    depositDeductions: (await c.query(
      `select da.deposit_id, da.deposit_no, r.tax_invoice_no, r.receipt_date, da.net, da.vat, da.amount as gross
       from deposit_applications da join receipts r on r.id = da.deposit_id where da.invoice_id = $1 order by r.receipt_date, da.deposit_no`, [id])).rows,
    promptPay: env.PROMPTPAY_ID && inv.gross > inv.paid_amount ? promptPayPayload(env.PROMPTPAY_ID, round(inv.gross - inv.paid_amount)) : null,
  };
}

/** Everything a Thai receipt (ใบเสร็จรับเงิน / ใบรับเงินมัดจำ) template needs, already formatted. */
async function printableReceipt(c: Client, id: string) {
  const r = await one(c, 'select * from receipts where id = $1', [id], 'Receipt');
  const lines = (await c.query(
    `select l.*, i.issue_date, i.due_date, i.gross as invoice_gross from receipt_lines l join invoices i on i.id = l.invoice_id where l.receipt_id = $1 order by l.line_no`, [id])).rows;
  const deposits = (await c.query('select deposit_id, deposit_no, amount from deposit_applications where receipt_id = $1 order by deposit_no', [id])).rows;
  const order = r.order_id ? (await c.query('select no from sales_orders where id = $1', [r.order_id])).rows[0] : null;
  return {
    ...r,
    title: r.kind === 'deposit' ? (Number(r.vat) > 0 ? 'ใบรับเงินมัดจำ / ใบกำกับภาษี' : 'ใบรับเงินมัดจำ') : 'ใบเสร็จรับเงิน',
    /** deposit tax invoice (wave 8): base and output VAT of the deposit; `applications` = where the deposit was used */
    vatLabel: r.kind === 'deposit' && Number(r.vat) > 0 ? `ภาษีมูลค่าเพิ่ม 7% (ฐาน ${Number(r.net).toLocaleString('th-TH', { minimumFractionDigits: 2 })})` : null,
    applications: r.kind === 'deposit'
      ? (await c.query(`select da.amount, da.net, da.vat, coalesce(da.invoice_no, p.no) as doc_no, case when da.invoice_id is null then 'receipt' else 'invoice' end as doc_kind
           from deposit_applications da left join receipts p on p.id = da.receipt_id where da.deposit_id = $1 order by doc_no`, [id])).rows
      : [],
    receiptDateTh: formatThaiDate(r.receipt_date),
    methodLabel: METHOD_TH[r.method] ?? r.method,
    amountText: bahtText(r.total),
    receivedText: bahtText(r.received),
    customer: { id: r.customer_id, name: r.customer_name, taxId: r.customer_tax_id, branch: r.customer_branch, address: r.customer_address },
    orderNo: order?.no ?? null,
    lines,
    deposits,
  };
}
