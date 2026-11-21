import { auth, badRequest, conflict, forbidden, guardLockDate, hasPerm, loadManifest, lockThroughPeriod, nextDocNo, one, parse, readLock, requirePerm, s, setLockDate, thaiToday, unlockPeriod, z, type AuthContext, type Client, type Kernel, type ServiceDefinition } from '@erp/kernel';
import { documentTotals, isValidThaiTaxId, VAT_RATE } from '@erp/thai';
import { fileURLToPath } from 'node:url';
import { statusTh } from '@erp/ui-schema';
import { payablesRoutes } from './payables.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const PoInput = z.object({
  supplierId: s.uuid.nullable().optional(),
  supplierName: s.name,
  warehouseCode: s.code.default('MAIN'),
  orderDate: s.isoDate.optional(),
  expectedDate: s.isoDate.optional(),
  vatMode: z.enum(['exclusive', 'inclusive']).default('exclusive'),
  note: z.string().max(1000).optional(),
  lines: z.array(s.pricedItemLine).min(1),
});
const ReceiveInput = z.object({
  /** omit to receive everything still outstanding */
  lines: z.array(z.object({ lineId: s.uuid, qty: s.positiveQty })).min(1).optional(),
  /** wave 8: the day the goods arrived (default today in Bangkok; not in the future) — Accounting books stock / AP / input VAT on it */
  receivedDate: s.isoDate.optional(),
  /** wave 8: needed (with perm purchasing.lock.override) to date a receipt on/before the lock date */
  lockOverrideReason: z.string().trim().max(500).optional(),
  /** C8 (optional): the supplier's tax invoice that came with the goods — shown on accounting's purchase VAT register */
  supplierInvoiceNo: z.string().trim().max(100).optional(),
  supplierInvoiceDate: s.isoDate.optional(),
  supplierTaxId: z.string().trim().regex(/^\d{13}$/, 'เลขประจำตัวผู้เสียภาษี 13 หลัก').refine(isValidThaiTaxId, 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง').optional(),
  /** '00000' = สำนักงานใหญ่ */
  supplierBranch: z.string().trim().max(20).optional(),
});
const IdParam = z.object({ id: s.uuid });
const ReturnInput = z.object({
  lines: z.array(z.object({ itemId: s.uuid, qty: s.positiveQty, reason: z.string().trim().max(500).optional() })).min(1),
  /** where the goods leave from; default = the PO's receiving warehouse (use QC-HOLD for rejected material) */
  warehouseCode: s.code.optional(),
  returnDate: s.isoDate.optional(),
  /** e.g. the NCR number that decided the return */
  refNo: z.string().trim().max(100).optional(),
  note: z.string().max(1000).optional(),
  /** wave 8: needed (with perm purchasing.lock.override) to date a return on/before the lock date */
  lockOverrideReason: z.string().trim().max(500).optional(),
});

const fmt = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 });
const baht = (n: number) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---------------- approval controls (wave 8: segregation of duties + approval limits) ---------------- */

/** The approve permissions a tier may name (lowest first). */
export const APPROVE_PERMS = ['purchasing.po.approve', 'purchasing.po.approve-high'] as const;
const PERM_TH: Record<string, string> = { 'purchasing.po.approve': 'อนุมัติใบสั่งซื้อ', 'purchasing.po.approve-high': 'อนุมัติใบสั่งซื้อวงเงินสูง' };
export type Tier = { upTo: number | null; perm: (typeof APPROVE_PERMS)[number] };
/** Secure defaults (also the DB column defaults): creator cannot approve; above 50,000 baht incl. VAT needs approve-high. */
export const DEFAULT_TIERS: Tier[] = [{ upTo: 50000, perm: 'purchasing.po.approve' }, { upTo: null, perm: 'purchasing.po.approve-high' }];

