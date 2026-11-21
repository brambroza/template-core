/**
 * Put an industry's sample data into a new trial company through the modules' real HTTP APIs (through the gateway), so stock
 * cards, journals and QC inspections come from the same events real work raises.
 *
 * Two made-up helpers do the work ("ผู้บันทึกตัวอย่าง" creates, "ผู้อนุมัติตัวอย่าง" approves), never the owner: the purchase order
 * left waiting for approval was raised by someone else, so the owner can approve it under the separation-of-duties rule.
 * Modules outside the company's plan are skipped.
 *
 * Dates are relative to today in Asia/Bangkok, so the data always looks recent.
 */
import { INDUSTRIES, type Industry, type IndustryId, type Line } from './industries.ts';

export type Call = <T = any>(method: string, path: string, body?: unknown) => Promise<T>;

export interface StarterApi {
  /** calls as the helper who records documents */
  clerk: Call;
  /** calls as the helper who approves them */
  approver: Call;
  /** installed and in the company's plan */
  has: (module: string) => boolean;
  /** wait until the events raised so far have been handled (stock, journals) */
  settle: () => Promise<void>;
  /** progress lines for the log */
  log?: (line: string) => void;
}

/** What was created, for the welcome banner ("ลองทำต่อ"). */
export interface StarterSummary {
  industry: IndustryId;
  items: number;
  partners: number;
  /** PO number waiting for the owner's approval, the PO waiting to be received, the SO waiting to be shipped */
  next: { approvePo?: string; receivePo?: string; shipSo?: string; invoiceSo?: string };
}

const BKK_MS = 7 * 3600 * 1000;
/** Today in Asia/Bangkok, `n` days later (negative = earlier), as YYYY-MM-DD. */
export function bkkDay(n = 0, now = Date.now()): string {
  return new Date(now + BKK_MS + n * 86_400_000).toISOString().slice(0, 10);
}

type ItemRef = { itemId: string; itemCode: string; itemName: string };

