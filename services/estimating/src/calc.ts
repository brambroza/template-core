/**
 * Print-job costing: sheet arithmetic + the company's formulas (formula.ts) → cost and selling price for one print quantity.
 * Pure functions, no database — the service loads the rate tables and formulas and calls `calculate` once per quantity.
 *
 * Sizes are in inches and paper weight in gsm, the way Thai printers buy paper (31×43 นิ้ว 120 แกรม).
 */
import { round } from '@erp/thai';
import { evaluate, FormulaError, FUNCTION_NAMES, parseFormula, variablesOf, type Node } from './formula.ts';

export type PriceUnit = 'ream' | 'kg' | 'sheet';
export type ChargeBy = 'per_job' | 'per_sheet' | 'per_piece' | 'per_sqin';
export type FormulaKind = 'step' | 'cost' | 'price';

export interface PaperRate { code: string; name: string; gsm: number; widthIn: number; lengthIn: number; priceUnit: PriceUnit; price: number }
export interface PressRate {
  code: string; name: string; maxWidthIn: number | null; maxLengthIn: number | null; maxColors: number | null;
  plateCost: number; makereadyCost: number; runCostPer1000: number; minImpressions: number; makereadyWaste: number; runWastePct: number;
}
export interface FinishingRate { code: string; name: string; chargeBy: ChargeBy; rate: number; setupCost: number; minCharge: number; times: number }
export interface FormulaRow { code: string; label: string; expression: string; kind: FormulaKind; seq: number; unit: string | null }
export interface JobSpec {
  finishedW: number; finishedL: number; bleed: number; pressSheetW: number; pressSheetL: number;
  ups: number; cuts: number; colorsFront: number; colorsBack: number; marginPct: number;
}

/** Sheets in one ream — the unit paper merchants price by. */
export const REAM_SHEETS = 500;
/** น้ำหนักกระดาษ 1 รีม (กก.) = กว้าง × ยาว (นิ้ว) × แกรม ÷ 3100 */
export const REAM_WEIGHT_DIVISOR = 3100;

/** The formula whose result is "sheets through the press": per-sheet finishing is charged on it, so it must always exist. */
export const PRESS_SHEETS = 'pressSheets';

export interface VariableInfo { code: string; label: string; unit: string; group: string }