const TierInput = z.object({ upTo: z.number().finite().positive().nullable(), perm: z.enum(APPROVE_PERMS) });
const SettingsInput = z.object({
  creatorCannotApprove: z.boolean().optional(),
  approvalTiers: z.array(TierInput).min(1).max(5).optional(),
  /** form shortcut: the normal approvers' limit (baht incl. VAT); above it needs approve-high. 0 = one tier, no limit */
  standardApprovalLimit: z.number().finite().min(0).optional(),
}).superRefine((v, ctx) => {
  if (v.creatorCannotApprove === undefined && !v.approvalTiers && v.standardApprovalLimit === undefined) ctx.addIssue({ code: 'custom', message: 'ไม่มีค่าที่จะเปลี่ยน' });
  if (v.approvalTiers && v.standardApprovalLimit !== undefined) ctx.addIssue({ code: 'custom', path: ['standardApprovalLimit'], message: 'ส่ง approvalTiers หรือ standardApprovalLimit อย่างใดอย่างหนึ่ง' });
  const t = v.approvalTiers;
  if (!t) return;
  if (t[t.length - 1].upTo !== null) ctx.addIssue({ code: 'custom', path: ['approvalTiers'], message: 'ขั้นสุดท้ายต้องไม่มีเพดาน (upTo = null) — ไม่อย่างนั้นใบสั่งซื้อยอดสูงจะไม่มีใครอนุมัติได้' });
  for (let i = 0; i < t.length - 1; i++) {
    if (t[i].upTo === null) ctx.addIssue({ code: 'custom', path: ['approvalTiers', i, 'upTo'], message: 'เฉพาะขั้นสุดท้ายที่ไม่มีเพดาน' });
    else if (i > 0 && t[i - 1].upTo !== null && t[i].upTo! <= t[i - 1].upTo!) ctx.addIssue({ code: 'custom', path: ['approvalTiers', i, 'upTo'], message: 'วงเงินแต่ละขั้นต้องมากกว่าขั้นก่อนหน้า' });
  }
});

async function readSettings(c: Client) {
  const r = (await c.query('select creator_cannot_approve, approval_tiers from settings')).rows[0];
  const tiers: Tier[] = r?.approval_tiers ?? DEFAULT_TIERS;
  return {
    creatorCannotApprove: r?.creator_cannot_approve ?? true,
    approvalTiers: tiers,
    standardApprovalLimit: tiers.length > 1 ? tiers[0].upTo : 0,
    tiersText: tiers.map((t, i) => `${t.upTo === null ? (i ? `เกิน ${baht(tiers[i - 1].upTo!)} บาท` : 'ทุกยอด') : `ไม่เกิน ${baht(t.upTo)} บาท`}: ${PERM_TH[t.perm]}`).join(' · '),
  };
}

/** Index of the tier a PO of `gross` falls into (the last tier when none bounds it). */
const tierOf = (tiers: Tier[], gross: number) => {
  const i = tiers.findIndex((t) => t.upTo === null || gross <= t.upTo + 1e-9);
  return i === -1 ? tiers.length - 1 : i;
};