/** Seed `industry` into the company the two calls belong to. Throws on the first failed call (the caller records it). */
export async function seedStarter(api: StarterApi, industryId: IndustryId): Promise<StarterSummary> {
  const ind: Industry = INDUSTRIES[industryId];
  const { clerk, approver, has } = api;
  const log = api.log ?? (() => {});
  const next: StarterSummary['next'] = {};
  const wh = ind.warehouses[0]![0];

  // chart of accounts + posting rules before the first business event, so purchases and sales post journals
  if (has('accounting')) {
    await clerk('POST', '/api/accounting/accounts/setup');
    log('accounting: chart of accounts');
  }

  const items: Record<string, ItemRef> = {};
  for (const [code, name, type, uom, price] of ind.items) {
    const r = await clerk<{ id: string }>('POST', '/api/master-data/items', { code, name, type, uom, stdPrice: price || undefined });
    items[code] = { itemId: r.id, itemCode: code, itemName: name };
  }
  const lines = (ls: Line[]) => ls.map(([code, qty, unitPrice]) => ({ ...items[code]!, qty, unitPrice }));

  const partners: Record<string, { id: string; name: string; address: string; taxId: string; creditDays: number }> = {};
  for (const [code, name, kind, taxId, address, creditDays] of ind.partners) {
    const r = await clerk<{ id: string }>('POST', '/api/master-data/partners', { code, name, kind, taxId, branch: '00000', address });
    partners[code] = { id: r.id, name, address, taxId, creditDays };
  }
  log(`master-data: ${ind.items.length} items, ${ind.partners.length} partners`);

  // QC plans before goods arrive or production finishes, so those raise real inspections
  if (has('quality') && ind.qc) {
    for (const p of ind.qc) {
      await clerk('POST', '/api/quality/plans', { ...items[p.item]!, stage: p.stage, name: p.name, samplingMode: 'fixed', samplingValue: 3, checkpoints: p.checkpoints });
    }
    log(`quality: ${ind.qc.length} plans`);
  }

  if (has('inventory')) {
    for (const [code, name] of ind.warehouses) await clerk('POST', '/api/inventory/warehouses', { code, name });
    for (const [code, minQty] of ind.reorder) await clerk('PUT', '/api/inventory/reorder-points', { ...items[code]!, warehouseCode: wh, minQty });
    await clerk('POST', '/api/inventory/receipts', {
      warehouseCode: wh, refType: 'opening', refId: 'OPEN-SAMPLE', note: 'ยอดยกมา (ข้อมูลตัวอย่าง)',
      lines: ind.opening.map(([code, qty, unitCost]) => ({ ...items[code]!, qty, unitCost })),
    });
    log('inventory: warehouses, reorder points, opening stock');
  }

  if (has('purchasing')) {
    for (const p of ind.purchases) {
      const s = partners[p.supplier]!;
      const day = bkkDay(-p.daysAgo);
      const po = await clerk<{ id: string; no: string }>('POST', '/api/purchasing/purchase-orders', {
        supplierId: s.id, supplierName: s.name, warehouseCode: wh, orderDate: day, lines: lines(p.lines),
      });
      if (p.stage === 'submitted') { next.approvePo = po.no; continue; }
      await approver('POST', `/api/purchasing/purchase-orders/${po.id}/approve`);
      if (p.stage === 'approved') { next.receivePo = po.no; continue; }
      await clerk('POST', `/api/purchasing/purchase-orders/${po.id}/receive`, {
        receivedDate: day, supplierInvoiceNo: `IV-${po.no.slice(-4)}`, supplierInvoiceDate: day, supplierTaxId: s.taxId, supplierBranch: '00000',
      });
    }
    await api.settle();
    log(`purchasing: ${ind.purchases.length} purchase orders`);
  }

  if (has('production') && ind.boms) {
    for (const b of ind.boms) {
      await clerk('PUT', '/api/production/boms', { ...items[b.item]!, lines: b.lines.map(([code, qty, scrapPct]) => ({ ...items[code]!, qty, ...(scrapPct ? { scrapPct } : {}) })) });
    }
    for (const o of ind.production ?? []) {
      const mo = await clerk<{ id: string }>('POST', '/api/production/orders', { ...items[o.item]!, qty: o.qty, warehouseCode: wh, dueDate: bkkDay(o.dueInDays) });
      if (o.stage === 'planned') continue;
      await clerk('POST', `/api/production/orders/${mo.id}/release`);
      if (o.stage === 'completed') {
        await clerk('POST', `/api/production/orders/${mo.id}/complete`, {});
        await api.settle(); // the next order may use what this one made
      }
    }
    log(`production: ${ind.boms.length} BOMs, ${(ind.production ?? []).length} orders`);
  }

  if (has('sales')) {
    for (const o of ind.sales) {
      const c = partners[o.customer]!;
      const day = bkkDay(-o.daysAgo);
      const so = await clerk<{ id: string; no: string }>('POST', '/api/sales/orders', {
        customerId: c.id, customerName: c.name, customerAddress: c.address, customerTaxId: c.taxId, customerBranch: '00000',
        orderDate: day, warehouseCode: wh, creditDays: c.creditDays, lines: lines(o.lines),
      });
      if (o.stage === 'draft') continue;
      await clerk('POST', `/api/sales/orders/${so.id}/confirm`);
      if (o.stage === 'confirmed') { next.shipSo ??= so.no; continue; }
      await clerk('POST', `/api/sales/orders/${so.id}/deliver`);
      if (o.stage === 'delivered') { next.invoiceSo ??= so.no; continue; }
      await clerk('POST', `/api/sales/orders/${so.id}/invoice`, { issueDate: day });
    }
    await api.settle();
    log(`sales: ${ind.sales.length} orders`);
  }

  if (has('maintenance') && ind.machines) {
    const machines: Record<string, string> = {};
    for (const [code, name, location] of ind.machines) machines[code] = (await clerk<{ id: string }>('POST', '/api/maintenance/machines', { code, name, location })).id;
    if (ind.repair) await clerk('POST', '/api/maintenance/work-orders', { machineId: machines[ind.repair.machine], title: ind.repair.title });
    for (const [code, title, intervalDays] of ind.pm ?? []) {
      await clerk('POST', '/api/maintenance/pm-plans', { machineId: machines[code], title, intervalDays, firstDueOn: bkkDay(Math.min(intervalDays, 7)) });
    }
    log(`maintenance: ${ind.machines.length} machines`);
  }

  if (has('booking')) {
    for (const r of [
      { code: 'ROOM-1', name: 'ห้องประชุม', kind: 'room', capacity: 10 },
      { code: 'CAR-1', name: 'รถกระบะส่งของ', kind: 'vehicle', capacity: 2, requiresApproval: true },
    ]) await clerk('POST', '/api/booking/resources', r);
    log('booking: meeting room, pickup truck');
  }

  await api.settle();
  return { industry: industryId, items: ind.items.length, partners: ind.partners.length, next };
}