/** Every value a formula may read, besides the results of the formulas before it. Shown on the "ตัวแปรในสูตร" screen. */
export const INPUT_VARIABLES: VariableInfo[] = [
  { code: 'qty', label: 'ยอดพิมพ์', unit: 'ชิ้น', group: 'งานพิมพ์' },
  { code: 'ups', label: 'จำนวนชิ้นต่อแผ่นพิมพ์ (วางงาน)', unit: 'ชิ้น', group: 'งานพิมพ์' },
  { code: 'cuts', label: 'แผ่นพิมพ์ที่ตัดได้จากกระดาษแผ่นใหญ่ 1 แผ่น', unit: 'แผ่น', group: 'งานพิมพ์' },
  { code: 'colorsFront', label: 'จำนวนสีด้านหน้า', unit: 'สี', group: 'งานพิมพ์' },
  { code: 'colorsBack', label: 'จำนวนสีด้านหลัง', unit: 'สี', group: 'งานพิมพ์' },
  { code: 'colors', label: 'จำนวนสีรวมสองด้าน (= จำนวนเพลท)', unit: 'สี', group: 'งานพิมพ์' },
  { code: 'sides', label: 'จำนวนด้านที่พิมพ์ (1 หรือ 2)', unit: 'ด้าน', group: 'งานพิมพ์' },
  { code: 'finishedW', label: 'ขนาดงานสำเร็จ กว้าง', unit: 'นิ้ว', group: 'งานพิมพ์' },
  { code: 'finishedL', label: 'ขนาดงานสำเร็จ ยาว', unit: 'นิ้ว', group: 'งานพิมพ์' },
  { code: 'bleed', label: 'ตัดตก', unit: 'นิ้ว', group: 'งานพิมพ์' },
  { code: 'pressSheetW', label: 'แผ่นพิมพ์ กว้าง', unit: 'นิ้ว', group: 'งานพิมพ์' },
  { code: 'pressSheetL', label: 'แผ่นพิมพ์ ยาว', unit: 'นิ้ว', group: 'งานพิมพ์' },
  { code: 'pressSheetArea', label: 'พื้นที่แผ่นพิมพ์', unit: 'ตร.นิ้ว', group: 'งานพิมพ์' },
  { code: 'marginPct', label: 'กำไรที่บวก', unit: '%', group: 'งานพิมพ์' },
  { code: 'gsm', label: 'น้ำหนักกระดาษ', unit: 'แกรม', group: 'กระดาษ' },
  { code: 'paperW', label: 'กระดาษแผ่นใหญ่ กว้าง', unit: 'นิ้ว', group: 'กระดาษ' },
  { code: 'paperL', label: 'กระดาษแผ่นใหญ่ ยาว', unit: 'นิ้ว', group: 'กระดาษ' },
  { code: 'paperPrice', label: 'ราคากระดาษตามหน่วยที่ซื้อ (รีม / กก. / แผ่น)', unit: 'บาท', group: 'กระดาษ' },
  { code: 'reamWeightKg', label: 'น้ำหนักกระดาษ 1 รีม (กว้าง × ยาว × แกรม ÷ 3100)', unit: 'กก.', group: 'กระดาษ' },
  { code: 'paperSheetCost', label: 'ราคากระดาษแผ่นใหญ่ 1 แผ่น', unit: 'บาท', group: 'กระดาษ' },
  { code: 'plateCost', label: 'ค่าเพลทต่อแผ่น', unit: 'บาท', group: 'เครื่องพิมพ์' },
  { code: 'makereadyCost', label: 'ค่าตั้งเครื่องต่อสี', unit: 'บาท', group: 'เครื่องพิมพ์' },
  { code: 'runCostPer1000', label: 'ค่าพิมพ์ต่อสีต่อ 1,000 รอบ', unit: 'บาท', group: 'เครื่องพิมพ์' },
  { code: 'minImpressions', label: 'รอบพิมพ์ขั้นต่ำที่คิดเงิน', unit: 'รอบ', group: 'เครื่องพิมพ์' },
  { code: 'makereadyWaste', label: 'แผ่นเผื่อเสียตอนตั้งเครื่อง ต่อสี', unit: 'แผ่น', group: 'เครื่องพิมพ์' },
  { code: 'runWastePct', label: 'เผื่อเสียระหว่างพิมพ์', unit: '%', group: 'เครื่องพิมพ์' },
  { code: 'finishingCost', label: 'ค่างานหลังพิมพ์รวม (ใช้ได้หลังสูตร pressSheets)', unit: 'บาท', group: 'ระบบคำนวณให้' },
  { code: 'totalCost', label: 'ต้นทุนรวม = ผลรวมสูตรประเภทต้นทุน (ใช้ได้ในสูตรราคาขาย)', unit: 'บาท', group: 'ระบบคำนวณให้' },
];

const RESERVED = new Set([...INPUT_VARIABLES.map((v) => v.code), ...FUNCTION_NAMES]);