/** 403 unless `a` holds the tier's permission or a higher tier's (a high approver may approve small POs too). */
/** Approve a draft PO as `a`: segregation of duties (creator ≠ approver when set) and the approval tiers apply. */
async function approvePo(k: Pick<Kernel, 'emit'>, c: Client, id: string, a: AuthContext) {
  const po = await loadPo(c, id, true);
  if (po.status !== 'draft') throw conflict(`อนุมัติใบสั่งซื้อไม่ได้ — อยู่ในสถานะ "${statusTh(po.status)}"`);
  const cfg = await readSettings(c);
  // segregation of duties: whoever raised the PO cannot also approve it (setting creatorCannotApprove, default on)
  if (cfg.creatorCannotApprove && po.created_by && po.created_by === a.userId) {
    // whoever may change the rule gets told where (a one-person company would otherwise be stuck at its first PO)
    const howToOff = hasPerm(a, 'purchasing.settings.write')
      ? ' · ถ้าบริษัทมีคนทำจัดซื้อและอนุมัติคนเดียว ปิดข้อนี้ได้ที่ จัดซื้อ › ตั้งค่าการอนุมัติใบสั่งซื้อ'
      : '';
    throw forbidden(`ผู้สร้างใบสั่งซื้อ ${po.no} อนุมัติเองไม่ได้ (แยกหน้าที่ผู้สร้าง/ผู้อนุมัติ) — ให้ผู้มีสิทธิ์อนุมัติคนอื่นอนุมัติ${howToOff}`);
  }
  requireApprovalLimit(a, cfg.approvalTiers, po);
  await c.query(`update purchase_orders set status = 'approved', approved_by = $2, approved_by_name = $3, approved_at = now() where id = $1`, [id, a.userId, a.userName ?? null]);
  await k.emit(c, 'purchasing.po_approved', { poId: po.id, poNo: po.no, supplierName: po.supplier_name, gross: po.gross });
  return loadPo(c, id);
}

/**
 * "อนุมัติ" pressed on a LINE card (automation.line_decision, target purchasing.po): approve as that person with the app's rules
 * (SoD, approval tiers). Refused when their sessions were revoked after automation last saw their permissions, or they hold no
 * approve permission. Never throws: the Thai answer goes back as purchasing.line_decision_result.
 */
export async function linePoDecision(e: { lineActionId: string; userId: string; userName: string | null; perms: string[]; permsAt: number; entityId: string },
  ctx: { client: Client; tenantId: string; emit: (type: any, data: any) => Promise<string> }) {
  const c = ctx.client;
  const answer = (ok: boolean, message: string) => ctx.emit('purchasing.line_decision_result', { lineActionId: e.lineActionId, userId: e.userId, ok, message });
  const cutoff = (await c.query<{ before: string }>('select before from _revoked_tokens where user_id = $1', [e.userId])).rows[0];
  if (cutoff && Number(cutoff.before) > e.permsAt) return answer(false, 'สิทธิ์หรือการเข้าระบบของคุณเปลี่ยนไปหลังจากได้รับข้อความนี้ — เปิดแอปเพื่ออนุมัติแทน');
  const a: AuthContext = { tenantId: ctx.tenantId, userId: e.userId, userName: e.userName ?? undefined, perms: e.perms };
  if (!APPROVE_PERMS.some((p) => hasPerm(a, p))) return answer(false, 'บัญชีของคุณไม่มีสิทธิ์อนุมัติใบสั่งซื้อ');
  await c.query('savepoint line_decision');
  try {
    const po = await approvePo({ emit: (_c, type, data) => ctx.emit(type, data) } as Pick<Kernel, 'emit'>, c, e.entityId, a);
    await c.query('release savepoint line_decision');
    return answer(true, `✅ อนุมัติใบสั่งซื้อ ${po.no} (${po.supplier_name}) ยอด ${baht(po.gross)} บาทแล้ว`);
  } catch (err) {
    await c.query('rollback to savepoint line_decision');
    return answer(false, `อนุมัติไม่สำเร็จ: ${(err as Error).message}`);
  }
}

function requireApprovalLimit(a: AuthContext, tiers: Tier[], po: { no: string; gross: number }) {
  const i = tierOf(tiers, Number(po.gross));
  if (tiers.slice(i).some((t) => hasPerm(a, t.perm))) return;
  const own = [...tiers].reverse().find((t) => hasPerm(a, t.perm));
  throw forbidden(`${po.no} ยอด ${baht(po.gross)} บาท เกินวงเงินอนุมัติของคุณ${own?.upTo ? ` (ไม่เกิน ${baht(own.upTo)} บาท)` : ''} — ต้องให้ผู้มีสิทธิ์ "${PERM_TH[tiers[i].perm]}" อนุมัติ`);
}

