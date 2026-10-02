/**
 * ผู้ช่วย AI — answers questions about the factory from live ERP data and opens screens for the user.
 *
 * Safety model (keep it this way when extending):
 *  - the model only READS, through the gateway, with the signed-in user's own token (RLS + permissions apply);
 *  - it may only GET endpoints that some installed module's ui.ts declares (lists, details, widgets, search);
 *  - it never writes: to create/approve anything it returns an `open_screen` button with a prefilled form,
 *    and the person reviews and presses save themselves.
 *
 * Server-only (runs in the Next route /assist). Pure apart from `fetch`, so it is unit-tested with fakes.
 */
import { cleanListFilters, endpointsOf, hasPerm, type ModuleUi, type Screen } from '@erp/ui-schema';

export interface ChatMessage { role: 'user' | 'assistant'; content: string }
export interface AssistAction { label: string; href: string }
export interface AssistResult { reply: string; actions: AssistAction[]; reads: string[] }

export interface AssistOptions {
  messages: ChatMessage[];
  /** the user's ERP token (Bearer …) — forwarded to the gateway, never to the model */
  authorization: string;
  apiKey: string;
  gatewayUrl: string;
  /** modules installed AND shipped with screens */
  modules: ModuleUi[];
  permissions: string[];
  model?: string;
  baseUrl?: string;
  tenantName?: string;
  today?: string;
  fetch?: typeof fetch;
  maxTurns?: number;
  /** 'find' = "ค้นหาด้วย AI": pick one list screen + its filters from a Thai sentence (short, cheap) */
  mode?: 'chat' | 'find';
}

const MAX_TOOL_CHARS = 14_000;
const MAX_ROWS = 40;

/** GET templates the assistant may read, per module. */
export function readableEndpoints(modules: ModuleUi[]): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  const ids = new Set(modules.map((m) => m.module));
  for (const ui of modules) {
    for (const e of endpointsOf(ui)) {
      if (e.method !== 'GET' || !ids.has(e.module)) continue;
      if (!out.has(e.module)) out.set(e.module, new Set());
      out.get(e.module)!.add(e.path);
    }
    for (const s of Object.values(ui.screens)) {
      if (s.kind !== 'form') {
        if (!out.has(ui.module)) out.set(ui.module, new Set());
        out.get(ui.module)!.add(s.endpoint);
      }
    }
  }
  return new Map([...out].map(([k, v]) => [k, [...v]]));
}

/**
 * "/purchase-orders/abc" matches "/purchase-orders/:id". An id segment is plain text only: no percent-encoding, dot segments,
 * query or fragment — `%2e%2e` would otherwise climb out of the template once the URL is normalised (security review 0.3, SEC-08).
 */
