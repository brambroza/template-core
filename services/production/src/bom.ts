import { badRequest, notFound, type Client } from '@erp/kernel';
import { round } from '@erp/thai';

export interface Requirement {
  itemId: string;
  itemCode: string;
  itemName?: string;
  qty: number;
}

interface BomLine { item_id: string; item_code: string; item_name: string | null; qty: number; scrap_pct: number }
interface Bom { id: string; item_id: string; item_code: string; output_qty: number; lines: BomLine[] }

export async function loadBom(c: Client, itemId: string): Promise<Bom | null> {
  const b = (await c.query('select * from boms where item_id = $1', [itemId])).rows[0];
  if (!b) return null;
  b.lines = (await c.query('select * from bom_lines where bom_id = $1 order by line_no', [b.id])).rows;
  return b;
}

/** Components needed to make `qty` of the BOM's item, one level down (including scrap allowance). */
export function directComponents(bom: Bom, qty: number): Requirement[] {
  return bom.lines.map((l) => ({
    itemId: l.item_id, itemCode: l.item_code, itemName: l.item_name ?? undefined,
    qty: round((l.qty * qty) / bom.output_qty / (1 - l.scrap_pct / 100), 4),
  }));
}

/**
 * Multi-level explosion: walks sub-assemblies that have their own BOM down to purchased items and
 * sums identical leaves. Throws on circular BOMs.
 */
export async function explode(c: Client, itemId: string, qty: number): Promise<Requirement[]> {
  const root = await loadBom(c, itemId);
  if (!root) throw notFound('BOM for item');
  const leaves = new Map<string, Requirement>();
  const walk = async (bom: Bom, q: number, path: string[]) => {
    for (const comp of directComponents(bom, q)) {
      if (path.includes(comp.itemId)) throw badRequest(`Circular BOM: ${[...path, comp.itemId].join(' -> ')}`);
      const sub = await loadBom(c, comp.itemId);
      if (sub) await walk(sub, comp.qty, [...path, comp.itemId]);
      else {
        const prev = leaves.get(comp.itemId);
        leaves.set(comp.itemId, prev ? { ...prev, qty: round(prev.qty + comp.qty, 4) } : comp);
      }
    }
  };
  await walk(root, qty, [root.item_id]);
  return [...leaves.values()].sort((a, b) => a.itemCode.localeCompare(b.itemCode));
}