/** The formulas a company starts with (offset sheet-fed work). `system` ones may be rewritten but not switched off. */
export const DEFAULT_FORMULAS: (FormulaRow & { system: boolean; note: string })[] = [
  { seq: 10, code: 'netSheets', label: 'แผ่นพิมพ์สุทธิ', kind: 'step', unit: 'แผ่น', expression: 'ceil(qty / ups)', system: false, note: 'ยอดพิมพ์ ÷ จำนวนชิ้นต่อแผ่น ปัดขึ้น' },
  { seq: 20, code: 'wasteSheets', label: 'แผ่นเผื่อเสีย', kind: 'step', unit: 'แผ่น', expression: 'makereadyWaste * colors + ceil(netSheets * runWastePct / 100)', system: false, note: 'เผื่อตั้งเครื่องต่อสี + เผื่อเสียระหว่างพิมพ์' },
  { seq: 30, code: PRESS_SHEETS, label: 'แผ่นพิมพ์รวม', kind: 'step', unit: 'แผ่น', expression: 'netSheets + wasteSheets', system: true, note: 'งานหลังพิมพ์ที่คิดต่อแผ่นใช้จำนวนนี้' },
  { seq: 40, code: 'parentSheets', label: 'กระดาษแผ่นใหญ่ที่ใช้', kind: 'step', unit: 'แผ่น', expression: 'ceil(pressSheets / cuts)', system: false, note: '' },
  { seq: 50, code: 'paperCost', label: 'ค่ากระดาษ', kind: 'cost', unit: 'บาท', expression: 'parentSheets * paperSheetCost', system: false, note: '' },
  { seq: 60, code: 'plateTotal', label: 'ค่าเพลท', kind: 'cost', unit: 'บาท', expression: 'colors * plateCost', system: false, note: 'สีละ 1 เพลท' },
  { seq: 70, code: 'makereadyTotal', label: 'ค่าตั้งเครื่อง', kind: 'cost', unit: 'บาท', expression: 'colors * makereadyCost', system: false, note: '' },
  { seq: 80, code: 'printCost', label: 'ค่าพิมพ์', kind: 'cost', unit: 'บาท', expression: 'colors * max(pressSheets, minImpressions) / 1000 * runCostPer1000', system: false, note: 'คิดไม่ต่ำกว่ารอบพิมพ์ขั้นต่ำของเครื่อง' },
  { seq: 90, code: 'finishing', label: 'ค่างานหลังพิมพ์', kind: 'cost', unit: 'บาท', expression: 'finishingCost', system: false, note: 'รวมทุกรายการงานหลังพิมพ์ที่เลือกในใบประเมิน' },
  { seq: 900, code: 'unitPrice', label: 'ราคาขายต่อชิ้น', kind: 'price', unit: 'บาท', expression: 'roundup(totalCost * (1 + marginPct / 100) / qty, 2)', system: true, note: 'ต้นทุนรวมบวกกำไร หารยอดพิมพ์ ปัดขึ้นเป็นสตางค์' },
];

/** How many `inner` rectangles fit in an `outer` one, trying both orientations (no mixed layouts). */
export function fit(outerW: number, outerL: number, innerW: number, innerL: number): number {
  if (innerW <= 0 || innerL <= 0) return 0;
  const n = (a: number, b: number) => Math.floor(a / b + 1e-9);
  return Math.max(n(outerW, innerW) * n(outerL, innerL), n(outerW, innerL) * n(outerL, innerW));
}

/** Price of one parent sheet from the unit the paper is bought in. */
export function paperSheetCost(p: PaperRate): number {
  if (p.priceUnit === 'sheet') return p.price;
  if (p.priceUnit === 'ream') return p.price / REAM_SHEETS;
  return ((p.widthIn * p.lengthIn * p.gsm) / REAM_WEIGHT_DIVISOR) * p.price / REAM_SHEETS;
}

/** Input variables of one print quantity (everything in INPUT_VARIABLES except the two the engine fills in while it runs). */
export function inputVariables(job: JobSpec, paper: PaperRate, press: PressRate, qty: number): Record<string, number> {
  return {
    qty, ups: job.ups, cuts: job.cuts, colorsFront: job.colorsFront, colorsBack: job.colorsBack, colors: job.colorsFront + job.colorsBack,
    sides: job.colorsBack > 0 ? 2 : 1, finishedW: job.finishedW, finishedL: job.finishedL, bleed: job.bleed,
    pressSheetW: job.pressSheetW, pressSheetL: job.pressSheetL, pressSheetArea: job.pressSheetW * job.pressSheetL, marginPct: job.marginPct,
    gsm: paper.gsm, paperW: paper.widthIn, paperL: paper.lengthIn, paperPrice: paper.price,
    reamWeightKg: (paper.widthIn * paper.lengthIn * paper.gsm) / REAM_WEIGHT_DIVISOR, paperSheetCost: paperSheetCost(paper),
    plateCost: press.plateCost, makereadyCost: press.makereadyCost, runCostPer1000: press.runCostPer1000,
    minImpressions: press.minImpressions, makereadyWaste: press.makereadyWaste, runWastePct: press.runWastePct,
  };
}

