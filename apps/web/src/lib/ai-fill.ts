/**
 * "สแกนใบเสร็จ" — read a photo or PDF into a form (FormScreen.aiFill) with the customer's own Claude key.
 *
 * Safety model (same as the assistant):
 *  - nothing is saved here: the result goes back to the browser, fills only EMPTY fields and the person presses save;
 *  - lookup choices (e.g. expense categories) are read through the gateway with the user's own token, only from the
 *    lookup paths the form itself declares, and the model may only pick one of those records (checked again here);
 *  - the ERP token never goes to Anthropic; the picture, the form's labels and the offered choices do.
 *
 * Server-only (runs in the Next route /assist/fill). Pure apart from `fetch`, so it is unit-tested with fakes.
 */
import { aiFillable, cleanAiValue, get, listRows, type Field, type FormScreen, type ModuleUi } from '@erp/ui-schema';

export const AI_FILL_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const AI_FILL_PDF = 'application/pdf';
/** Anthropic accepts images up to 5 MB; the browser shrinks photos to ~1568 px first, so real scans are far smaller. */
export const AI_FILL_MAX_BYTES = 5 * 1024 * 1024;
/** multi-page PDFs (quotations, customer POs) are bigger than photos */
export const AI_FILL_MAX_PDF_BYTES = 10 * 1024 * 1024;
/**
 * A lookup with at most this many records is offered to the model as a closed list (it must pick one id).
 * Bigger lists (thousands of items) are matched the other way round: the model writes the code/name it sees on the
 * paper and the server searches the lookup with the user's token (`?q=`), taking only an unambiguous match.
 */
const MAX_OPTIONS = 150;
const MAX_LINES = 100;

export class AiFillError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export interface AiFillFile { mediaType: string; dataBase64: string; name?: string }
export interface AiFillResult {
  /** form values, with `__label.<field>` display text for lookups */
  values: Record<string, unknown>;
  lines: Record<string, unknown>[];
  /** what was read off the paper, shown above the form for checking: ผู้ขาย, เลขผู้เสียภาษี, ยอดรวม … */
  facts: { label: string; value: string }[];
  /** things to double-check (unclear text, tax-ID checksum, totals that do not add up) */
  warnings: string[];
}

export interface AiFillOptions {
  ui: ModuleUi;
  screenId: string;
  file: AiFillFile;
  authorization: string;
  apiKey: string;
  gatewayUrl: string;
  permissions: string[];
  model?: string;
  baseUrl?: string;
  today?: string;
  fetch?: typeof fetch;
}

type Option = { id: string; label: string; assign: Record<string, unknown> };

/** 13-digit Thai tax ID (เลขประจำตัวผู้เสียภาษี) with its mod-11 check digit. */
export function isThaiTaxId(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(d[12]);
}

/** Bytes of a base64 string without decoding it. */
export const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

export function checkFile(file: AiFillFile | undefined, kind: 'receipt' | 'document'): string | null {
  if (!file || typeof file.dataBase64 !== 'string' || !file.dataBase64) return 'แนบรูปหรือไฟล์ก่อน';
  const okType = (AI_FILL_IMAGE_TYPES as readonly string[]).includes(file.mediaType) || file.mediaType === AI_FILL_PDF;
  if (!okType) return kind === 'receipt' ? 'รองรับรูป JPG / PNG / WEBP หรือ PDF (รูป HEIC จาก iPhone: ตั้งกล้องเป็น "เข้ากันได้มากที่สุด" หรือแคปหน้าจอแทน)' : 'รองรับรูป JPG / PNG / WEBP หรือ PDF';
  if (!/^[A-Za-z0-9+/]+=*$/.test(file.dataBase64)) return 'ไฟล์เสียหรืออ่านไม่ได้';
  if (file.mediaType === AI_FILL_PDF ? base64Bytes(file.dataBase64) > AI_FILL_MAX_PDF_BYTES : base64Bytes(file.dataBase64) > AI_FILL_MAX_BYTES) {
    return file.mediaType === AI_FILL_PDF ? 'PDF ใหญ่เกิน 10 MB — แยกเฉพาะหน้าที่ต้องใช้' : 'ไฟล์ใหญ่เกิน 5 MB — ถ่ายใหม่หรือย่อรูปก่อน';
  }
  return null;
}