export function matchesTemplate(path: string, template: string): boolean {
  if (/[?#%\\\s]/.test(path) || path.split('/').some((seg) => seg === '.' || seg === '..')) return false;
  const re = new RegExp(`^${template.split('/').map((seg) => (seg.startsWith(':') ? '[A-Za-z0-9_~:@.\\-]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);
  return re.test(path);
}

function screenCatalog(modules: ModuleUi[], perms: string[], find = false): string {
  const lines: string[] = [];
  for (const m of modules) {
    const screens = Object.entries(m.screens).filter(([, s]) => hasPerm(perms, s.perm) && (!find || s.kind === 'list'));
    if (!screens.length) continue;
    lines.push(`## ${m.module} — ${m.label}`);
    for (const [id, s] of screens) lines.push(`- ${id} [${s.kind}] "${s.title}" ${find && s.kind === 'list' ? describeFilters(s) : describeScreen(s)}`);
    if (!find) for (const w of m.widgets ?? []) if (hasPerm(perms, w.perm)) lines.push(`- (สรุป) GET ${w.endpoint} — ${w.title}`);
  }
  return lines.join('\n');
}

/** For "ค้นหาด้วย AI": each filter with its type and allowed values, so the model can only pick real ones. */
function describeFilters(s: Extract<Screen, { kind: 'list' }>): string {
  if (!s.filters?.length) return '(ไม่มีตัวกรอง)';
  return `filters: ${s.filters.map((f) => {
    if (f.type === 'select') return `${f.name}(${f.label}: ${(f.options ?? []).map((o) => `${o.value}=${o.label}`).join('|')})`;
    if (f.type === 'lookup' && f.lookup) return `${f.name}(${f.label}: id จาก ${f.lookup.module ?? 'same'}:${f.lookup.path}.${f.lookup.assign[f.name]})`;
    return `${f.name}(${f.label}: ${f.type})`;
  }).join(', ')}`;
}

function describeScreen(s: Screen): string {
  if (s.kind === 'list') return `GET ${s.endpoint}${s.filters?.length ? ` filters: ${s.filters.map((f) => f.name).join(', ')}` : ''} columns: ${s.columns.map((c) => c.key).join(', ')}`;
  if (s.kind === 'detail') return `GET ${s.endpoint} (open with id)`;
  const lookups = s.fields.filter((f) => f.lookup).map((f) => `${f.name}←${f.lookup!.module ?? 'same'}:${f.lookup!.path}.${f.lookup!.assign[f.name]}`);
  return `form fields: ${s.fields.map((f) => `${f.name}(${f.label})`).join(', ')}${lookups.length ? `; lookup ids: ${lookups.join(', ')}` : ''}${s.lines ? `; has ${s.lines.label} lines (user fills them)` : ''}`;
}

const TOOLS = [
  {
    name: 'read_data',
    description: 'อ่านข้อมูลจริงจาก ERP (GET เท่านั้น) ผ่านสิทธิ์ของผู้ใช้ ใช้ได้เฉพาะ endpoint ที่อยู่ในรายการหน้าจอ เช่น module "inventory" path "/balances" หรือ module "purchasing" path "/summary". ใส่ query เป็นตัวกรอง เช่น {"q":"STEEL"} หรือ {"status":"draft"}',
    input_schema: {
      type: 'object',
      properties: {
        module: { type: 'string' },
        path: { type: 'string', description: 'concrete path, e.g. /purchase-orders/5f0c…' },
        query: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['module', 'path'],
    },
  },
  {
    name: 'open_screen',
    description: 'เพิ่มปุ่มให้ผู้ใช้กดเปิดหน้าจอ (ผู้ช่วยบันทึก/อนุมัติเองไม่ได้). สำหรับฟอร์มใส่ values เพื่อกรอกให้ล่วงหน้า (ใช้ id จริงจาก read_data สำหรับช่อง lookup และใส่ label เป็นข้อความที่จะแสดงในช่องนั้นใน lookupLabels). สำหรับหน้า detail ใส่ id',
    input_schema: {
      type: 'object',
      properties: {
        module: { type: 'string' },
        screen: { type: 'string' },
        id: { type: 'string' },
        values: { type: 'object', additionalProperties: { type: ['string', 'number'] } },
        lookupLabels: { type: 'object', additionalProperties: { type: 'string' } },
        label: { type: 'string', description: 'ข้อความบนปุ่ม เช่น "เปิดใบสั่งซื้อ PO-2569-0012"' },
      },
      required: ['module', 'screen', 'label'],
    },
  },
] as const;

function trimJson(data: unknown): string {
  const cut = (v: unknown): unknown => (Array.isArray(v) ? v.slice(0, MAX_ROWS).map(cut) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x)])) : v);
  let s = JSON.stringify(cut(data));
  if (Array.isArray(data) && data.length > MAX_ROWS) s = `{"rows":${s},"note":"แสดง ${MAX_ROWS} จาก ${data.length} แถว"}`;
  return s.length > MAX_TOOL_CHARS ? `${s.slice(0, MAX_TOOL_CHARS)}…(ตัดทอน)` : s;
}