export interface FinishingLine { code: string; name: string; chargeBy: ChargeBy; times: number; basis: number; rate: number; setupCost: number; amount: number }
export interface CostLine { code: string; label: string; kind: FormulaKind; unit: string | null; value: number }
export interface Breakdown {
  qty: number; lines: CostLine[]; finishing: FinishingLine[]; finishingCost: number; pressSheets: number;
  totalCost: number; unitCost: number; unitPrice: number; price: number; profit: number;
  /** every variable at the end of the run: the inputs plus each formula's result */
  values: Record<string, number>;
}

/** What each finishing charges for this run: set-up + rate × (job | sheets | pieces | square inches) × times, never under its minimum. */
function finishingLines(finishings: FinishingRate[], vars: Record<string, number>): FinishingLine[] {
  const sheets = vars[PRESS_SHEETS]!;
  return finishings.map((f) => {
    const basis = f.chargeBy === 'per_job' ? 1 : f.chargeBy === 'per_sheet' ? sheets : f.chargeBy === 'per_piece' ? vars.qty! : sheets * vars.pressSheetArea!;
    const amount = round(Math.max(f.setupCost + f.rate * basis * f.times, f.minCharge));
    return { code: f.code, name: f.name, chargeBy: f.chargeBy, times: f.times, basis: round(basis, 4), rate: f.rate, setupCost: f.setupCost, amount };
  });
}

/** Steps and costs in `seq` order, the selling-price formula last (it reads totalCost). */
function ordered(formulas: FormulaRow[]): FormulaRow[] {
  const bySeq = (a: FormulaRow, b: FormulaRow) => a.seq - b.seq || a.code.localeCompare(b.code);
  return [...formulas.filter((f) => f.kind !== 'price').sort(bySeq), ...formulas.filter((f) => f.kind === 'price').sort(bySeq)];
}

/**
 * Cost and price of one print quantity. Formulas run in order; each result becomes a variable for the ones after it.
 * A FormulaError names the formula that failed.
 */
export function calculate(input: { job: JobSpec; paper: PaperRate; press: PressRate; finishings: FinishingRate[]; formulas: FormulaRow[]; qty: number }): Breakdown {
  const vars = inputVariables(input.job, input.paper, input.press, input.qty);
  const lines: CostLine[] = [];
  let finishing: FinishingLine[] = [];
  let totalCost = 0;
  let unitPrice: number | undefined;
  for (const f of ordered(input.formulas)) {
    try {
      const tree: Node = parseFormula(f.expression);
      const reads = variablesOf(tree);
      if (reads.includes('finishingCost') && vars.finishingCost === undefined) {
        if (vars[PRESS_SHEETS] === undefined) throw new FormulaError(`ใช้ finishingCost ได้หลังสูตร ${PRESS_SHEETS} เท่านั้น — ปรับลำดับสูตร`);
        finishing = finishingLines(input.finishings, vars);
        vars.finishingCost = round(finishing.reduce((a, l) => a + l.amount, 0));
      }
      if (f.kind === 'price') vars.totalCost = totalCost;
      else if (reads.includes('totalCost')) throw new FormulaError('ใช้ totalCost ได้เฉพาะในสูตรประเภทราคาขาย');
      let value = evaluate(tree, vars);
      if (f.kind === 'cost') { value = round(value); totalCost = round(totalCost + value); }
      if (f.kind === 'price') { value = round(value, 4); unitPrice = value; }
      vars[f.code] = value;
      lines.push({ code: f.code, label: f.label, kind: f.kind, unit: f.unit, value: round(value, 4) });
    } catch (e) {
      if (e instanceof FormulaError) throw new FormulaError(`สูตร "${f.label}" (${f.code}): ${e.message}`);
      throw e;
    }
  }
  if (unitPrice === undefined) throw new FormulaError('ยังไม่มีสูตรประเภทราคาขายที่เปิดใช้งาน');
  if (vars[PRESS_SHEETS] === undefined) throw new FormulaError(`ไม่มีสูตร ${PRESS_SHEETS} ที่เปิดใช้งาน`);
  if (unitPrice < 0) throw new FormulaError('สูตรราคาขายให้ผลติดลบ');
  // per-sheet finishing is shown even when no cost formula reads finishingCost, so a missing charge is visible on the estimate
  if (!finishing.length && input.finishings.length) finishing = finishingLines(input.finishings, vars);
  const price = round(unitPrice * input.qty);
  return {
    qty: input.qty, lines, finishing, finishingCost: round(finishing.reduce((a, l) => a + l.amount, 0)), pressSheets: vars[PRESS_SHEETS],
    totalCost, unitCost: round(totalCost / input.qty, 4), unitPrice, price, profit: round(price - totalCost),
    values: { ...vars, totalCost },
  };
}