const toOption = (f: Field, r: Record<string, unknown>): Option => {
  const lk = f.lookup!;
  return {
    id: String(get(r, lk.assign[f.name]) ?? ''),
    label: lk.label.map((k) => get(r, k)).filter((v) => v !== undefined && v !== null && v !== '').join(' '),
    assign: Object.fromEntries(Object.entries(lk.assign).map(([target, source]) => [target, get(r, source)])),
  };
};

/** Records of a lookup, read with the user's token from the path the form declares (`q` = search text). */
async function readLookup(o: AiFillOptions, f: Field, fetcher: typeof fetch, extra: Record<string, string>): Promise<Record<string, unknown>[] | null> {
  const lk = f.lookup!;
  const module = lk.module ?? o.ui.module;
  const qs = new URLSearchParams({ ...(lk.query ?? {}), ...extra });
  try {
    const res = await fetcher(`${o.gatewayUrl.replace(/\/$/, '')}/api/${module}${lk.path}?${qs}`, { headers: { authorization: o.authorization }, cache: 'no-store' } as RequestInit);
    if (!res.ok) return null;
    return listRows({}, await res.json());
  } catch {
    return null;
  }
}

/**
 * The records a lookup field may take: `{ options, complete }`. `complete` = the whole list fits in MAX_OPTIONS,
 * so the model gets a closed list; otherwise it reads the code/name off the paper and `matchLookup` searches.
 */
async function lookupOptions(o: AiFillOptions, f: Field, fetcher: typeof fetch): Promise<{ options: Option[]; complete: boolean } | null> {
  const rows = await readLookup(o, f, fetcher, { limit: String(MAX_OPTIONS + 1) });
  if (!rows) return null;
  return { options: rows.slice(0, MAX_OPTIONS).map((r) => toOption(f, r)).filter((x) => x.id), complete: rows.length <= MAX_OPTIONS };
}

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Text read off the paper ("RM-STEEL เหล็กแผ่น SPCC 1.2mm") -> one record of a big lookup, or null when it is not
 * certain: an exact code, an exact name, a code that appears in the text, or the only search hit. Exported for tests.
 */
