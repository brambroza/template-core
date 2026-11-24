import { describe, expect, it } from 'vitest';
import { calculate, DEFAULT_FORMULAS, fit, formulaSetProblem, INPUT_VARIABLES, paperSheetCost, SAMPLE, type FormulaRow } from '../src/calc.ts';

const formulas: FormulaRow[] = DEFAULT_FORMULAS.map(({ code, label, expression, kind, seq, unit }) => ({ code, label, expression, kind, seq, unit }));
const value = (b: ReturnType<typeof calculate>, code: string) => b.lines.find((l) => l.code === code)?.value;

describe('sheet arithmetic', () => {
  it('lays pieces out on a sheet in the better of the two orientations', () => {
    expect(fit(31, 43, 15.5, 21.5)).toBe(4);      // 31×43 parent sheet cut in 4
    expect(fit(15.5, 21.5, 8.52, 11.94)).toBe(2); // A4 + bleed: only fits turned
    expect(fit(24, 35, 12, 17.5)).toBe(4);
    expect(fit(15.5, 21.5, 16, 22)).toBe(0);      // too big either way
    expect(fit(31, 43, 3.1, 4.3)).toBe(100);      // exact multiples despite floating point
  });

  it('prices one parent sheet from a ream, a kilogram or a sheet price', () => {
    const paper = { code: 'P', name: 'P', gsm: 300, widthIn: 31, lengthIn: 43 };
    expect(paperSheetCost({ ...paper, priceUnit: 'ream', price: 1650 })).toBeCloseTo(3.3, 10);
    // 31 × 43 × 300 ÷ 3100 = 129 kg per ream → 129 × 30 ÷ 500 sheets
    expect(paperSheetCost({ ...paper, priceUnit: 'kg', price: 30 })).toBeCloseTo(7.74, 10);
    expect(paperSheetCost({ ...paper, priceUnit: 'sheet', price: 8.5 })).toBe(8.5);
  });
});

describe('standard formulas on the sample job (A4, 4/4 colours, 2-up, 31×43 cut in 4, PVC laminate)', () => {
  it('prices 1,000 pieces step by step', () => {
    const b = calculate({ ...SAMPLE, formulas });
    expect(value(b, 'netSheets')).toBe(500);        // 1,000 ÷ 2
    expect(value(b, 'wasteSheets')).toBe(415);      // 50 × 8 colours + 3% of 500
    expect(value(b, 'pressSheets')).toBe(915);
    expect(value(b, 'parentSheets')).toBe(229);     // 915 ÷ 4, rounded up
    expect(value(b, 'paperCost')).toBe(755.7);      // 229 × 3.30
    expect(value(b, 'plateTotal')).toBe(2800);      // 8 plates × 350
    expect(value(b, 'makereadyTotal')).toBe(2400);
    expect(value(b, 'printCost')).toBe(2000);       // 915 sheets is under the 1,000 minimum: 8 × 1,000 ÷ 1,000 × 250
    expect(b.finishing).toMatchObject([{ code: 'SAMPLE', basis: 304923.75, amount: 1829.54 }]); // 915 × 15.5 × 21.5 sq.in × 0.006
    expect(value(b, 'finishing')).toBe(1829.54);
    expect(b).toMatchObject({ pressSheets: 915, totalCost: 9785.24, unitCost: 9.7852, unitPrice: 12.73, price: 12730, profit: 2944.76 });
  });

  it('gets cheaper per piece as the run grows, and the run charge passes the press minimum', () => {
    const b = calculate({ ...SAMPLE, formulas, qty: 5000 });
    expect(value(b, 'pressSheets')).toBe(2975);
    expect(value(b, 'printCost')).toBe(5950);
    expect(b).toMatchObject({ totalCost: 19553.71, unitPrice: 5.09, price: 25450, profit: 5896.29 });
  });

  it('charges each finishing by its own basis and never under its minimum', () => {
    const finishings = [
      { code: 'DIE', name: 'ไดคัท', chargeBy: 'per_sheet' as const, rate: 0.5, setupCost: 1500, minCharge: 0, times: 1 },
      { code: 'FOLD', name: 'พับ', chargeBy: 'per_piece' as const, rate: 0.15, setupCost: 0, minCharge: 300, times: 2 },
      { code: 'PACK', name: 'แพ็ค', chargeBy: 'per_job' as const, rate: 250, setupCost: 0, minCharge: 0, times: 1 },
      { code: 'UV', name: 'สปอตยูวี', chargeBy: 'per_sqin' as const, rate: 0.001, setupCost: 0, minCharge: 800, times: 1 },
    ];
    const b = calculate({ ...SAMPLE, formulas, finishings });
    expect(b.finishing.map((l) => [l.code, l.amount])).toEqual([
      ['DIE', 1957.5],  // 1,500 + 915 sheets × 0.50
      ['FOLD', 300],    // 1,000 × 0.15 × 2 = 300
      ['PACK', 250],
      ['UV', 800],      // 304.92 is under the 800 minimum
    ]);
    expect(b.finishingCost).toBe(3307.5);
  });
});