/** A typical job used to test a set of formulas before saving it (A4 leaflet, 4/4 colours, 31×43 paper cut in 4, laminated). */
export const SAMPLE = {
  job: { finishedW: 8.27, finishedL: 11.69, bleed: 0.125, pressSheetW: 15.5, pressSheetL: 21.5, ups: 2, cuts: 4, colorsFront: 4, colorsBack: 4, marginPct: 30 } satisfies JobSpec,
  paper: { code: 'SAMPLE', name: 'อาร์ตมัน 120 แกรม', gsm: 120, widthIn: 31, lengthIn: 43, priceUnit: 'ream', price: 1650 } satisfies PaperRate,
  press: { code: 'SAMPLE', name: 'ออฟเซ็ต 4 สี ตัด 4', maxWidthIn: 20, maxLengthIn: 28, maxColors: 4, plateCost: 350, makereadyCost: 300, runCostPer1000: 250, minImpressions: 1000, makereadyWaste: 50, runWastePct: 3 } satisfies PressRate,
  finishings: [{ code: 'SAMPLE', name: 'เคลือบ PVC ด้าน', chargeBy: 'per_sqin', rate: 0.006, setupCost: 0, minCharge: 500, times: 1 }] satisfies FinishingRate[],
  qty: 1000,
};

/**
 * Check a whole set of active formulas before it is saved: names, exactly one selling-price formula, the press-sheet formula,
 * and a trial run on the sample job (catches typos in variable names and formulas placed before the ones they read).
 * Returns a Thai message, or null when the set works.
 */
export function formulaSetProblem(formulas: FormulaRow[]): string | null {
  const seen = new Set<string>();
  for (const f of formulas) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(f.code)) return `รหัสสูตร "${f.code}" ต้องเป็นตัวอักษรอังกฤษหรือตัวเลข ขึ้นต้นด้วยตัวอักษร ไม่มีเว้นวรรค`;
    if (RESERVED.has(f.code) || RESERVED.has(f.code.toLowerCase())) return `รหัสสูตร "${f.code}" ซ้ำกับตัวแปรหรือฟังก์ชันของระบบ`;
    if (seen.has(f.code)) return `รหัสสูตร "${f.code}" ซ้ำกัน`;
    seen.add(f.code);
  }
  const prices = formulas.filter((f) => f.kind === 'price');
  if (prices.length !== 1) return `ต้องมีสูตรประเภทราคาขายที่เปิดใช้งาน 1 สูตร (ตอนนี้มี ${prices.length})`;
  try {
    calculate({ ...SAMPLE, formulas });
    return null;
  } catch (e) {
    if (e instanceof FormulaError) return e.message;
    throw e;
  }
}
