import { auth, badRequest, conflict, HttpError, loadManifest, nextDocNo, one, parse, requirePerm, s, z, type Client, type Kernel, type ServiceDefinition } from '@erp/kernel';
import { round } from '@erp/thai';
import { fileURLToPath } from 'node:url';
import {
  calculate, DEFAULT_FORMULAS, fit, formulaSetProblem, INPUT_VARIABLES, SAMPLE,
  type Breakdown, type ChargeBy, type FinishingRate, type FormulaRow, type JobSpec, type PaperRate, type PressRate,
} from './calc.ts';
import { evaluate, FormulaError, parseFormula } from './formula.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- request schemas ---------------- */

const text = (max = 200) => z.string().trim().max(max).optional();
const inches = z.number().finite().positive().max(200);
/** rates may need more than two decimals (lamination per square inch) */
const rate = z.number().finite().min(0);

const PaperInput = z.object({
  code: s.code, name: s.name,
  gsm: z.number().finite().positive().max(2000),
  widthIn: inches, lengthIn: inches,
  priceUnit: z.enum(['ream', 'kg', 'sheet']).default('ream'),
  price: s.money,
  active: z.boolean().optional(),
});
const PressInput = z.object({
  code: s.code, name: s.name,
  maxWidthIn: inches.optional(), maxLengthIn: inches.optional(),
  maxColors: z.number().int().min(1).max(12).optional(),
  plateCost: s.money.default(0), makereadyCost: s.money.default(0), runCostPerThousand: s.money.default(0),
  minImpressions: z.number().int().min(0).max(10_000_000).default(0),
  makereadyWaste: z.number().int().min(0).max(100_000).default(0),
  runWastePct: z.number().min(0).max(100).default(0),
  active: z.boolean().optional(),
});
const FinishingInput = z.object({
  code: s.code, name: s.name,
  chargeBy: z.enum(['per_job', 'per_sheet', 'per_piece', 'per_sqin']).default('per_piece'),
  rate: rate.default(0), setupCost: s.money.default(0), minCharge: s.money.default(0),
  active: z.boolean().optional(),
});

const PAPER_COLS = { code: 'code', name: 'name', gsm: 'gsm', widthIn: 'width_in', lengthIn: 'length_in', priceUnit: 'price_unit', price: 'price', active: 'active' };
const PRESS_COLS = {
  code: 'code', name: 'name', maxWidthIn: 'max_width_in', maxLengthIn: 'max_length_in', maxColors: 'max_colors', plateCost: 'plate_cost',
  makereadyCost: 'makeready_cost', runCostPerThousand: 'run_cost_per_thousand', minImpressions: 'min_impressions', makereadyWaste: 'makeready_waste',
  runWastePct: 'run_waste_pct', active: 'active',
};
const FINISHING_COLS = { code: 'code', name: 'name', chargeBy: 'charge_by', rate: 'rate', setupCost: 'setup_cost', minCharge: 'min_charge', active: 'active' };

const FormulaInput = z.object({
  code: z.string().trim().min(1).max(40),
  label: s.name,
  expression: z.string().trim().min(1).max(500),
  kind: z.enum(['step', 'cost', 'price']).default('cost'),
  seq: z.number().int().min(0).max(100_000).default(100),
  unit: text(20),
  note: text(500),
  active: z.boolean().optional(),
});
const FormulaPatch = FormulaInput.omit({ code: true }).partial();

/**
 * Print quantities as the estimator types them — "1000, 2000, 5000" (comma, slash, semicolon or space between them) — or an array.
 * A thousands comma cannot be told from a separator, so "1,000" is refused with a hint instead of quietly becoming 1 and 0.
 */
const Quantities = z.union([z.string(), z.array(z.number()), z.number()]).transform((v, ctx) => {
  const parts = typeof v === 'string' ? v.split(/[,;/\s]+/).filter(Boolean).map(Number) : Array.isArray(v) ? v : [v];
  const bad = parts.some((n) => !Number.isInteger(n) || n <= 0 || n > 100_000_000);
  if (!parts.length || bad) {
    ctx.addIssue({ code: 'custom', message: 'ยอดพิมพ์ต้องเป็นจำนวนเต็มมากกว่า 0 คั่นหลายยอดด้วยจุลภาค เช่น 1000, 2000 (ไม่ใส่จุลภาคคั่นหลักพัน)' });
    return z.NEVER;
  }
  const unique = [...new Set(parts)].sort((a, b) => a - b);
  if (unique.length > 8) {
    ctx.addIssue({ code: 'custom', message: 'ใส่ยอดพิมพ์ได้ไม่เกิน 8 ยอดต่อใบประเมิน' });
    return z.NEVER;
  }
  return unique;
});