async function loadPo(c: Client, id: string, lock = false) {
  const po = await one(c, `select * from purchase_orders where id = $1 ${lock ? 'for update' : ''}`, [id], 'Purchase order');
  po.lines = (await c.query('select *, received_qty - returned_qty as returnable_qty from po_lines where po_id = $1 order by line_no', [id])).rows;
  po.returns = (await c.query('select id, no, return_date, warehouse_code, gross, ref_no from purchase_returns where po_id = $1 order by created_at', [id])).rows;
  po.returned_gross = po.returns.reduce((a: number, r: any) => a + Number(r.gross), 0);
  po.receipts = (await c.query(
    `select id, created_at, received_by_name, by_approver, gross, note, supplier_invoice_no, supplier_invoice_date, supplier_tax_id, supplier_branch,
            case when by_approver then 'ผู้อนุมัติรับของเอง (ตรวจสอบการแยกหน้าที่)' else '' end as sod_note
     from po_receipts where po_id = $1 order by created_at`, [id])).rows;
  po.received_by_approver = po.receipts.some((r: any) => r.by_approver);
  return po;
}

async function loadReturn(c: Client, id: string) {
  const r = await one(c, 'select * from purchase_returns where id = $1', [id], 'Purchase return');
  r.lines = (await c.query('select * from purchase_return_lines where return_id = $1 order by line_no', [id])).rows;
  return r;
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  // supplier quotations on POs, delivery-note photos at receiving, evidence on returns
  attachments: {
    read: 'purchasing.po.read',
    write: ['purchasing.po.write', 'purchasing.po.receive'],
    entities: {
      po: 'purchase_orders',
      return: { table: 'purchase_returns', write: ['purchasing.po.return', 'purchasing.po.write'] },
      // wave 9: the supplier's tax invoice scan on the bill, the transfer slip on the payment
      bill: { table: 'supplier_bills', read: ['purchasing.bill.read'], write: ['purchasing.bill.write'] },
      payment: { table: 'supplier_payments', read: ['purchasing.payment.read'], write: ['purchasing.payment.write'] },
    },
  },
  routes(app, k) {
    app.post('/purchase-orders', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.write');
      const b = parse(PoInput, req.body);
      const t = documentTotals(b.lines, b.vatMode);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        // Thai calendar day, never the database's UTC current_date (round-2 #4)
        const orderDate = b.orderDate ?? thaiToday();
        const no = await nextDocNo(c, 'PO', new Date(orderDate));
        const po = (await c.query(
          `insert into purchase_orders (no, supplier_id, supplier_name, warehouse_code, order_date, expected_date, vat_mode, net, vat, gross, note, created_by, created_by_name)
           values ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
          [no, b.supplierId ?? null, b.supplierName, b.warehouseCode, orderDate, b.expectedDate ?? null, b.vatMode, t.net, t.vat, t.gross, b.note ?? null, a.userId, a.userName ?? null],
        )).rows[0];
        for (const [i, l] of b.lines.entries()) {
          await c.query(
            `insert into po_lines (po_id, line_no, item_id, item_code, item_name, qty, unit_price, amount) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [po.id, i + 1, l.itemId, l.itemCode, l.itemName ?? null, l.qty, l.unitPrice, t.amounts[i]],
          );
        }
        await k.emit(c, 'purchasing.po_created', { poId: po.id, poNo: no, supplierName: b.supplierName, gross: t.gross, createdById: a.userId });
        return loadPo(c, po.id);
      });
    });

    app.get('/purchase-orders', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.read');
      const q = parse(s.listQuery.extend({ status: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from purchase_orders where ($1::text is null or status = $1) and ($2::text is null or no ilike $2 or supplier_name ilike $2)
         order by created_at desc limit $3 offset $4`, [q.status ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    });

    /** Dashboard numbers: what needs action, spend per month, recent orders. */
    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.read');
      const today = thaiToday();
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select count(*) filter (where status = 'draft')::int as to_approve,
                  count(*) filter (where status in ('approved', 'partially_received'))::int as to_receive,
                  coalesce(sum(gross) filter (where status <> 'cancelled' and status <> 'draft' and date_trunc('month', order_date) = date_trunc('month', $1::date)), 0) as spend_month
           from purchase_orders`, [today])).rows[0];
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month, coalesce(sum(p.gross), 0) as total
           from generate_series(date_trunc('month', $1::date) - interval '5 months', date_trunc('month', $1::date), interval '1 month') m
           left join purchase_orders p on date_trunc('month', p.order_date) = m and p.status not in ('draft', 'cancelled')
           group by m order by m`, [today])).rows;
        const rows = (await c.query(`select id, no, supplier_name, status, gross from purchase_orders where status <> 'cancelled' order by created_at desc limit 24`)).rows;
        return { toApprove: n.to_approve, toReceive: n.to_receive, spendMonth: n.spend_month, months, rows };
      });
    });

    app.get('/purchase-orders/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadPo(c, id));
    });

    /** Company controls: creator-cannot-approve and approval tiers (GET: anyone who reads POs; PUT: purchasing.settings.write). */
    app.get('/settings', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.read');
      return k.db.tx(a.tenantId, readSettings);
    });

    app.put('/settings', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.settings.write');
      const b = parse(SettingsInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const tiers: Tier[] | null = b.approvalTiers
          ?? (b.standardApprovalLimit === undefined ? null
            : b.standardApprovalLimit > 0 ? [{ upTo: b.standardApprovalLimit, perm: 'purchasing.po.approve' }, { upTo: null, perm: 'purchasing.po.approve-high' }]
              : [{ upTo: null, perm: 'purchasing.po.approve' }]);
        await c.query(
          `insert into settings (tenant_id, creator_cannot_approve, approval_tiers)
           values (nullif(current_setting('app.tenant_id', true), '')::uuid, coalesce($1, true), coalesce($2::jsonb, $3::jsonb))
           on conflict (tenant_id) do update set creator_cannot_approve = coalesce($1, settings.creator_cannot_approve),
             approval_tiers = coalesce($2::jsonb, settings.approval_tiers)`,
          [b.creatorCannotApprove ?? null, tiers ? JSON.stringify(tiers) : null, JSON.stringify(DEFAULT_TIERS)]);
        return readSettings(c);
      });
    });

    /** Receipts made by the PO's own approver (allowed, logged) — the SoD exception list for the auditor. */
    app.get('/receipts', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.read');
      const q = parse(s.listQuery.extend({ byApprover: z.enum(['true', 'false', '1', '0']).optional(), poId: s.uuid.optional() }), req.query);
      const byApprover = q.byApprover === undefined ? null : q.byApprover === 'true' || q.byApprover === '1';
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select r.id, r.po_id, r.po_no, r.created_at, r.received_by, r.received_by_name, r.by_approver, r.gross, r.note, p.supplier_name, p.approved_by_name,
                (select string_agg(x->>'itemCode' || ' ×' || (x->>'qty'), ', ') from jsonb_array_elements(r.lines) x) as items
         from po_receipts r join purchase_orders p on p.id = r.po_id
         where ($1::boolean is null or r.by_approver = $1) and ($2::uuid is null or r.po_id = $2) and ($3::text is null or r.po_no ilike $3 or p.supplier_name ilike $3)
         order by r.created_at desc limit $4 offset $5`,
        [byApprover, q.poId ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    });

    app.post('/purchase-orders/:id/approve', async (req) => {
      const a = auth(req);
      if (!APPROVE_PERMS.some((p) => hasPerm(a, p))) requirePerm(a, 'purchasing.po.approve');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => approvePo(k, c, id, a));
    });

    app.post('/purchase-orders/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const po = await loadPo(c, id, true);
        if (!['draft', 'approved'].includes(po.status)) throw conflict(`ยกเลิกใบสั่งซื้อไม่ได้ — อยู่ในสถานะ "${statusTh(po.status)}"`);
        await c.query(`update purchase_orders set status = 'cancelled' where id = $1`, [id]);
        return loadPo(c, id);
      });
    });

    /**
     * Return to supplier (ใบส่งคืนสินค้า RT-…). Per item, up to received − already returned on this PO
     * (several PO lines of the same item are used in line order). Publishes purchasing.goods_returned → Inventory issues the qty.
     */
    app.post('/purchase-orders/:id/returns', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.return');
      const { id } = parse(IdParam, req.params);
      const b = parse(ReturnInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const po = await loadPo(c, id, true);
        if (!['partially_received', 'received'].includes(po.status)) throw conflict(`ส่งคืนไม่ได้: ${po.no} ยังไม่ได้รับของ (สถานะ ${po.status})`);
        const left = new Map<string, number>(po.lines.map((l: any) => [l.id, Number(l.received_qty) - Number(l.returned_qty)]));
        const out: { line: any; qty: number; reason: string | null }[] = [];
        for (const w of b.lines) {
          const lines = po.lines.filter((l: any) => l.item_id === w.itemId);
          if (!lines.length) throw badRequest('Validation failed', { fieldErrors: { lines: [`สินค้านี้ไม่อยู่ใน ${po.no}`] }, formErrors: [] });
          const can = lines.reduce((sum: number, l: any) => sum + left.get(l.id)!, 0);
          if (w.qty > can + 1e-9) {
            throw conflict(`ส่งคืน ${lines[0].item_code} ได้ไม่เกิน ${fmt(can)} (รับแล้ว ${fmt(lines.reduce((x: number, l: any) => x + Number(l.received_qty), 0))} ส่งคืนแล้ว ${fmt(lines.reduce((x: number, l: any) => x + Number(l.returned_qty), 0))})`);
          }
          let need = w.qty;
          for (const l of lines) {
            const take = Math.min(need, left.get(l.id)!);
            if (take <= 1e-9) continue;
            left.set(l.id, left.get(l.id)! - take);
            out.push({ line: l, qty: take, reason: w.reason ?? null });
            need -= take;
            if (need <= 1e-9) break;
          }
        }
        const t = documentTotals(out.map((o) => ({ qty: o.qty, unitPrice: Number(o.line.unit_price) })), po.vat_mode);
        const returnDate = b.returnDate ?? thaiToday();
        if (returnDate > thaiToday()) throw badRequest('Validation failed', { fieldErrors: { returnDate: ['ลงวันที่ส่งคืนล่วงหน้าไม่ได้'] }, formErrors: [] });
        await guardLockDate(c, a, { module: 'purchasing', date: returnDate, what: 'ใบส่งคืนสินค้า', overrideReason: b.lockOverrideReason });
        const no = await nextDocNo(c, 'RT', new Date(returnDate));
        const warehouseCode = b.warehouseCode ?? po.warehouse_code;
        const rt = (await c.query(
          `insert into purchase_returns (no, po_id, po_no, supplier_id, supplier_name, warehouse_code, return_date, vat_mode, net, vat, gross, ref_no, note, created_by, created_by_name)
           values ($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
          [no, po.id, po.no, po.supplier_id, po.supplier_name, warehouseCode, returnDate, po.vat_mode, t.net, t.vat, t.gross, b.refNo ?? null, b.note ?? null, a.userId, a.userName ?? null])).rows[0];
        for (const [i, o] of out.entries()) {
          await c.query(
            `insert into purchase_return_lines (return_id, po_line_id, line_no, item_id, item_code, item_name, qty, unit_price, amount, reason) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [rt.id, o.line.id, i + 1, o.line.item_id, o.line.item_code, o.line.item_name, o.qty, o.line.unit_price, t.amounts[i], o.reason]);
          await c.query('update po_lines set returned_qty = returned_qty + $2 where id = $1', [o.line.id, o.qty]);
        }
        await k.emit(c, 'purchasing.goods_returned', {
          returnId: rt.id, returnNo: no, poId: po.id, poNo: po.no, supplierId: po.supplier_id, supplierName: po.supplier_name, warehouseCode,
          lines: out.map((o) => ({ itemId: o.line.item_id, itemCode: o.line.item_code, itemName: o.line.item_name ?? undefined, qty: o.qty, unitPrice: Number(o.line.unit_price), reason: o.reason })),
          // wave 5: the credit note's VAT split → accounting reverses ภาษีซื้อ
          vatMode: po.vat_mode, net: t.net, vat: t.vat, gross: t.gross, returnDate,
        });
        return loadReturn(c, rt.id);
      });
    });

    app.get('/purchase-returns', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.read');
      const q = parse(s.listQuery.extend({ poId: s.uuid.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select r.*, (select string_agg(l.item_code || ' ×' || trim(to_char(l.qty, 'FM999999999990.####')), ', ' order by l.line_no) from purchase_return_lines l where l.return_id = r.id) as items
         from purchase_returns r
         where ($1::uuid is null or r.po_id = $1) and ($2::text is null or r.no ilike $2 or r.po_no ilike $2 or r.supplier_name ilike $2 or r.ref_no ilike $2)
         order by r.created_at desc limit $3 offset $4`, [q.poId ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    });

    app.get('/purchase-returns/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadReturn(c, id));
    });

    /* ---------- lock date (wave 8): goods receipts and returns dated on/before it are refused ---------- */

    app.get('/lock', async (req) => {
      const a = auth(req);
      if (!hasPerm(a, 'purchasing.lock.write')) requirePerm(a, 'purchasing.po.read');
      return k.db.tx(a.tenantId, async (c) => ({ id: 'lock', ...(await readLock(c)) }));
    });

    app.post('/lock', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.lock.write');
      const b = parse(z.object({ lockDate: z.preprocess((v) => (v === '' || v === undefined ? null : v), s.isoDate.nullable()) }), req.body ?? {});
      if (b.lockDate && b.lockDate > thaiToday()) throw badRequest('Validation failed', { fieldErrors: { lockDate: ['วันที่ปิดงวดต้องไม่เกินวันนี้'] }, formErrors: [] });
      return k.db.tx(a.tenantId, async (c) => ({ id: 'lock', ...(await setLockDate(c, b.lockDate, a.userName ?? null)) }));
    });

    // dry-runnable: the receive dialog previews stock, cost, accounting and QC effects before saving (kernel impact.ts)
    app.post('/purchase-orders/:id/receive', { config: { dryRun: true } }, async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.receive');
      const { id } = parse(IdParam, req.params);
      // empty optional text from a form = not given
      const b = parse(ReceiveInput, Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).filter(([, v]) => v !== '' && v !== null)));
      const receivedDate = b.receivedDate ?? thaiToday();
      if (receivedDate > thaiToday()) throw badRequest('Validation failed', { fieldErrors: { receivedDate: ['ลงวันที่รับสินค้าล่วงหน้าไม่ได้'] }, formErrors: [] });
      return k.db.tx(a.tenantId, async (c) => {
        await guardLockDate(c, a, { module: 'purchasing', date: receivedDate, what: 'รับสินค้า', overrideReason: b.lockOverrideReason });
        const po = await loadPo(c, id, true);
        if (!['approved', 'partially_received'].includes(po.status)) throw conflict(`รับของตามใบสั่งซื้อไม่ได้ — อยู่ในสถานะ "${statusTh(po.status)}"`);
        const wanted = b.lines ?? po.lines.map((l: any) => ({ lineId: l.id, qty: l.qty - l.received_qty })).filter((l: any) => l.qty > 0);
        const received = [];
        for (const w of wanted) {
          const line = po.lines.find((l: any) => l.id === w.lineId);
          if (!line) throw badRequest(`รายการที่เลือกไม่ได้อยู่ในใบสั่งซื้อ ${po.no}`);
          if (line.received_qty + w.qty > line.qty) throw conflict(`รายการที่ ${line.line_no} (${line.item_code}): รับ ${w.qty} เกินจำนวนค้างรับ ${line.qty - line.received_qty}`);
          await c.query('update po_lines set received_qty = received_qty + $2 where id = $1', [line.id, w.qty]);
          received.push({ itemId: line.item_id, itemCode: line.item_code, itemName: line.item_name ?? undefined, qty: w.qty, unitPrice: line.unit_price, vatRate: VAT_RATE });
        }
        // wave 5: this receipt's VAT split at the PO's VAT mode → accounting books stock (net) and ภาษีซื้อ (vat) separately
        const vt = documentTotals(received.map((r) => ({ qty: r.qty, unitPrice: Number(r.unitPrice) })), po.vat_mode);
        const done = (await c.query('select bool_and(received_qty >= qty) as all from po_lines where po_id = $1', [id])).rows[0].all;
        await c.query('update purchase_orders set status = $2 where id = $1', [id, done ? 'received' : 'partially_received']);
        // receipt log; the approver receiving their own PO is allowed (small sites) but flagged for the auditor (wave 8)
        const byApprover = !!po.approved_by && po.approved_by === a.userId;
        await c.query(
          `insert into po_receipts (po_id, po_no, received_by, received_by_name, by_approver, lines, gross, note,
             supplier_invoice_no, supplier_invoice_date, supplier_tax_id, supplier_branch) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [po.id, po.no, a.userId, a.userName ?? null, byApprover, JSON.stringify(received.map((r) => ({ itemId: r.itemId, itemCode: r.itemCode, qty: r.qty }))), vt.gross,
            byApprover ? `ผู้อนุมัติ ${a.userName ?? ''} รับของตามใบสั่งซื้อที่ตนอนุมัติเอง`.replace('  ', ' ') : null,
            b.supplierInvoiceNo ?? null, b.supplierInvoiceDate ?? null, b.supplierTaxId ?? null, b.supplierBranch ?? null]);
        if (byApprover) req.log.warn({ poNo: po.no, userId: a.userId }, 'purchasing: approver received own PO (segregation-of-duties exception logged)');
        await k.emit(c, 'purchasing.goods_received', {
          poId: po.id, poNo: po.no, supplierId: po.supplier_id, supplierName: po.supplier_name, warehouseCode: po.warehouse_code, lines: received,
          vatMode: po.vat_mode, net: vt.net, vat: vt.vat, gross: vt.gross, receivedDate,
          // C8: the supplier's tax invoice (when keyed in) for accounting's purchase VAT register
          ...(b.supplierInvoiceNo ? { supplierInvoiceNo: b.supplierInvoiceNo } : {}), ...(b.supplierInvoiceDate ? { supplierInvoiceDate: b.supplierInvoiceDate } : {}),
          ...(b.supplierTaxId ? { supplierTaxId: b.supplierTaxId } : {}), ...(b.supplierBranch ? { supplierBranch: b.supplierBranch } : {}),
        });
        return loadPo(c, id);
      });
    });

    // wave 9: supplier bills, payables/aging, supplier payments with WHT, 50 ทวิ, ภ.ง.ด.3/53 (src/payables.ts)
    payablesRoutes(app, k);
  },

  handlers: {
    'automation.line_decision': async (e, ctx) => { if (e.target === 'purchasing.po') await linePoDecision(e, ctx); },
    /** Accounting closed a period → receipts / returns dated up to its last day are locked (forward only). */
    'accounting.period_closed': async (e, { client }) => { await lockThroughPeriod(client, e.period, e.closedByName ?? 'ฝ่ายบัญชี (ปิดงวด)'); },
    'accounting.period_reopened': async (e, { client }) => { await unlockPeriod(client, e.period, e.reopenedByName ?? 'ฝ่ายบัญชี (เปิดงวด)'); },
  },
};
