import { badRequest, notFound, type Client } from '@erp/kernel';
import { round } from '@erp/thai';

export interface Requirement {
  itemId: string;
  itemCode: string;
  itemName?: string;
  qty: number;
}

interface BomLine { item_id: string; item_code: string; item_name: string | null; qty: number; scrap_pct: number }
export interface Bom { id: string; item_id: string; item_code: string; item_name?: string | null; output_qty: number; lines: BomLine[] }

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
 * sums identical leaves. Throws on circular BOMs (the message names the item codes of the loop).
 */
export async function explode(c: Client, itemId: string, qty: number): Promise<Requirement[]> {
  return leafTotals(bomTree(await loadAllBoms(c), itemId, qty));
}

/** Every BOM of the tenant with its lines, keyed by item id (one query each; SME BOM sets are small). */
export async function loadAllBoms(c: Client): Promise<Map<string, Bom>> {
  const boms = (await c.query('select * from boms')).rows as Bom[];
  const lines = (await c.query('select * from bom_lines order by bom_id, line_no')).rows as (BomLine & { bom_id: string })[];
  const byId = new Map(boms.map((b) => [b.id, { ...b, lines: [] as BomLine[] }]));
  for (const l of lines) byId.get(l.bom_id)?.lines.push(l);
  return new Map([...byId.values()].map((b) => [b.item_id, b]));
}

/** One row of the indented (multi-level) BOM, depth first. `qty` = needed for the root quantity, scrap included. */
export interface TreeRow {
  id: string;
  level: number;
  item_id: string;
  item_code: string;
  item_name: string | null;
  /** quantity per one recipe of the parent (as entered on the parent BOM) */
  qty_per: number;
  scrap_pct: number;
  qty: number;
  /** this component has its own BOM (a sub-assembly made in-house) */
  has_bom: boolean;
  /** parent item code (blank for level 1) */
  parent_code: string;
  /** Thai: made in-house (has a BOM) or bought */
  source_label: string;
}

const cycleError = (path: string[], next: string, all: Map<string, Bom>) => {
  const code = (id: string) => all.get(id)?.item_code ?? id;
  return badRequest(`สูตรการผลิต (BOM) วนกลับมาที่ตัวเอง: ${[...path, next].map(code).join(' → ')}`);
};

/** The whole structure under `itemId` for `qty` units (default: one recipe = output_qty), depth first. */
export function bomTree(all: Map<string, Bom>, itemId: string, qty?: number): TreeRow[] {
  const root = all.get(itemId);
  if (!root) throw notFound('BOM for item');
  const rows: TreeRow[] = [];
  const walk = (bom: Bom, q: number, level: number, path: string[], key: string) => {
    bom.lines.forEach((l, i) => {
      if (path.includes(l.item_id)) throw cycleError(path, l.item_id, all);
      const need = round((l.qty * q) / bom.output_qty / (1 - l.scrap_pct / 100), 4);
      const sub = all.get(l.item_id);
      const id = `${key}.${i + 1}`;
      rows.push({ id, level, item_id: l.item_id, item_code: l.item_code, item_name: l.item_name, qty_per: Number(l.qty), scrap_pct: Number(l.scrap_pct), qty: need, has_bom: !!sub, parent_code: level === 1 ? '' : bom.item_code, source_label: sub ? 'ผลิตเอง' : 'ซื้อ' });
      if (sub) walk(sub, need, level + 1, [...path, l.item_id], id);
    });
  };
  walk(root, qty ?? Number(root.output_qty), 1, [root.item_id], '1');
  return rows;
}

/** Leaf (bought) materials for `qty` of the item across every level, identical items summed. */
export function leafTotals(tree: TreeRow[]): Requirement[] {
  const leaves = new Map<string, Requirement>();
  for (const r of tree) {
    if (r.has_bom) continue;
    const prev = leaves.get(r.item_id);
    leaves.set(r.item_id, prev ? { ...prev, qty: round(prev.qty + r.qty, 4) } : { itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name ?? undefined, qty: r.qty });
  }
  return [...leaves.values()].sort((a, b) => a.itemCode.localeCompare(b.itemCode));
}

/** Where-used, walking up: level 1 = BOMs that list the item directly, level 2 = BOMs that use those, … */
export function whereUsed(all: Map<string, Bom>, itemId: string): { id: string; level: number; item_id: string; item_code: string; item_name: string | null; qty_per: number; via: string }[] {
  const out: { id: string; level: number; item_id: string; item_code: string; item_name: string | null; qty_per: number; via: string }[] = [];
  const seen = new Set<string>([itemId]);
  const walk = (id: string, level: number, via: string) => {
    for (const b of all.values()) {
      const line = b.lines.find((l) => l.item_id === id);
      if (!line || seen.has(b.item_id)) continue;
      seen.add(b.item_id);
      out.push({ id: `${level}.${b.item_id}`, level, item_id: b.item_id, item_code: b.item_code, item_name: b.item_name ?? null, qty_per: Number(line.qty), via });
      walk(b.item_id, level + 1, b.item_code);
    }
  };
  walk(itemId, 1, '');
  return out;
}

/** Depth of the structure (1 = only bought parts) — 0 when the item has no BOM. */
export function depthOf(all: Map<string, Bom>, itemId: string): number {
  const tree = all.has(itemId) ? bomTree(all, itemId) : [];
  return tree.reduce((m, r) => Math.max(m, r.level), 0);
}
