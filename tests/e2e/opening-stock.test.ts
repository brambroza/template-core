import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyResolved, mapImportRows, readXlsx, xlsxTemplate } from '@erp/ui-schema';
import { definition as identity } from '@erp/svc-identity';
import { definition as masterData } from '@erp/svc-master-data';
import { definition as inventory } from '@erp/svc-inventory';
import inventoryUi from '@erp/svc-inventory/ui';
import { install, type Installation } from './helpers.ts';

/**
 * ยอดสต็อกยกมา from the customer's Excel sheet, the way the web app does it: read the .xlsx, map the Thai headers, resolve item
 * codes through master-data (ImportSpec.resolve), dry run in inventory with per-row errors, then the real import.
 */
let erp: Installation;
let token: string;
beforeAll(async () => {
  erp = await install([identity, masterData, inventory]);
  ({ token } = await erp.provision('opening-co'));
  const api = (m: string, p: string, b?: unknown) => erp.call(m, p, b, token);
  for (const [code, name] of [['RM-01', 'เหล็กแผ่น'], ['FG-01', 'ขายึด']]) await api('POST', '/api/master-data/items', { code, name, type: 'raw', uom: 'ชิ้น' });
  for (const [code, name] of [['MAIN', 'คลังหลัก'], ['FG', 'คลังสินค้า']]) await api('POST', '/api/inventory/warehouses', { code, name });
});
afterAll(async () => { await erp?.close(); });

const spec = inventoryUi.screens.balances!.kind === 'list' ? inventoryUi.screens.balances!.import! : undefined!;
const api = (m: string, p: string, b?: unknown) => erp.call(m, p, b, token);

/** what ImportButton does with a file */
async function prepare(table: string[][]) {
  const bytes = xlsxTemplate(table[0]!, table.slice(1));
  const m = mapImportRows(spec.columns, await readXlsx(bytes));
  const codes = [...new Set(m.rows.map((r) => r.itemCode).filter(Boolean))];
  const answer = (await api('POST', `/api/${spec.resolve!.module}${spec.resolve!.endpoint}`, { codes })).body;
  return applyResolved(m.rows, spec.resolve!, answer);
}

describe('opening stock import', () => {
  it('reports every problem per row and writes nothing', async () => {
    const rows = await prepare([
      ['รหัสสินค้า', 'รหัสคลัง', 'จำนวนคงเหลือ', 'ต้นทุนต่อหน่วย'],
      ['rm-01', 'MAIN', '1,200', '32.5'],
      ['NOPE', 'MAIN', '5', ''],
      ['FG-01', 'XX', '5', ''],
      ['FG-01', 'FG', '0', ''],
      ['RM-01', 'main', '3', '1'],
    ]);
    const r = await api('POST', '/api/inventory/opening/import', { rows, dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dryRun: true, total: 5, created: 1 });
    expect(r.body.errors).toEqual([
      { row: 2, field: 'itemCode', message: expect.stringContaining('ไม่พบรหัสสินค้า NOPE') },
      { row: 3, field: 'warehouseCode', message: expect.stringContaining('ไม่พบคลัง XX') },
      { row: 4, field: 'qty', message: expect.stringContaining('มากกว่า 0') },
      { row: 5, field: 'itemCode', message: expect.stringContaining('ซ้ำกับแถวที่ 1') },
    ]);
    // a real run with errors still writes nothing
    expect((await api('POST', '/api/inventory/opening/import', { rows })).body.dryRun).toBe(true);
    expect((await api('GET', '/api/inventory/balances')).body).toEqual([]);
  });

  it('imports the good file, and refuses the same file a second time', async () => {
    const rows = await prepare([
      ['รหัสสินค้า', 'รหัสคลัง', 'จำนวนคงเหลือ', 'ต้นทุนต่อหน่วย'],
      ['RM-01', 'MAIN', '1,200', '32.5'],
      ['FG-01', 'FG', '40', ''],
    ]);
    const r = await api('POST', '/api/inventory/opening/import', { rows });
    expect(r.body).toMatchObject({ dryRun: false, created: 2, errors: [] });
    const bal = (await api('GET', '/api/inventory/balances')).body as { itemCode: string; warehouseCode: string; onHand: number }[];
    expect(bal.map((b) => [b.itemCode, b.warehouseCode, Number(b.onHand)]).sort()).toEqual([['FG-01', 'FG', 40], ['RM-01', 'MAIN', 1200]]);
    const again = await api('POST', '/api/inventory/opening/import', { rows, dryRun: true });
    expect(again.body.errors.map((e: { message: string }) => e.message)).toEqual([expect.stringContaining('มียอดยกมาแล้ว'), expect.stringContaining('มียอดยกมาแล้ว')]);
  });
});