const EstimateInput = z.object({
  jobName: s.name,
  partnerId: s.uuid.nullable().optional(),
  customerName: s.name,
  customerTaxId: text(20), customerBranch: text(50), customerAddress: text(1000),
  finishedW: inches, finishedL: inches,
  bleed: z.number().min(0).max(2).default(0.125),
  paperId: s.uuid, pressId: s.uuid,
  pressSheetW: inches, pressSheetL: inches,
  /** pieces per press sheet; omitted = worked out from the sizes */
  ups: z.number().int().min(1).max(10_000).optional(),
  /** press sheets cut from one parent sheet; omitted = worked out from the sizes */
  cuts: z.number().int().min(1).max(1000).optional(),
  colorsFront: z.number().int().min(0).max(12).default(4),
  colorsBack: z.number().int().min(0).max(12).default(0),
  quantities: Quantities,
  marginPct: z.number().min(0).max(1000).default(30),
  note: text(2000),
  finishings: z.array(z.object({ finishingId: s.uuid, times: z.number().positive().max(100).default(1) })).max(20).default([]),
});
type EstimateInput = z.infer<typeof EstimateInput>;

const IdParam = z.object({ id: s.uuid });
const ListQuery = s.listQuery.extend({ active: z.string().optional(), status: z.string().optional() });

const IMPORT_MAX_ROWS = 2000;
const ImportBody = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(IMPORT_MAX_ROWS),
  dryRun: z.boolean().optional(),
});

/* ---------------- spreadsheet import helpers ---------------- */

/** Exported lists and customers' own sheets use Thai words for these codes; accept them on import. */
const PRICE_UNIT_TH: Record<string, string> = { 'รีม': 'ream', 'กิโลกรัม': 'kg', 'กก.': 'kg', 'กก': 'kg', 'กิโล': 'kg', 'แผ่น': 'sheet' };
const CHARGE_BY_TH: Record<string, string> = {
  'เหมาต่องาน': 'per_job', 'เหมา': 'per_job', 'ต่องาน': 'per_job',
  'ต่อแผ่นพิมพ์': 'per_sheet', 'ต่อแผ่น': 'per_sheet', 'แผ่น': 'per_sheet',
  'ต่อชิ้น': 'per_piece', 'ชิ้น': 'per_piece',
  'ต่อตารางนิ้ว': 'per_sqin', 'ตารางนิ้ว': 'per_sqin', 'ตร.นิ้ว': 'per_sqin',
};
const fromThai = (map: Record<string, string>, v: unknown) => (typeof v === 'string' ? map[v.trim()] ?? v : v);

const TRUE = new Set(['true', '1', 'yes', 'y', 'ใช่', 'ใช้งาน', 'x', '✓']);
const FALSE = new Set(['false', '0', 'no', 'n', 'ไม่ใช่', 'ไม่ใช้งาน', 'เลิกใช้']);

/** The base type behind optional/nullable/default wrappers. */
function baseType(t: z.ZodTypeAny): z.ZodTypeAny {
  let cur: any = t;
  while (cur?._def?.innerType || cur?._def?.schema) cur = cur._def.innerType ?? cur._def.schema;
  return cur;
}

/** A spreadsheet row has text in every cell: blank → absent, "1,650.00" → 1650, ใช่/ไม่ใช่ → boolean. Unparseable text is left for validation to report. */
function coerceRow(schema: z.ZodObject<any>, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, type] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
    let v = raw[key];
    if (typeof v === 'string') {
      v = v.trim();
      const base = baseType(type);
      if (v === '') v = undefined;
      else if (base instanceof z.ZodNumber) { const n = Number(String(v).replace(/,/g, '')); if (Number.isFinite(n)) v = n; }
      else if (base instanceof z.ZodBoolean) { const b = String(v).toLowerCase(); if (TRUE.has(b)) v = true; else if (FALSE.has(b)) v = false; }
      else if (base instanceof z.ZodEnum) v = (base.options as string[]).find((o) => o.toLowerCase() === String(v).toLowerCase()) ?? v;
    }
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Thai wording for the problems a person can fix in their spreadsheet. */
function thaiIssue(issue: z.ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type': return issue.received === 'undefined' ? 'ต้องกรอก' : 'ต้องเป็นตัวเลข';
    case 'invalid_enum_value': return `ต้องเป็นหนึ่งใน ${issue.options.join(', ')}`;
    case 'too_small': return issue.type === 'string' ? 'ต้องกรอก' : issue.inclusive ? `ต้องไม่น้อยกว่า ${issue.minimum}` : `ต้องมากกว่า ${issue.minimum}`;
    case 'too_big': return issue.type === 'string' ? `ยาวเกิน ${issue.maximum} ตัวอักษร` : `ต้องไม่เกิน ${issue.maximum}`;
    default: return issue.message;
  }
}