export async function runAssistant(o: AssistOptions): Promise<AssistResult> {
  const f = o.fetch ?? fetch;
  const readable = readableEndpoints(o.modules);
  const actions: AssistAction[] = [];
  const reads: string[] = [];

  const find = o.mode === 'find';
  const system = [
    `คุณคือ "ผู้ช่วยโรงงาน" ใน ERP ของ ${o.tenantName ?? 'บริษัทนี้'} วันนี้ ${o.today ?? new Date().toISOString().slice(0, 10)}`,
    ...(find ? [
      'ผู้ใช้พิมพ์ประโยคเพื่อค้นหารายการ ให้เลือกหน้ารายการ [list] ที่ตรงที่สุด "หน้าเดียว" แล้วเรียก open_screen ทันที โดยใส่ตัวกรองใน values (ใช้เฉพาะชื่อตัวกรองและค่าที่ระบุไว้ในรายการ วันที่เป็น YYYY-MM-DD ค.ศ.)',
      'ข้อความค้นหาอิสระใส่ในตัวกรอง q ถ้ามี. ใช้ read_data เฉพาะเมื่อต้องหา id ของตัวกรองแบบ lookup. ตอบภาษาไทยสั้นหนึ่งประโยคว่ากรองอะไรให้ ถ้าไม่มีหน้าที่ตรงให้บอกตรงๆ',
    ] : [
      'ตอบเป็นภาษาไทย สั้น ชัด เป็นกันเอง ใช้ตัวเลขจริงจาก read_data เท่านั้น ห้ามเดาตัวเลข ถ้าไม่มีข้อมูลให้บอกตรงๆ',
      'คุณอ่านได้อย่างเดียว ถ้าผู้ใช้ขอให้สร้าง/แก้/อนุมัติ ให้หา id ที่ต้องใช้ด้วย read_data แล้วเรียก open_screen พร้อม values ให้ผู้ใช้ตรวจและกดบันทึกเอง',
      'จำนวนเงินเป็นบาท แสดงแบบ 12,500.00 บาท. ปีเอกสารเป็น พ.ศ.',
    ]),
    'หน้าจอและข้อมูลที่ผู้ใช้คนนี้เข้าถึงได้:',
    screenCatalog(o.modules, o.permissions, find),
  ].join('\n');

  const runTool = async (name: string, input: any): Promise<string> => {
    if (name === 'read_data') {
      const module = String(input.module ?? '');
      const path = String(input.path ?? '');
      const allowed = readable.get(module) ?? [];
      if (!path.startsWith('/') || path.includes('..') || !allowed.some((t) => matchesTemplate(path, t))) {
        return `ไม่อนุญาต: ${module}${path} — ใช้ได้เฉพาะ ${allowed.join(', ') || '(ไม่มี)'}`;
      }
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries((input.query ?? {}) as Record<string, unknown>)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      const url = `${o.gatewayUrl.replace(/\/$/, '')}/api/${module}${path}${qs.size ? `?${qs}` : ''}`;
      reads.push(`${module}${path}${qs.size ? `?${qs}` : ''}`);
      const res = await f(url, { headers: { authorization: o.authorization }, cache: 'no-store' } as RequestInit);
      const text = await res.text();
      if (!res.ok) return `ผิดพลาด ${res.status}: ${text.slice(0, 300)}`;
      try { return trimJson(JSON.parse(text)); } catch { return text.slice(0, MAX_TOOL_CHARS); }
    }
    if (name === 'open_screen') {
      const ui = o.modules.find((m) => m.module === input.module);
      const screen = ui?.screens[String(input.screen)];
      if (!ui || !screen) return `ไม่มีหน้าจอ ${input.module}/${input.screen}`;
      if (!hasPerm(o.permissions, screen.perm)) return 'ผู้ใช้ไม่มีสิทธิ์เปิดหน้านี้';
      const q = new URLSearchParams();
      const isForm = screen.kind === 'form';
      const values = (input.values ?? {}) as Record<string, unknown>;
      if (isForm) {
        for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== null && v !== '') q.set(`f.${k}`, String(v));
        for (const [k, v] of Object.entries((input.lookupLabels ?? {}) as Record<string, unknown>)) if (v) q.set(`l.${k}`, String(v));
      } else if (screen.kind === 'list') {
        // only filters the list declares, with valid values (dates, select options) — the rest is dropped
        for (const [k, v] of Object.entries(cleanListFilters(screen.filters, values))) q.set(k, v);
      }
      const id = input.id ? `/${encodeURIComponent(String(input.id))}` : '';
      const href = `/m/${ui.module}/${String(input.screen)}${id}${q.size ? `?${q}` : ''}`;
      actions.push({ label: String(input.label || screen.title).slice(0, 80), href });
      return 'เพิ่มปุ่มให้ผู้ใช้แล้ว';
    }
    return `ไม่รู้จักเครื่องมือ ${name}`;
  };

  const messages: any[] = o.messages.map((m) => ({ role: m.role, content: m.content }));
  const base = (o.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  for (let turn = 0; turn < (o.maxTurns ?? (find ? 4 : 8)); turn++) {
    const res = await f(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': o.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: o.model ?? 'claude-sonnet-5-5', max_tokens: find ? 600 : 1500, system, tools: TOOLS, messages }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI ตอบกลับผิดพลาด (${res.status}) ${text.slice(0, 200)}`);
    }
    const msg = (await res.json()) as { content: any[]; stop_reason: string };
    messages.push({ role: 'assistant', content: msg.content });
    const uses = msg.content.filter((b) => b.type === 'tool_use');
    if (msg.stop_reason !== 'tool_use' || !uses.length) {
      const reply = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { reply: reply || 'เรียบร้อย', actions, reads };
    }
    const results = [];
    for (const u of uses) {
      let content: string;
      try { content = await runTool(u.name, u.input ?? {}); } catch (e) { content = `ผิดพลาด: ${e instanceof Error ? e.message : String(e)}`; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content });
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: 'คำถามนี้ต้องค้นข้อมูลหลายขั้นเกินไป ลองถามให้แคบลงอีกนิด', actions, reads };
}