describe('formulas as data', () => {
  it('a new cost formula joins the total, and a rewritten price formula changes the price', () => {
    const more: FormulaRow[] = [...formulas, { code: 'delivery', label: 'ค่าขนส่ง', expression: 'if(qty >= 5000, 800, 500)', kind: 'cost', seq: 95, unit: 'บาท' }];
    expect(calculate({ ...SAMPLE, formulas: more })).toMatchObject({ totalCost: 10285.24, unitPrice: 13.38, price: 13380 });
    // margin on the selling price instead of a mark-up on cost
    const onPrice = more.map((f) => (f.kind === 'price' ? { ...f, expression: 'roundup(totalCost / (1 - marginPct / 100) / qty, 2)' } : f));
    expect(calculate({ ...SAMPLE, formulas: onPrice })).toMatchObject({ totalCost: 10285.24, unitPrice: 14.7, price: 14700 });
  });

  it('accepts the standard set and explains what is wrong with a broken one', () => {
    expect(formulaSetProblem(formulas)).toBeNull();
    const change = (code: string, patch: Partial<FormulaRow>) => formulas.map((f) => (f.code === code ? { ...f, ...patch } : f));
    expect(formulaSetProblem(change('paperCost', { expression: 'parentSheet * paperSheetCost' }))).toBe('สูตร "ค่ากระดาษ" (paperCost): ไม่รู้จักตัวแปร "parentSheet"');
    // a formula placed before the one it reads
    expect(formulaSetProblem(change('parentSheets', { seq: 5 }))).toContain('ไม่รู้จักตัวแปร "pressSheets"');
    expect(formulaSetProblem(change('finishing', { seq: 15 }))).toContain('ใช้ finishingCost ได้หลังสูตร pressSheets');
    expect(formulaSetProblem(change('paperCost', { expression: 'totalCost * 0.1' }))).toContain('ใช้ totalCost ได้เฉพาะในสูตรประเภทราคาขาย');
    expect(formulaSetProblem(formulas.filter((f) => f.kind !== 'price'))).toContain('ต้องมีสูตรประเภทราคาขายที่เปิดใช้งาน 1 สูตร');
    expect(formulaSetProblem([...formulas, { code: 'qty', label: 'x', expression: '1', kind: 'step', seq: 1, unit: null }])).toContain('ซ้ำกับตัวแปรหรือฟังก์ชันของระบบ');
    expect(formulaSetProblem([...formulas, { code: 'ค่าส่ง', label: 'x', expression: '1', kind: 'cost', seq: 1, unit: null }])).toContain('ต้องเป็นตัวอักษรอังกฤษ');
    expect(formulaSetProblem(formulas.filter((f) => f.code !== 'pressSheets'))).toContain('pressSheets');
  });

  it('documents every input variable the engine provides', () => {
    const provided = Object.keys(calculate({ ...SAMPLE, formulas }).values);
    for (const v of INPUT_VARIABLES) expect(provided, v.code).toContain(v.code);
  });
});