/** "insert" / "update set" fragments from a validated body and a field → column map. */
function columns(body: Record<string, unknown>, map: Record<string, string>) {
  const keys = Object.keys(map).filter((k) => body[k] !== undefined);
  return { cols: keys.map((k) => map[k]!), values: keys.map((k) => body[k]) };
}

/**
 * One rate table (papers, presses, finishings): list with search, get, create, update and bulk import from a spreadsheet.
 * The import upserts by `code`: every row is validated with the create schema; a dry run only reports; a real run writes all rows or none.
 */
function rateTable(app: Parameters<ServiceDefinition['routes']>[0], k: Kernel, cfg: {
  path: string; table: string; label: string; input: z.ZodObject<any>; map: Record<string, string>;
  normalize?: (row: Record<string, unknown>) => Record<string, unknown>;
}) {
  app.post(`${cfg.path}/import`, async (req) => {
    const a = auth(req);
    requirePerm(a, 'estimating.rate.write');
    const body = parse(ImportBody, req.body);
    const errors: { row: number; field?: string; message: string }[] = [];
    const valid: { data: Record<string, any>; provided: string[] }[] = [];
    const seen = new Map<string, number>();
    body.rows.forEach((raw, i) => {
      const row = i + 1;
      const input = coerceRow(cfg.input, cfg.normalize ? cfg.normalize(raw) : raw);
      const r = cfg.input.safeParse(input);
      if (!r.success) {
        for (const issue of r.error.issues) errors.push({ row, ...(issue.path.length ? { field: issue.path.join('.') } : {}), message: thaiIssue(issue) });
        return;
      }
      const first = seen.get(r.data.code);
      if (first) return void errors.push({ row, field: 'code', message: `รหัสซ้ำกับแถวที่ ${first}` });
      seen.set(r.data.code, row);
      valid.push({ data: r.data, provided: Object.keys(input) });
    });
    if (!body.dryRun && errors.length) throw badRequest(`นำเข้าไม่สำเร็จ: ไฟล์มีปัญหา ${errors.length} จุด — ยังไม่ได้บันทึกข้อมูลใด`, { errors });

    return k.db.tx(a.tenantId, async (c) => {
      const existing = new Set((await c.query(`select code from ${cfg.table} where code = any($1)`, [valid.map((v) => v.data.code)])).rows.map((r) => r.code));
      const updated = valid.filter((v) => existing.has(v.data.code)).length;
      const result = { dryRun: !!body.dryRun, total: body.rows.length, created: valid.length - updated, updated, errors };
      if (body.dryRun) return result;
      for (const v of valid) {
        const { cols, values } = columns(v.data, cfg.map);
        // an existing rate only changes in the columns the file actually filled (schema defaults don't overwrite)
        const set = [...Object.keys(cfg.map).filter((f) => f !== 'code' && v.provided.includes(f)).map((f) => `${cfg.map[f]} = excluded.${cfg.map[f]}`), 'updated_at = now()'];
        await c.query(
          `insert into ${cfg.table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
           on conflict (tenant_id, code) do update set ${set.join(', ')}`, values);
      }
      return result;
    });
  });

  app.get(cfg.path, async (req) => {
    const a = auth(req);
    requirePerm(a, 'estimating.rate.read');
    const q = parse(ListQuery, req.query);
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.q) { params.push(`%${q.q}%`); where.push(`(code ilike $${params.length} or name ilike $${params.length})`); }
    if (q.active === '1') where.push('active');
    params.push(q.limit, q.offset);
    return k.db.tx(a.tenantId, async (c) => (await c.query(
      `select * from ${cfg.table} ${where.length ? 'where ' + where.join(' and ') : ''} order by code limit $${params.length - 1} offset $${params.length}`, params)).rows);
  });

  app.get(`${cfg.path}/:id`, async (req) => {
    const a = auth(req);
    requirePerm(a, 'estimating.rate.read');
    const { id } = parse(IdParam, req.params);
    return k.db.tx(a.tenantId, (c) => one(c, `select * from ${cfg.table} where id = $1`, [id], cfg.label));
  });

  app.post(cfg.path, async (req, reply) => {
    const a = auth(req);
    requirePerm(a, 'estimating.rate.write');
    const { cols, values } = columns(parse(cfg.input, req.body), cfg.map);
    reply.code(201);
    return k.db.tx(a.tenantId, async (c) => (await c.query(
      `insert into ${cfg.table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, values)).rows[0]);
  });

  app.patch(`${cfg.path}/:id`, async (req) => {
    const a = auth(req);
    requirePerm(a, 'estimating.rate.write');
    const { id } = parse(IdParam, req.params);
    const { cols, values } = columns(parse(cfg.input.partial(), req.body), cfg.map);
    return k.db.tx(a.tenantId, async (c) => {
      const set = [...cols.map((col, i) => `${col} = $${i + 2}`), 'updated_at = now()'].join(', ');
      return one(c, `update ${cfg.table} set ${set} where id = $1 returning *`, [id, ...values], cfg.label);
    });
  });
}

/* ---------------- formulas ---------------- */

const FORMULA_ORDER = `order by (kind = 'price'), seq, code`;

/** A company's first visit gets the standard offset formulas; after that the table is theirs to change. */
async function ensureFormulas(c: Client): Promise<void> {
  if ((await c.query('select 1 from formulas limit 1')).rowCount) return;
  for (const f of DEFAULT_FORMULAS) {
    await c.query(
      `insert into formulas (code, label, expression, kind, seq, unit, note, system) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (tenant_id, code) do nothing`,
      [f.code, f.label, f.expression, f.kind, f.seq, f.unit, f.note || null, f.system]);
  }
}

async function activeFormulas(c: Client): Promise<FormulaRow[]> {
  await ensureFormulas(c);
  return (await c.query(`select code, label, expression, kind, seq, unit from formulas where active ${FORMULA_ORDER}`)).rows;
}

/** 400 with the Thai reason when the active set of formulas would no longer work. */
function checkFormulaSet(formulas: FormulaRow[]) {
  const problem = formulaSetProblem(formulas);
  if (problem) throw badRequest(problem, { fieldErrors: { expression: [problem] } });
}

/* ---------------- estimates ---------------- */

const fmt = (n: number) => String(round(n, 3));
const size = (w: number, l: number) => `${fmt(w)} × ${fmt(l)} นิ้ว`;
const fieldError = (field: string, message: string) => badRequest(message, { fieldErrors: { [field]: [message] } });

interface Worked {
  job: JobSpec; paper: PaperRate & { id: string }; press: PressRate & { id: string };
  finishings: (FinishingRate & { finishingId: string })[]; formulas: FormulaRow[]; breaks: Breakdown[]; quantities: number[];
}

/**
 * Work an estimate out from today's rate tables and formulas: load the paper, press and finishing chosen, lay the job out
 * (pieces per press sheet, press sheets per parent sheet) and run the formulas once per print quantity.
 */
async function work(c: Client, b: Pick<EstimateInput, 'finishedW' | 'finishedL' | 'bleed' | 'paperId' | 'pressId' | 'pressSheetW' | 'pressSheetL' | 'ups' | 'cuts' | 'colorsFront' | 'colorsBack' | 'quantities' | 'marginPct' | 'finishings'>): Promise<Worked> {
  const p = (await c.query('select * from papers where id = $1', [b.paperId])).rows[0];
  if (!p) throw fieldError('paperId', 'ไม่พบกระดาษที่เลือก');
  if (!p.active) throw fieldError('paperId', `กระดาษ ${p.code} เลิกใช้แล้ว — เลือกกระดาษอื่น`);
  const m = (await c.query('select * from presses where id = $1', [b.pressId])).rows[0];
  if (!m) throw fieldError('pressId', 'ไม่พบเครื่องพิมพ์ที่เลือก');
  if (!m.active) throw fieldError('pressId', `เครื่องพิมพ์ ${m.code} เลิกใช้แล้ว — เลือกเครื่องอื่น`);
  if (b.colorsFront + b.colorsBack < 1) throw fieldError('colorsFront', 'ต้องพิมพ์อย่างน้อย 1 สี');

  const cuts = b.cuts ?? fit(p.width_in, p.length_in, b.pressSheetW, b.pressSheetL);
  if (cuts < 1) throw fieldError('pressSheetW', `แผ่นพิมพ์ ${size(b.pressSheetW, b.pressSheetL)} ใหญ่กว่ากระดาษ ${p.code} (${size(p.width_in, p.length_in)})`);
  if (m.max_width_in && m.max_length_in && fit(m.max_width_in, m.max_length_in, b.pressSheetW, b.pressSheetL) < 1) {
    throw fieldError('pressSheetW', `แผ่นพิมพ์ ${size(b.pressSheetW, b.pressSheetL)} ใหญ่กว่าที่เครื่อง ${m.code} รับได้ (${size(m.max_width_in, m.max_length_in)})`);
  }
  const ups = b.ups ?? fit(b.pressSheetW, b.pressSheetL, b.finishedW + 2 * b.bleed, b.finishedL + 2 * b.bleed);
  if (ups < 1) throw fieldError('finishedW', `ขนาดงาน ${size(b.finishedW, b.finishedL)} รวมตัดตกแล้วใหญ่กว่าแผ่นพิมพ์ ${size(b.pressSheetW, b.pressSheetL)}`);

  const ids = [...new Set(b.finishings.map((f) => f.finishingId))];
  const found = new Map((ids.length ? (await c.query('select * from finishings where id = any($1::uuid[])', [ids])).rows : []).map((r) => [r.id as string, r]));
  const finishings = b.finishings.map((f) => {
    const r = found.get(f.finishingId);
    if (!r) throw fieldError('finishings', 'ไม่พบงานหลังพิมพ์ที่เลือก');
    if (!r.active) throw fieldError('finishings', `งานหลังพิมพ์ ${r.code} เลิกใช้แล้ว`);
    return { finishingId: r.id as string, code: r.code as string, name: r.name as string, chargeBy: r.charge_by as ChargeBy, rate: r.rate as number, setupCost: r.setup_cost as number, minCharge: r.min_charge as number, times: f.times };
  });

  const job: JobSpec = {
    finishedW: b.finishedW, finishedL: b.finishedL, bleed: b.bleed, pressSheetW: b.pressSheetW, pressSheetL: b.pressSheetL,
    ups, cuts, colorsFront: b.colorsFront, colorsBack: b.colorsBack, marginPct: b.marginPct,
  };
  const paper = { id: p.id as string, code: p.code as string, name: p.name as string, gsm: p.gsm as number, widthIn: p.width_in as number, lengthIn: p.length_in as number, priceUnit: p.price_unit, price: p.price as number };
  const press = {
    id: m.id as string, code: m.code as string, name: m.name as string, maxWidthIn: m.max_width_in, maxLengthIn: m.max_length_in, maxColors: m.max_colors,
    plateCost: m.plate_cost as number, makereadyCost: m.makeready_cost as number, runCostPer1000: m.run_cost_per_thousand as number,
    minImpressions: m.min_impressions as number, makereadyWaste: m.makeready_waste as number, runWastePct: m.run_waste_pct as number,
  };
  const formulas = await activeFormulas(c);
  try {
    const breaks = b.quantities.map((qty) => calculate({ job, paper, press, finishings, formulas, qty }));
    return { job, paper, press, finishings, formulas, breaks, quantities: b.quantities };
  } catch (e) {
    // the set was checked when it was saved, so this is a formula that fails only on this job's numbers
    if (e instanceof FormulaError) throw new HttpError(422, 'formula_error', `${e.message} — ตรวจสูตรคำนวณ`);
    throw e;
  }
}

/** The snapshot stored with an estimate: what it was priced from, and the cost lines per quantity as the screens show them. */
function detailOf(w: Worked) {
  return {
    paper: w.paper, press: w.press, finishings: w.finishings, formulas: w.formulas, quantities: w.quantities,
    costLines: w.breaks.flatMap((b) => b.lines.map((l) => ({ qty: b.qty, ...l }))),
    finishingLines: w.breaks.flatMap((b) => b.finishing.map((l) => ({ qty: b.qty, ...l }))),
  };
}

async function saveBreaks(c: Client, estimateId: string, breaks: Breakdown[]) {
  await c.query('delete from estimate_breaks where estimate_id = $1', [estimateId]);
  for (const b of breaks) {
    await c.query(
      `insert into estimate_breaks (estimate_id, qty, press_sheets, total_cost, unit_cost, unit_price, price, profit) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [estimateId, b.qty, b.pressSheets, b.totalCost, b.unitCost, b.unitPrice, b.price, b.profit]);
  }
}

const qtyText = (quantities: number[]) => quantities.map((q) => q.toLocaleString('en-US')).join(' / ');

/** An estimate as the detail screen and the printed sheet show it: the row, one price line per quantity and the working behind them. */
async function loadEstimate(c: Client, id: string, lock = false) {
  const e = await one(c, `select * from estimates where id = $1 ${lock ? 'for update' : ''}`, [id], 'Estimate');
  e.breaks = (await c.query('select qty, press_sheets, total_cost, unit_cost, unit_price, price, profit from estimate_breaks where estimate_id = $1 order by qty', [id])).rows;
  e.size_text = size(e.finished_w, e.finished_l);
  e.press_sheet_text = size(e.press_sheet_w, e.press_sheet_l);
  e.colors_text = `${e.colors_front}/${e.colors_back} สี`;
  e.paper_text = `${e.paper_code} · ${e.paper_name}`;
  e.press_text = `${e.press_code} · ${e.press_name}`;
  e.cost_lines = e.detail.costLines ?? [];
  e.finishing_lines = e.detail.finishingLines ?? [];
  return e;
}

/** The line a quotation carries for this job, e.g. "โบรชัวร์ A4 · ขนาด 8.27 × 11.69 นิ้ว · พิมพ์ 4/4 สี · กระดาษ อาร์ตมัน 120 แกรม · เคลือบ PVC ด้าน". */
function describeJob(e: any): string {
  const finishing = [...new Set((e.detail.finishings as { name: string }[]).map((f) => f.name))];
  return [e.job_name, `ขนาด ${size(e.finished_w, e.finished_l)}`, `พิมพ์ ${e.colors_front}/${e.colors_back} สี`, `กระดาษ ${e.paper_name}`, ...finishing].join(' · ').slice(0, 1000);
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    /* ================= rate tables ================= */

    rateTable(app, k, { path: '/papers', table: 'papers', label: 'Paper', input: PaperInput, map: PAPER_COLS, normalize: (r) => ({ ...r, priceUnit: fromThai(PRICE_UNIT_TH, r.priceUnit) }) });
    rateTable(app, k, { path: '/presses', table: 'presses', label: 'Press', input: PressInput, map: PRESS_COLS });
    rateTable(app, k, { path: '/finishings', table: 'finishings', label: 'Finishing', input: FinishingInput, map: FINISHING_COLS, normalize: (r) => ({ ...r, chargeBy: fromThai(CHARGE_BY_TH, r.chargeBy) }) });

    /* ================= formulas ================= */

    app.get('/formulas', async (req) => {
      const a = auth(req);
      requirePerm(a, 'estimating.rate.read');
      return k.db.tx(a.tenantId, async (c) => {
        await ensureFormulas(c);
        return (await c.query(`select * from formulas ${FORMULA_ORDER}`)).rows;
      });
    });

    /** Everything a formula may read: the job's input values, then the results of the active formulas in running order. */
    app.get('/formulas/variables', async (req) => {
      const a = auth(req);
      requirePerm(a, 'estimating.rate.read');
      return k.db.tx(a.tenantId, async (c) => [
        ...INPUT_VARIABLES,
        ...(await activeFormulas(c)).map((f) => ({ code: f.code, label: f.label, unit: f.unit ?? '', group: 'ผลจากสูตร (ใช้ได้ในสูตรลำดับถัดไป)' })),
      ]);
    });

    /** Try an expression on the sample job with the current formulas, without saving anything. */
    app.post('/formulas/test', async (req) => {
      const a = auth(req);
      requirePerm(a, 'estimating.rate.read');
      const b = parse(z.object({ expression: z.string().trim().min(1).max(500) }), req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const formulas = await activeFormulas(c);
        try {
          const value = evaluate(parseFormula(b.expression), calculate({ ...SAMPLE, formulas }).values);
          const shown = round(value, 4).toLocaleString('en-US', { maximumFractionDigits: 4 });
          return { value: round(value, 4), message: `ผลลัพธ์กับงานตัวอย่าง (ใบปลิว A4 พิมพ์ 4/4 สี ${SAMPLE.qty.toLocaleString('en-US')} ใบ): ${shown}` };
        } catch (e) {
          if (e instanceof FormulaError) throw badRequest(e.message, { fieldErrors: { expression: [e.message] } });
          throw e;
        }
      });
    });

    app.get('/formulas/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'estimating.rate.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => one(c, 'select * from formulas where id = $1', [id], 'Formula'));
    });

    app.post('/formulas', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'estimating.formula.write');
      const b = parse(FormulaInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const current = await activeFormulas(c);
        if ((await c.query('select 1 from formulas where code = $1', [b.code])).rowCount) throw fieldError('code', `มีสูตรรหัส ${b.code} อยู่แล้ว`);
        const row: FormulaRow = { code: b.code, label: b.label, expression: b.expression, kind: b.kind, seq: b.seq, unit: b.unit ?? null };
        if (b.active !== false) checkFormulaSet([...current, row]);
        return (await c.query(
          `insert into formulas (code, label, expression, kind, seq, unit, note, active, updated_by_name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
          [b.code, b.label, b.expression, b.kind, b.seq, b.unit ?? null, b.note ?? null, b.active !== false, a.userName ?? null])).rows[0];
      });
    });

    app.patch('/formulas/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'estimating.formula.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(FormulaPatch, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const current = await activeFormulas(c);
        const f = await one(c, 'select * from formulas where id = $1 for update', [id], 'Formula');
        if (f.system && b.active === false) throw conflict(`สูตร ${f.code} เป็นสูตรหลักของระบบ ปิดใช้งานไม่ได้ — แก้ตัวสูตรได้`);
        if (f.system && b.kind && b.kind !== f.kind) throw conflict(`สูตร ${f.code} เป็นสูตรหลักของระบบ เปลี่ยนประเภทไม่ได้`);
        const next = {
          code: f.code as string, label: b.label ?? f.label, expression: b.expression ?? f.expression, kind: b.kind ?? f.kind, seq: b.seq ?? f.seq,
          unit: b.unit ?? f.unit, note: b.note ?? f.note, active: b.active ?? f.active,
        };
        checkFormulaSet([...current.filter((x) => x.code !== f.code), ...(next.active ? [next] : [])]);
        return (await c.query(
          `update formulas set label = $2, expression = $3, kind = $4, seq = $5, unit = $6, note = $7, active = $8, updated_by_name = $9, updated_at = now() where id = $1 returning *`,
          [id, next.label, next.expression, next.kind, next.seq, next.unit, next.note, next.active, a.userName ?? null])).rows[0];
      });
    });

    /* ================= estimates ================= */

    app.post('/estimates', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'estimating.estimate.write');
      const b = parse(EstimateInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const w = await work(c, b);
        const no = await nextDocNo(c, 'EST');
        const e = (await c.query(
          `insert into estimates (no, job_name, partner_id, customer_name, customer_tax_id, customer_branch, customer_address, finished_w, finished_l, bleed,
             paper_id, paper_code, paper_name, press_id, press_code, press_name, press_sheet_w, press_sheet_l, ups, cuts, colors_front, colors_back,
             margin_pct, qty_text, note, detail, created_by, created_by_name)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, $23,$24,$25,$26,$27,$28) returning id`,
          [no, b.jobName, b.partnerId ?? null, b.customerName, b.customerTaxId ?? null, b.customerBranch ?? null, b.customerAddress ?? null, b.finishedW, b.finishedL, b.bleed,
            w.paper.id, w.paper.code, w.paper.name, w.press.id, w.press.code, w.press.name, b.pressSheetW, b.pressSheetL, w.job.ups, w.job.cuts, b.colorsFront, b.colorsBack,
            b.marginPct, qtyText(w.quantities), b.note ?? null, JSON.stringify(detailOf(w)), a.userId, a.userName ?? null])).rows[0];
        await saveBreaks(c, e.id, w.breaks);
        return loadEstimate(c, e.id);
      });
    });

    app.get('/estimates', async (req) => {
      const a = auth(req);
      requirePerm(a, 'estimating.estimate.read');
      const q = parse(ListQuery, req.query);
      const where: string[] = [];
      const params: unknown[] = [];
      if (q.q) { params.push(`%${q.q}%`); where.push(`(e.no ilike $${params.length} or e.job_name ilike $${params.length} or e.customer_name ilike $${params.length})`); }
      if (q.status) { params.push(q.status); where.push(`e.status = $${params.length}`); }
      params.push(q.limit, q.offset);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select e.id, e.no, e.job_name, e.customer_name, e.paper_name, e.qty_text, e.status, e.confirmed_price, e.created_by_name, e.created_at,
                (select min(b.price) from estimate_breaks b where b.estimate_id = e.id) as price_from
         from estimates e ${where.length ? 'where ' + where.join(' and ') : ''} order by e.created_at desc, e.no desc limit $${params.length - 1} offset $${params.length}`, params)).rows);
    });

    app.get('/estimates/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'estimating.estimate.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadEstimate(c, id));
    });

    /** Work a draft out again with today's rates and formulas; the print quantities and the margin may be changed on the way. */
    app.post('/estimates/:id/recalculate', async (req) => {
      const a = auth(req);
      requirePerm(a, 'estimating.estimate.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ quantities: Quantities.optional(), marginPct: z.number().min(0).max(1000).optional() }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const e = await loadEstimate(c, id, true);
        if (e.status !== 'draft') throw conflict(`ใบประเมินราคา ${e.no} ${e.status === 'confirmed' ? 'ยืนยันราคาแล้ว' : 'ถูกยกเลิกแล้ว'} คำนวณใหม่ไม่ได้`);
        const w = await work(c, {
          finishedW: e.finished_w, finishedL: e.finished_l, bleed: e.bleed, paperId: e.paper_id, pressId: e.press_id,
          pressSheetW: e.press_sheet_w, pressSheetL: e.press_sheet_l, ups: e.ups, cuts: e.cuts, colorsFront: e.colors_front, colorsBack: e.colors_back,
          quantities: b.quantities ?? e.detail.quantities, marginPct: b.marginPct ?? e.margin_pct,
          finishings: (e.detail.finishings as { finishingId: string; times: number }[]).map((f) => ({ finishingId: f.finishingId, times: f.times })),
        });
        await c.query(
          `update estimates set paper_code = $2, paper_name = $3, press_code = $4, press_name = $5, margin_pct = $6, qty_text = $7, detail = $8, updated_at = now() where id = $1`,
          [id, w.paper.code, w.paper.name, w.press.code, w.press.name, w.job.marginPct, qtyText(w.quantities), JSON.stringify(detailOf(w))]);
        await saveBreaks(c, id, w.breaks);
        return loadEstimate(c, id);
      });
    });

    /** Fix the price of one print quantity. With CRM installed the event becomes a draft quotation there. */
    app.post('/estimates/:id/confirm', async (req) => {
      const a = auth(req);
      requirePerm(a, 'estimating.estimate.confirm');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ qty: z.number().positive().optional() }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const e = await loadEstimate(c, id, true);
        if (e.status !== 'draft') throw conflict(`ใบประเมินราคา ${e.no} ${e.status === 'confirmed' ? 'ยืนยันราคาแล้ว' : 'ถูกยกเลิกแล้ว'}`);
        const breaks = e.breaks as { qty: number; unit_price: number; price: number }[];
        const chosen = b.qty === undefined ? (breaks.length === 1 ? breaks[0] : undefined) : breaks.find((x) => x.qty === b.qty);
        if (!chosen) throw fieldError('qty', `เลือกยอดพิมพ์ที่ลูกค้าตกลง: ${e.qty_text}`);
        await c.query(
          `update estimates set status = 'confirmed', confirmed_qty = $2, confirmed_unit_price = $3, confirmed_price = $4, confirmed_at = now(), confirmed_by_name = $5, updated_at = now() where id = $1`,
          [id, chosen.qty, chosen.unit_price, chosen.price, a.userName ?? null]);
        await k.emit(c, 'estimating.estimate_confirmed', {
          estimateId: id, no: e.no, jobName: e.job_name, customerName: e.customer_name, partnerId: e.partner_id,
          customerTaxId: e.customer_tax_id, customerBranch: e.customer_branch, customerAddress: e.customer_address,
          description: describeJob(e), qty: chosen.qty, unitPrice: chosen.unit_price, price: chosen.price,
        });
        return loadEstimate(c, id);
      });
    });

    app.post('/estimates/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'estimating.estimate.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const e = await one(c, 'select no, status from estimates where id = $1 for update', [id], 'Estimate');
        if (e.status !== 'draft') throw conflict(`ใบประเมินราคา ${e.no} ${e.status === 'confirmed' ? 'ยืนยันราคาแล้ว ยกเลิกไม่ได้' : 'ถูกยกเลิกไปแล้ว'}`);
        await c.query(`update estimates set status = 'cancelled', updated_at = now() where id = $1`, [id]);
        return loadEstimate(c, id);
      });
    });

    /* ================= dashboard ================= */

    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'estimating.estimate.read');
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select count(*) filter (where status = 'draft')::int as drafts,
                  count(*) filter (where status = 'confirmed' and date_trunc('month', confirmed_at) = date_trunc('month', now()))::int as confirmed_month,
                  coalesce(sum(confirmed_price) filter (where status = 'confirmed' and date_trunc('month', confirmed_at) = date_trunc('month', now())), 0) as confirmed_value
           from estimates`)).rows[0];
        const rows = (await c.query(
          `select e.id, e.no, e.job_name, e.customer_name, e.status, e.qty_text from estimates e where e.status = 'draft' order by e.created_at desc limit 20`)).rows;
        return { drafts: n.drafts, confirmedThisMonth: n.confirmed_month, confirmedValueThisMonth: n.confirmed_value, rows };
      });
    });
  },
};