export function pickMatch(f: Field, text: string, rows: Record<string, unknown>[]): Option | null {
  const t = norm(text);
  if (!t || !rows.length) return null;
  const codeKey = f.lookup!.label[0];
  const nameKey = f.lookup!.label[1] ?? f.lookup!.label[0];
  const exact = rows.filter((r) => norm(get(r, codeKey)) === t || norm(get(r, nameKey)) === t);
  if (exact.length === 1) return toOption(f, exact[0]);
  const inText = rows.filter((r) => { const c = norm(get(r, codeKey)); return c.length >= 3 && new RegExp(`(^|[^a-z0-9])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(t); });
  if (inText.length === 1) return toOption(f, inText[0]);
  return rows.length === 1 ? toOption(f, rows[0]) : null;
}

/** Search a big lookup for what the paper says: whole text first, then its first word (usually the code). */
async function matchLookup(o: AiFillOptions, f: Field, text: string, fetcher: typeof fetch): Promise<Option | null> {
  const tries = [text.trim(), text.trim().split(/\s+/)[0]].filter((x, i, a) => x && a.indexOf(x) === i);
  for (const q of tries) {
    const rows = await readLookup(o, f, fetcher, { q, limit: '5' });
    const hit = rows && pickMatch(f, text, rows);
    if (hit?.id) return hit;
  }
  return null;
}

/** JSON schema for one field; lookups and selects are enums so the model cannot invent ids; big lookups take the text on the paper. */
function fieldSchema(f: Field, options: Map<string, Option[]>, searched: Set<string>): Record<string, unknown> | null {
  const description = [f.label, f.help].filter(Boolean).join(' — ');
  switch (f.type) {
    case 'number': return { type: 'number', description };
    case 'date': return { type: 'string', description: `${description} (YYYY-MM-DD ค.ศ.)` };
    case 'month': return { type: 'string', description: `${description} (YYYY-MM ค.ศ.)` };
    case 'select': return { type: 'string', enum: (f.options ?? []).map((x) => x.value), description: `${description}: ${(f.options ?? []).map((x) => `${x.value}=${x.label}`).join(', ')}` };
    case 'lookup': {
      if (searched.has(f.name)) return { type: 'string', description: `${description} — เขียนรหัสหรือชื่อตามที่เห็นในเอกสาร (ระบบจะค้นหาในรายการของบริษัทเอง)` };
      const opts = options.get(f.name);
      if (!opts?.length) return null;
      return { type: 'string', enum: opts.map((x) => x.id), description: `${description} — เลือก id จากรายการ ถ้าไม่แน่ใจให้เว้น` };
    }
    default: return { type: 'string', description };
  }
}

const FACTS_SCHEMA = {
  type: 'object',
  description: 'ข้อมูลที่อ่านได้จากเอกสาร (ไว้ให้ผู้ใช้ตรวจ)',
  properties: {
    vendor: { type: 'string', description: 'ชื่อบริษัท/ร้านที่ออกเอกสาร' },
    taxId: { type: 'string', description: 'เลขประจำตัวผู้เสียภาษีผู้ขาย 13 หลัก' },
    documentNo: { type: 'string', description: 'เลขที่ใบเสร็จ/ใบกำกับ' },
    documentDate: { type: 'string', description: 'วันที่เอกสาร YYYY-MM-DD ค.ศ.' },
    subtotal: { type: 'number', description: 'ยอดก่อน VAT' },
    vat: { type: 'number', description: 'ภาษีมูลค่าเพิ่ม' },
    total: { type: 'number', description: 'ยอดรวมสุทธิที่จ่าย' },
  },
};

const FACT_LABELS: Record<string, string> = {
  vendor: 'ผู้ขาย', taxId: 'เลขผู้เสียภาษี', documentNo: 'เลขที่เอกสาร', documentDate: 'วันที่เอกสาร', subtotal: 'ยอดก่อน VAT', vat: 'VAT', total: 'ยอดรวม',
};

function instructions(screen: FormScreen, kind: 'receipt' | 'document', today: string): string {
  return [
    `อ่านเอกสารที่แนบแล้วกรอกฟอร์ม "${screen.title}" ด้วยเครื่องมือ fill_form วันนี้ ${today}`,
    screen.aiFill?.hint ? `เอกสารนี้: ${screen.aiFill.hint}` : '',
    'กรอกเฉพาะสิ่งที่เห็นในเอกสารจริง ห้ามเดา ช่องที่อ่านไม่ออกหรือไม่มีให้เว้นไว้ แล้วบอกสิ่งที่ควรตรวจใน notes เป็นภาษาไทยสั้น ๆ',
    'วันที่ในเอกสารไทยมักเป็น พ.ศ. ให้แปลงเป็น ค.ศ. (2569 = 2026) รูปแบบ YYYY-MM-DD. จำนวนเงินเป็นตัวเลขล้วน ไม่มีจุลภาค',
    ...(kind === 'receipt' ? [
      'เอกสารเป็นใบเสร็จ/ใบกำกับภาษีของไทย: ถ้าแยก VAT ไว้ ให้ "จำนวนเงิน" เป็นยอดก่อน VAT และใส่ VAT แยก; ถ้าไม่ได้แยก VAT ให้ใส่ยอดที่จ่ายจริงเป็นจำนวนเงินและเว้น VAT',
      'ใบเสร็จหนึ่งใบเป็นรายการเดียว เว้นแต่ใบเสร็จมีของหลายหมวดชัดเจน. เลือกหมวดจากรายการ id ที่ให้เท่านั้น. รายละเอียดใส่ชื่อร้านและสิ่งที่ซื้อสั้น ๆ',
    ] : []),
    screen.lines ? `รายการ (${screen.lines.label}) ใส่ใน lines ทุกบรรทัดตามลำดับในเอกสาร (เอกสารหลายหน้าให้อ่านทุกหน้า) ไม่ใส่บรรทัดยอดรวม/ส่วนลดท้ายบิลเป็นรายการ` : '',
  ].filter(Boolean).join('\n');
}

/** Read the file with Claude and turn the answer into safe form values. Throws AiFillError with a Thai message. */
export async function runAiFill(o: AiFillOptions): Promise<AiFillResult> {
  const fetcher = o.fetch ?? fetch;
  const screen = o.ui.screens[o.screenId];
  if (!screen || screen.kind !== 'form' || !screen.aiFill) throw new AiFillError(404, 'หน้านี้ไม่มีการกรอกด้วย AI');
  const kind = screen.aiFill.kind;
  const problem = checkFile(o.file, kind);
  if (problem) throw new AiFillError(400, problem);

  const head = aiFillable(screen.fields);
  const lineFields = screen.lines ? aiFillable(screen.lines.fields) : [];
  const options = new Map<string, Option[]>();
  /** lookups too big for a closed list: the model writes the text, the server searches */
  const searched = new Set<string>();
  await Promise.all([...head, ...lineFields].filter((f) => f.type === 'lookup' && f.lookup).map(async (f) => {
    const r = await lookupOptions(o, f, fetcher);
    if (!r) return;
    if (r.complete) options.set(f.name, r.options);
    else searched.add(f.name);
  }));

  const props = (fields: Field[]) => Object.fromEntries(fields.map((f) => [f.name, fieldSchema(f, options, searched)]).filter(([, s]) => s));
  const tool = {
    name: 'fill_form',
    description: 'ส่งค่าที่อ่านได้จากเอกสารเพื่อกรอกฟอร์ม (ผู้ใช้จะตรวจและกดบันทึกเอง)',
    input_schema: {
      type: 'object',
      properties: {
        values: { type: 'object', properties: props(head) },
        ...(lineFields.length ? { lines: { type: 'array', items: { type: 'object', properties: props(lineFields) } } } : {}),
        facts: FACTS_SCHEMA,
        notes: { type: 'array', items: { type: 'string' }, description: 'สิ่งที่ผู้ใช้ควรตรวจ (ภาษาไทย)' },
      },
      required: ['values', 'facts'],
    },
  };
  const choices = [...options].map(([name, opts]) => `ตัวเลือก ${name}:\n${opts.map((x) => `${x.id} = ${x.label}`).join('\n')}`).join('\n\n');
  const fileBlock = o.file.mediaType === AI_FILL_PDF
    ? { type: 'document', source: { type: 'base64', media_type: AI_FILL_PDF, data: o.file.dataBase64 } }
    : { type: 'image', source: { type: 'base64', media_type: o.file.mediaType, data: o.file.dataBase64 } };

  const base = (o.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  const res = await fetcher(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: o.model ?? 'claude-sonnet-5-5',
      max_tokens: lineFields.length ? 4000 : 1200,
      system: instructions(screen, kind, o.today ?? new Date().toISOString().slice(0, 10)),
      tools: [tool],
      tool_choice: { type: 'tool', name: 'fill_form' },
      messages: [{ role: 'user', content: [fileBlock, { type: 'text', text: choices || 'กรอกฟอร์มจากเอกสารนี้' }] }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI ตอบกลับผิดพลาด (${res.status}) ${text.slice(0, 200)}`);
  }
  const msg = (await res.json()) as { content: any[] };
  const use = msg.content?.find((b) => b.type === 'tool_use' && b.name === 'fill_form');
  if (!use) throw new AiFillError(422, 'AI อ่านเอกสารนี้ไม่ออก ลองถ่ายใหม่ให้เห็นทั้งใบและชัดขึ้น');
  const input = use.input ?? {};
  const missed = await resolveSearched(o, input, head, lineFields, searched, options, fetcher);
  const result = toResult(input, head, lineFields, options);
  result.warnings = [...missed, ...result.warnings].slice(0, 8);
  // a receipt is issued by the seller; other papers (a customer's PO, a business card) by whoever sent them
  if (kind === 'document') result.facts = result.facts.map((f) => (f.label === FACT_LABELS.vendor ? { ...f, label: 'ผู้ออกเอกสาร' } : f));
  return result;
}

/**
 * Big lookups: turn the text the model read into one of the company's records (search with the user's token).
 * A hit becomes an offered option (so `toResult` accepts it); a miss stays empty for the person, its text goes into the
 * line's description when the line has one, and a warning names it. Mutates `input`; returns the warnings.
 */
async function resolveSearched(o: AiFillOptions, input: any, head: Field[], lineFields: Field[], searched: Set<string>, options: Map<string, Option[]>, fetcher: typeof fetch): Promise<string[]> {
  if (!searched.size) return [];
  const warnings: string[] = [];
  const cache = new Map<string, Promise<Option | null>>();
  const fix = async (fields: Field[], rec: Record<string, unknown>, where: string) => {
    for (const f of fields.filter((x) => searched.has(x.name))) {
      const text = typeof rec[f.name] === 'string' ? String(rec[f.name]).trim().slice(0, 200) : '';
      if (!text) continue;
      const key = `${f.name}\u0000${text}`;
      if (!cache.has(key)) cache.set(key, matchLookup(o, f, text, fetcher));
      const hit = await cache.get(key)!;
      if (hit) {
        if (!(options.get(f.name) ?? []).some((x) => x.id === hit.id)) options.set(f.name, [...(options.get(f.name) ?? []), hit]);
        rec[f.name] = hit.id;
      } else {
        delete rec[f.name];
        const desc = fields.find((x) => x.name === 'description' && x.type === 'text');
        if (desc && !rec.description) rec.description = text;
        warnings.push(`${where}ไม่พบ${f.label} "${text}" ในระบบ — เลือกเอง หรือเพิ่มในข้อมูลหลักก่อน`);
      }
    }
  };
  if (input.values && typeof input.values === 'object') await fix(head, input.values, '');
  const lines = Array.isArray(input.lines) ? input.lines.slice(0, MAX_LINES) : [];
  await Promise.all(lines.map((l: unknown, i: number) => (l && typeof l === 'object' ? fix(lineFields, l as Record<string, unknown>, `บรรทัด ${i + 1}: `) : undefined)));
  return warnings;
}

/** Model output -> form values: only fillable fields, cleaned, lookups only from the offered records. Exported for tests. */
export function toResult(input: any, head: Field[], lineFields: Field[], options: Map<string, Option[]>): AiFillResult {
  const warnings: string[] = [];
  const clean = (fields: Field[], raw: unknown): Record<string, unknown> => {
    const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const v = cleanAiValue(f, src[f.name]);
      if (v === undefined) continue;
      if (f.type === 'lookup') {
        const pick = options.get(f.name)?.find((x) => x.id === v);
        if (!pick) continue; // not one of the records we offered: leave it for the person
        Object.assign(out, Object.fromEntries(Object.entries(pick.assign).filter(([, x]) => x !== undefined && x !== null)));
        out[`__label.${f.name}`] = pick.label;
      } else out[f.name] = v;
    }
    return out;
  };
  const values = clean(head, input.values);
  const lines = (Array.isArray(input.lines) ? input.lines : []).slice(0, MAX_LINES).map((l: unknown) => clean(lineFields, l)).filter((l: Record<string, unknown>) => Object.keys(l).length);

  const facts: AiFillResult['facts'] = [];
  const rawFacts = input.facts && typeof input.facts === 'object' ? input.facts : {};
  for (const [k, label] of Object.entries(FACT_LABELS)) {
    const v = rawFacts[k];
    if (v === undefined || v === null || v === '') continue;
    const n = typeof v === 'number' ? v : NaN;
    facts.push({ label, value: Number.isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v).slice(0, 200) });
  }
  if (rawFacts.taxId && !isThaiTaxId(String(rawFacts.taxId))) warnings.push(`เลขผู้เสียภาษี ${rawFacts.taxId} ไม่ผ่านการตรวจหลักสุดท้าย — อาจอ่านผิด ตรวจกับใบเสร็จอีกครั้ง`);
  const total = Number(rawFacts.total);
  if (Number.isFinite(total) && total > 0 && lines.length && lineFields.some((f) => f.name === 'amount')) {
    const sum = lines.reduce((s: number, l: Record<string, unknown>) => s + Number(l.amount ?? 0) + Number(l.vat ?? 0), 0);
    if (Math.abs(sum - total) > 1) warnings.push(`ยอดรวมในเอกสาร ${total.toFixed(2)} ไม่ตรงกับรายการที่กรอก ${sum.toFixed(2)} — ตรวจจำนวนเงินและ VAT`);
  }
  for (const n of Array.isArray(input.notes) ? input.notes : []) if (typeof n === 'string' && n.trim()) warnings.push(n.trim().slice(0, 300));
  return { values, lines, facts, warnings: warnings.slice(0, 6) };
}