/* ---------------- "สรุปให้หน่อย": the daily briefing on the dashboard ---------------- */

export const BRIEFING_PROMPT = [
  'สรุปสิ่งที่ต้องดูวันนี้ให้หน่อย',
  'ให้อ่านตัวเลข (สรุป) ของทุกโมดูลที่ฉันเข้าถึงได้ด้วย read_data โดยเรียกหลายตัวพร้อมกันในรอบเดียว',
  'แล้วตอบเป็นข้อ ๆ ไม่เกิน 5 ข้อ แต่ละข้อขึ้นต้นด้วย "- " ยาวไม่เกินหนึ่งบรรทัด เรียงจากเรื่องที่เร่งที่สุด บอกตัวเลขจริงและสิ่งที่ควรทำ',
  'สำหรับเรื่องที่ต้องลงมือ ให้เรียก open_screen ไปยังหน้ารายการที่เกี่ยวข้อง (ใส่ตัวกรองถ้ามี) ข้อละไม่เกิน 1 ปุ่ม',
  'ไม่ต้องมีคำนำหรือคำลงท้าย ถ้ามีเรื่องจริงไม่ถึง 5 เรื่องให้ใส่เท่าที่มี ห้ามแต่งตัวเลข',
].join('\n');

/** "- ข้อ 1\n- ข้อ 2" (or "1. …", "• …") -> ["ข้อ 1", "ข้อ 2"], at most 5; a reply without bullets stays one item. */
export function briefingBullets(reply: string): string[] {
  const items = reply.split('\n').map((l) => l.trim()).filter((l) => /^([-•*]|\d+[.)])\s+/.test(l)).map((l) => l.replace(/^([-•*]|\d+[.)])\s+/, '').replace(/\*\*/g, '').trim());
  return (items.length ? items : [reply.trim()]).filter(Boolean).slice(0, 5);
}

export interface Briefing extends AssistResult { bullets: string[]; generatedAt: string; cached?: boolean }

export async function runBriefing(o: Omit<AssistOptions, 'messages' | 'mode'>): Promise<Briefing> {
  const r = await runAssistant({ ...o, maxTurns: o.maxTurns ?? 6, messages: [{ role: 'user', content: BRIEFING_PROMPT }] });
  return { ...r, bullets: briefingBullets(r.reply), generatedAt: new Date().toISOString() };
}

/** Per-user memo so the dashboard button costs at most one AI run per user per `ttlMs` (default 10 minutes), double clicks included. */
export class BriefingCache {
  private entries = new Map<string, { at: number; value: Promise<Briefing> }>();
  constructor(private ttlMs = 10 * 60_000, private now: () => number = Date.now) {}

  async get(key: string, make: () => Promise<Briefing>): Promise<Briefing> {
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return { ...(await hit.value), cached: true };
    if (this.entries.size > 2000) for (const [k, v] of this.entries) if (this.now() - v.at >= this.ttlMs) this.entries.delete(k);
    const value = make();
    this.entries.set(key, { at: this.now(), value });
    try { return await value; } catch (e) { this.entries.delete(key); throw e; }
  }
}

/* ---------------- "ค้นหาด้วย AI": a Thai sentence -> one list screen with filters ---------------- */

export async function findScreen(o: Omit<AssistOptions, 'messages' | 'mode'> & { text: string }): Promise<AssistResult> {
  const { text, ...rest } = o;
  const r = await runAssistant({ ...rest, mode: 'find', messages: [{ role: 'user', content: text.slice(0, 500) }] });
  return { ...r, actions: r.actions.slice(0, 1) };
}
