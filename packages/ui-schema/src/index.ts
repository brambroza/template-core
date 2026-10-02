/**
 * UI descriptors — each module describes its screens as plain data in `services/<id>/src/ui.ts`.
 * The web app and the mobile app render them generically, so a module's UI ships (and is sold) with the module.
 *
 * Endpoints are relative to the module (`/purchase-orders/:id`) and use the SAME path template as the
 * server route. `:name` is filled from form values / the current row; a screen opened with an id fills
 * the FIRST `:param` of its endpoint with that id (see `routeParams`). Lookups may only point at the module itself or a core module.
 *
 * This file must stay dependency-free and browser-safe (no node imports): web and mobile both import it.
 */

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'boolean' | 'lookup' | 'multilookup' | 'permissions' | 'password' | 'email';

export interface Lookup {
  /** module that owns the list; omit = this module */
  module?: string;
  path: string;
  /** extra query, e.g. { kind: 'supplier' } */
  query?: Record<string, string>;
  /** shown in the picker */
  label: string[];
  /** form field <- record field, e.g. { itemId: 'id', itemCode: 'code', itemName: 'name' } */
  assign: Record<string, string>;
  /** allow scanning a barcode/QR whose text equals this record field (mobile) */
  scanField?: string;
}

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  lookup?: Lookup;
  /** number input step */
  step?: number;
  help?: string;
}

/** status = coloured state badge; label = Thai name of a code (item type, partner kind…) without a badge */
export type Format = 'text' | 'money' | 'qty' | 'date' | 'datetime' | 'month' | 'status' | 'label' | 'boolean' | 'list' | 'qr' | 'percent';

export interface Column {
  /** dotted path into the record: "customer.name" */
  key: string;
  label: string;
  format?: Format;
}

export interface LinesSpec {
  /** body field / record path holding the array */
  name: string;
  label: string;
  fields: Field[];
  min?: number;
}

export interface Condition {
  field: string;
  in: (string | number | boolean | null)[];
}

export interface Action {
  id: string;
  label: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  perm?: string;
  when?: Condition;
  confirm?: string;
  /** ask for a body first */
  fields?: Field[];
  lines?: LinesSpec;
  tone?: 'primary' | 'danger' | 'default';
  /** open another screen with the response, e.g. the invoice that was just created */
  then?: { screen: string; idFrom?: string };
  /** show this response field as a toast after success (e.g. a dry-run preview) */
  toast?: string;
  mobile?: boolean;
}

interface ScreenBase {
  title: string;
  perm?: string;
  mobile?: boolean;
}

export interface ListScreen extends ScreenBase {
  kind: 'list';
  endpoint: string;
  /** path of the array inside the response when it is not the response itself, e.g. "items" */
  rows?: string;
  /** 'cards': a grid of cards (first column = title, second = text, the rest as small facts) — for galleries */
  display?: 'table' | 'cards';
  columns: Column[];
  filters?: Field[];
  /** screen id of the create form */
  create?: string;
  createLabel?: string;
  /** open this detail screen on row click; `params` maps route params from the row (default id -> 'id') */
  rowLink?: { screen: string; idFrom?: string };
  /** buttons on the list itself (e.g. "generate PM work orders") */
  actions?: Action[];
  /** buttons on each row; endpoint params are filled from the row */
  rowActions?: Action[];
  /** bulk import from a CSV file (web): dry-run preview, then the real import — see ImportSpec */
  import?: ImportSpec;
  empty?: string;
}

/**
 * CSV bulk import on a list screen. `endpoint` is a POST route of this module that accepts
 * `{ rows: Record<string, unknown>[], dryRun?: boolean }` (values arrive as text from the file) and answers
 * an ImportResult. File headers are matched to `columns` by label or by key (case-insensitive, a trailing "*" ignored).
 */
export interface ImportSpec {
  endpoint: string;
  perm?: string;
  columns: ImportColumn[];
  /** file name of the downloadable empty template (header row only), e.g. "items-template.csv" */
  template?: string;
}

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
}

/** `row` is 1-based in the request's `rows`; `field` is a column key when the problem is in one cell. */
export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}

/** What an import endpoint answers. In a dry run `created`/`updated` are what WOULD happen. */
export interface ImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  errors: ImportRowError[];
}

export const IMPORT_MAX_ROWS = 2000;

export interface FormScreen extends ScreenBase {
  kind: 'form';
  method: 'POST' | 'PUT' | 'PATCH';
  endpoint: string;
  /** prefill from this endpoint (edit forms) */
  load?: string;
  fields: Field[];
  lines?: LinesSpec;
  submitLabel: string;
  /** after success: open detail of the response, or go back to a list */
  after?: { screen: string; idFrom?: string };
}

/** The happy path of a document's status, drawn as a 2D stepper on its detail screen. */
export interface StatusFlow {
  field: string;
  steps: { value: string; label: string }[];
  /** statuses that end the document off the happy path (e.g. cancelled) */
  exits?: { value: string; label: string }[];
}

export interface DetailScreen extends ScreenBase {
  kind: 'detail';
  endpoint: string;
  /** record path used as heading, e.g. "no" */
  heading: string;
  flow?: StatusFlow;
  fields: Column[];
  lines?: { path: string; label: string; columns: Column[] }[];
  actions?: Action[];
  edit?: string;
  printable?: boolean;
}

export type Screen = ListScreen | FormScreen | DetailScreen;

export interface MenuItem {
  label: string;
  screen: string;
}

/* ---------------- dashboard widgets (rendered on the home "Factory Pulse") ---------------- */

interface WidgetBase {
  id: string;
  title: string;
  /** GET endpoint of this module returning the widget's data */
  endpoint: string;
  perm?: string;
  /** screen opened when the widget is clicked */
  href?: string;
  /** relative size on the dashboard grid (of 6 columns: sm 2, md 3, wide 4, lg 6) */
  size?: 'sm' | 'md' | 'wide' | 'lg';
}

/** Counters: one big number each, animated on load. */
export interface KpiWidget extends WidgetBase {
  kind: 'kpi';
  items: { key: string; label: string; format?: Format; tone?: 'neutral' | 'ok' | 'warn' | 'stop' }[];
}

/** Horizontal bars, optionally with a threshold mark per bar (e.g. reorder point). */
export interface BarsWidget extends WidgetBase {
  kind: 'bars';
  rows: string;
  label: string;
  value: string;
  threshold?: string;
  format?: Format;
}

/** Records flowing through stages (kanban-like columns). */
export interface PipelineWidget extends WidgetBase {
  kind: 'pipeline';
  rows: string;
  field: string;
  stages: { value: string; label: string }[];
  title2: string;
  subtitle?: string;
  link?: { screen: string; idFrom?: string };
}

/** A small time series drawn as an area chart. */
export interface TrendWidget extends WidgetBase {
  kind: 'trend';
  rows: string;
  x: string;
  y: string;
  format?: Format;
}

/** Machines/assets laid out on a 3D factory floor, coloured by status. */
export interface FloorWidget extends WidgetBase {
  kind: 'floor3d';
  rows: string;
  code: string;
  name: string;
  status: string;
  group?: string;
  badge?: string;
  link?: { screen: string; idFrom?: string };
}

/** A live activity feed (e.g. what the automation bots just did). `link` is a field holding an in-app path. */
export interface FeedWidget extends WidgetBase {
  kind: 'feed';
  rows: string;
  title2: string;
  body?: string;
  time: string;
  level?: string;
  link?: string;
}

export type Widget = KpiWidget | BarsWidget | PipelineWidget | TrendWidget | FloorWidget | FeedWidget;

/** A module that collects notifications for the bell (e.g. automation). */
export interface NotificationsSpec {
  endpoint: string;
  readEndpoint: string;
  readAllEndpoint: string;
  perm?: string;
}

/** Records the command palette can search by typed text (the endpoint must accept ?q=). */
export interface SearchSpec {
  id: string;
  title: string;
  endpoint: string;
  query?: Record<string, string>;
  label: string[];
  screen: string;
  idFrom?: string;
  perm?: string;
}

/**
 * A Thai command for the palette, e.g. "แจ้งซ่อม PRESS-01 น้ำมันรั่ว".
 * The first word after a keyword is resolved through `arg.lookup` (its `assign` map fills fields/filters),
 * the rest of the text goes to `restField`. Opens `screen` (a list gets filters, a form gets prefilled values,
 * a detail opens the record named by `arg.openId`).
 */
export interface CommandSpec {
  id: string;
  label: string;
  example: string;
  keywords: string[];
  screen: string;
  perm?: string;
  arg?: { lookup: Lookup; openId?: string };
  restField?: string;
}

export interface ModuleUi {
  module: string;
  label: string;
  /** a short glyph for the menu (one or two characters) — used where icons are unavailable */
  glyph: string;
  /** icon name from the shared icon set (see ICONS) */
  icon?: Icon;
  menu: MenuItem[];
  screens: Record<string, Screen>;
  widgets?: Widget[];
  notifications?: NotificationsSpec;
  /** this module's wording for shared status/label codes, e.g. { in_progress: 'กำลังซ่อม' } */
  statusLabels?: Record<string, string>;
  search?: SearchSpec[];
  commands?: CommandSpec[];
  /** where the module sits in the menu and on the home dashboard; defaults per module id (see moduleArea) */
  area?: AreaId;
}

/* ---------------- areas: how 18+ modules are grouped in the menu and on the home dashboard ---------------- */

export type AreaId = 'operations' | 'commercial' | 'office' | 'service' | 'settings';

/** Business areas in display order. */
export const AREAS: readonly { id: AreaId; label: string }[] = [
  { id: 'operations', label: 'การผลิต & คลัง' },
  { id: 'commercial', label: 'ขาย & ลูกค้า' },
  { id: 'office', label: 'สำนักงาน & บุคคล' },
  { id: 'service', label: 'บริการ & โครงการ' },
  { id: 'settings', label: 'ตั้งค่า' },
];

const MODULE_AREA: Record<string, AreaId> = {
  inventory: 'operations', purchasing: 'operations', production: 'operations', quality: 'operations', maintenance: 'operations', costing: 'operations',
  crm: 'commercial', sales: 'commercial',
  approvals: 'office', expense: 'office', hr: 'office', booking: 'office', assets: 'office',
  helpdesk: 'service', projects: 'service',
  automation: 'settings', 'master-data': 'settings', identity: 'settings',
};

/** The area of a module: its own `area`, the built-in default for GO Along modules, else 'operations' (a factory add-on). */
export function moduleArea(ui: { module: string; area?: AreaId }): AreaId {
  return ui.area ?? MODULE_AREA[ui.module] ?? 'operations';
}

export function areaLabel(id: AreaId): string {
  return AREAS.find((a) => a.id === id)?.label ?? id;
}

/** Group items by the area of their module, in AREAS order, keeping the items' own order inside an area. Empty areas are left out. */
export function groupByArea<T>(items: T[], moduleOf: (item: T) => { module: string; area?: AreaId }): { area: AreaId; label: string; items: T[] }[] {
  return AREAS.map((a) => ({ area: a.id, label: a.label, items: items.filter((i) => moduleArea(moduleOf(i)) === a.id) })).filter((g) => g.items.length);
}

/** Icon names the apps know how to draw (lucide names). */
export const ICONS = ['users', 'database', 'boxes', 'shopping-cart', 'receipt', 'factory', 'wrench', 'calculator', 'zap', 'bot', 'gauge',
  'stamp', 'id-card', 'wallet', 'package', 'handshake', 'life-buoy', 'kanban', 'shield-check', 'calendar'] as const;
export type Icon = (typeof ICONS)[number];

export function defineUi(ui: ModuleUi): ModuleUi {
  return ui;
}

/* ---------------- helpers shared by web and mobile ---------------- */

/** The rows of a list response: the response itself, or the array at `screen.rows`. */
export function listRows(screen: { rows?: string }, res: unknown): Record<string, unknown>[] {
  const v = screen.rows ? get(res, screen.rows) : res;
  return Array.isArray(v) ? v : [];
}

/** Pick the record a command argument names: exact code match first, then any label containing the text. */
export function pickRecord(lookup: Lookup, rows: Record<string, unknown>[], text: string): Record<string, unknown> | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const val = (r: Record<string, unknown>, k: string) => String(get(r, k) ?? '').toLowerCase();
  return rows.find((r) => lookup.label.some((k) => val(r, k) === t))
    ?? rows.find((r) => lookup.label.some((k) => val(r, k).startsWith(t)))
    ?? rows.find((r) => lookup.label.some((k) => val(r, k).includes(t)))
    ?? null;
}

/**
 * Where a matched command goes. Forms get `f.<field>` prefill values (+ `l.<field>` = the picked record's label
 * for lookups), lists get plain filter params, `arg.openId` opens the record itself.
 */
export function commandTarget(cmd: CommandSpec, screen: Screen | undefined, record: Record<string, unknown> | null, rest: string): { screen: string; id?: string; query: Record<string, string> } {
  const query: Record<string, string> = {};
  if (cmd.arg?.openId && record) return { screen: cmd.screen, id: String(get(record, cmd.arg.openId)), query };
  const isForm = screen?.kind === 'form';
  if (cmd.arg && record) {
    const { assign, label } = cmd.arg.lookup;
    for (const [target, source] of Object.entries(assign)) {
      const v = get(record, source);
      if (v !== undefined && v !== null && v !== '') query[isForm ? `f.${target}` : target] = String(v);
    }
    const first = Object.keys(assign)[0];
    if (isForm && first) query[`l.${first}`] = label.map((k) => get(record, k)).filter(Boolean).join('  ');
  }
  if (cmd.restField && rest) query[isForm ? `f.${cmd.restField}` : cmd.restField] = rest;
  return { screen: cmd.screen, query };
}

/** Form values from URL params written by commandTarget: f.<field>=value, l.<field>=label of a picked lookup. */
export function prefillFromQuery(entries: Iterable<[string, string]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    if (k.startsWith('f.')) out[k.slice(2)] = v;
    else if (k.startsWith('l.')) out[`__label.${k.slice(2)}`] = v;
  }
  return out;
}

export function get(obj: unknown, path: string): any {
  return path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
}

/** "/orders/:id/approve" + { id } -> "/orders/123/approve". Missing values throw so bugs surface early. */
export function fillPath(template: string, ...sources: Record<string, unknown>[]): string {
  return template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    for (const s of sources) {
      const v = s?.[name];
      if (v !== undefined && v !== null && v !== '') return encodeURIComponent(String(v));
    }
    throw new Error(`Missing value for :${name} in ${template}`);
  });
}

/**
 * Match typed text against a module's commands. Returns the command and the text after the keyword
 * split into the lookup word and the rest ("แจ้งซ่อม PRESS-01 น้ำมันรั่ว" -> arg "PRESS-01", rest "น้ำมันรั่ว").
 */
export function matchCommand(commands: CommandSpec[], text: string): { command: CommandSpec; argText: string; rest: string } | null {
  const t = text.trim();
  let best: { command: CommandSpec; kw: string } | null = null;
  for (const c of commands) for (const kw of c.keywords) {
    if (t.toLowerCase().startsWith(kw.toLowerCase()) && (!best || kw.length > best.kw.length)) best = { command: c, kw };
  }
  if (!best) return null;
  const after = t.slice(best.kw.length).trim();
  if (!best.command.arg) return { command: best.command, argText: '', rest: after };
  const [argText = '', ...rest] = after.split(/\s+/);
  return { command: best.command, argText, rest: rest.join(' ') };
}

/** A screen opened as /m/<module>/<screen>/<id> binds `id` to the first `:param` of its endpoint. */
export function routeParams(template: string, id?: string): Record<string, string> {
  if (!id) return {};
  const first = template.match(/:([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
  return first ? { [first]: id, id } : { id };
}

/** Where a document sits on its flow: index of the current step, or -1 when it exited (e.g. cancelled). */
export function flowPosition(flow: StatusFlow, record: unknown): { index: number; exit?: { value: string; label: string } } {
  const v = get(record, flow.field);
  const exit = flow.exits?.find((e) => e.value === v);
  if (exit) return { index: -1, exit };
  return { index: flow.steps.findIndex((st) => st.value === v) };
}

export function hasPerm(perms: string[], perm?: string): boolean {
  if (!perm) return true;
  const mod = perm.split('.')[0];
  return perms.includes('*') || perms.includes(perm) || perms.includes(`${mod}.*`);
}

export function matches(record: unknown, cond?: Condition): boolean {
  if (!cond) return true;
  return cond.in.includes(get(record, cond.field) ?? null);
}

export const STATUS_TH: Record<string, string> = {
  draft: 'ร่าง', approved: 'อนุมัติแล้ว', partially_received: 'รับบางส่วน', received: 'รับครบ', cancelled: 'ยกเลิก',
  confirmed: 'ยืนยันแล้ว', delivered: 'ส่งของแล้ว', invoiced: 'ออกใบกำกับแล้ว',
  planned: 'วางแผน', released: 'ปล่อยงาน', completed: 'เสร็จสิ้น',
  open: 'รอดำเนินการ', in_progress: 'กำลังดำเนินการ', done: 'เสร็จแล้ว',
  running: 'เดินเครื่อง', down: 'เครื่องเสีย', retired: 'เลิกใช้',
  receive: 'รับเข้า', issue: 'จ่ายออก', transfer_in: 'โอนเข้า', transfer_out: 'โอนออก', adjust: 'ปรับปรุง',
  breakdown: 'แจ้งเสีย', pm: 'PM', purchase: 'จากการซื้อ', manual: 'กำหนดเอง',
  raw: 'วัตถุดิบ', semi: 'กึ่งสำเร็จรูป', finished: 'สินค้าสำเร็จรูป', spare: 'อะไหล่', service: 'บริการ',
  customer: 'ลูกค้า', supplier: 'ผู้ขาย', both: 'ลูกค้าและผู้ขาย',
  failed: 'ล้มเหลว', skipped: 'ข้าม',
  inventory: 'คลังสินค้า', purchasing: 'จัดซื้อ', sales: 'ขาย', production: 'ผลิต', maintenance: 'ซ่อมบำรุง',
  info: 'ข้อมูล', warn: 'เตือน', stop: 'ด่วน', ok: 'สำเร็จ',
  // workflow statuses shared by the business modules
  pending: 'รออนุมัติ', submitted: 'ส่งแล้ว', rejected: 'ไม่อนุมัติ', returned: 'ส่งกลับแก้ไข', paid: 'จ่ายแล้ว',
  requested: 'ขอเบิก', cleared: 'เคลียร์แล้ว', sent: 'ส่งแล้ว', accepted: 'ตอบรับ', expired: 'หมดอายุ',
  new: 'ใหม่', contacted: 'ติดต่อแล้ว', qualified: 'มีโอกาส', converted: 'แปลงเป็นโอกาสขาย', lost: 'สูญหาย/ไม่สำเร็จ',
  prospect: 'สนใจ', proposal: 'เสนอราคา', negotiation: 'ต่อรอง', won: 'ปิดการขายได้',
  waiting: 'รอลูกค้า', resolved: 'แก้ไขแล้ว', closed: 'ปิดแล้ว', investigating: 'กำลังตรวจสอบ', action: 'ดำเนินการแก้ไข', verified: 'ยืนยันผลแล้ว',
  active: 'ใช้งาน', probation: 'ทดลองงาน', resigned: 'ลาออก', present: 'มาทำงาน', late: 'สาย', leave: 'ลา', absent: 'ขาดงาน', not_in: 'ยังไม่ลงเวลา', off: 'วันหยุด',
  self: 'ตนเอง', admin: 'ผู้ดูแล',
  planning: 'วางแผน', on_hold: 'พักไว้', todo: 'ยังไม่เริ่ม', doing: 'กำลังทำ', review: 'รอตรวจ',
  in_use: 'ใช้งานอยู่', in_storage: 'เก็บในคลัง', in_repair: 'ส่งซ่อม', disposed: 'จำหน่ายแล้ว', missing: 'ไม่พบ', unexpected: 'ไม่อยู่ในรายการ',
  sold: 'ขาย', scrapped: 'ทำลาย', donated: 'บริจาค', straight_line: 'เส้นตรง', none: 'ไม่คิด',
  low: 'ต่ำ', normal: 'ปกติ', high: 'สูง', urgent: 'ด่วนมาก',
  pass: 'ผ่าน', fail: 'ไม่ผ่าน', conditional: 'ผ่านแบบมีเงื่อนไข', minor: 'เล็กน้อย', major: 'สำคัญ', critical: 'วิกฤต',
  room: 'ห้อง', vehicle: 'รถ', equipment: 'อุปกรณ์',
};

export type Tone = 'neutral' | 'progress' | 'ok' | 'warn' | 'stop';

export function statusTone(status: string): Tone {
  if (['received', 'delivered', 'invoiced', 'completed', 'done', 'running', 'ok', 'paid', 'accepted', 'won', 'resolved', 'closed', 'verified', 'pass', 'present', 'cleared', 'converted', 'in_use'].includes(status)) return 'ok';
  if (['approved', 'confirmed', 'released', 'in_progress', 'submitted', 'sent', 'doing', 'review', 'active', 'investigating', 'action', 'proposal', 'negotiation', 'qualified', 'contacted'].includes(status)) return 'progress';
  if (['partially_received', 'warn', 'skipped', 'pending', 'returned', 'waiting', 'late', 'on_hold', 'conditional', 'in_repair', 'probation', 'expired', 'high'].includes(status)) return 'warn';
  if (['cancelled', 'down', 'retired', 'failed', 'stop', 'rejected', 'lost', 'fail', 'absent', 'missing', 'urgent', 'critical', 'disposed', 'resigned'].includes(status)) return 'stop';
  return 'neutral';
}

const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 4 });

/** Thai date with Buddhist year: "2 ต.ค. 2569". Accepts YYYY-MM-DD or ISO timestamps. */
export function formatDate(value: string, withTime = false): string {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('th-TH-u-ca-buddhist', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatValue(value: unknown, format: Format = 'text', labels?: Record<string, string>): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (format) {
    case 'money': return money.format(Number(value));
    case 'qty': return qty.format(Number(value));
    case 'percent': return `${qty.format(Number(value))}%`;
    case 'date': return formatDate(String(value));
    case 'month': {
      const d = new Date(`${String(value).slice(0, 7)}-01T00:00:00`);
      return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('th-TH-u-ca-buddhist', { month: 'short', year: '2-digit' });
    }
    case 'datetime': return formatDate(String(value), true);
    case 'status':
    case 'label': return labels?.[String(value)] ?? STATUS_TH[String(value)] ?? String(value);
    case 'boolean': return value ? 'ใช่' : 'ไม่ใช่';
    case 'list': return Array.isArray(value) ? value.join(', ') || '—' : String(value);
    default: return String(value);
  }
}

/** Default values for a fresh form. */
export function initialValues(fields: Field[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.default !== undefined) out[f.name] = f.default;
    else if (f.type === 'boolean') out[f.name] = false;
    else if (f.type === 'multilookup' || f.type === 'permissions') out[f.name] = [];
  }
  return out;
}

/**
 * Turn raw form state into an API body: numbers parsed, empty strings dropped,
 * lookup display fields kept (they are the snapshot the backend stores).
 */
export function toBody(fields: Field[], values: Record<string, unknown>, lines?: LinesSpec, lineValues?: Record<string, unknown>[]): Record<string, unknown> {
  const clean = (fs: Field[], v: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    for (const [k, raw] of Object.entries(v)) {
      const f = fs.find((x) => x.name === k);
      if (k.startsWith('__')) continue;
      if (raw === '' || raw === undefined || raw === null) continue;
      out[k] = f?.type === 'number' ? Number(raw) : raw;
    }
    return out;
  };
  const body = clean(fields, values);
  if (lines) body[lines.name] = (lineValues ?? []).map((l) => clean(lines.fields, l)).filter((l) => Object.keys(l).length > 0);
  return body;
}

/** Client-side required check; the server validates again. Returns field -> message. */
export function missingRequired(fields: Field[], values: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (!f.required) continue;
    const v = values[f.name];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) errors[f.name] = `กรอก${f.label}`;
  }
  return errors;
}

/** All endpoints a module UI calls, for contract tests: [module, method, path template]. */
export function endpointsOf(ui: ModuleUi): { module: string; method: string; path: string; where: string }[] {
  const out: { module: string; method: string; path: string; where: string }[] = [];
  const lookups = (fs: Field[] | undefined, where: string) => {
    for (const f of fs ?? []) if (f.lookup) out.push({ module: f.lookup.module ?? ui.module, method: 'GET', path: f.lookup.path, where: `${where}.${f.name}` });
  };
  const action = (a: Action, where: string) => {
    out.push({ module: ui.module, method: a.method, path: a.endpoint, where: `${where}.${a.id}` });
    lookups(a.fields, `${where}.${a.id}`);
    lookups(a.lines?.fields, `${where}.${a.id}.lines`);
  };
  for (const w of ui.widgets ?? []) out.push({ module: ui.module, method: 'GET', path: w.endpoint, where: `${ui.module}.widget.${w.id}` });
  if (ui.notifications) {
    out.push({ module: ui.module, method: 'GET', path: ui.notifications.endpoint, where: `${ui.module}.notifications` });
    out.push({ module: ui.module, method: 'POST', path: ui.notifications.readEndpoint, where: `${ui.module}.notifications.read` });
    out.push({ module: ui.module, method: 'POST', path: ui.notifications.readAllEndpoint, where: `${ui.module}.notifications.readAll` });
  }
  for (const sr of ui.search ?? []) out.push({ module: ui.module, method: 'GET', path: sr.endpoint, where: `${ui.module}.search.${sr.id}` });
  for (const c of ui.commands ?? []) if (c.arg) out.push({ module: c.arg.lookup.module ?? ui.module, method: 'GET', path: c.arg.lookup.path, where: `${ui.module}.command.${c.id}` });
  for (const [id, s] of Object.entries(ui.screens)) {
    const where = `${ui.module}.${id}`;
    if (s.kind === 'list') {
      out.push({ module: ui.module, method: 'GET', path: s.endpoint, where });
      if (s.import) out.push({ module: ui.module, method: 'POST', path: s.import.endpoint, where: `${where}.import` });
      lookups(s.filters, where);
      s.actions?.forEach((a) => action(a, where));
      s.rowActions?.forEach((a) => action(a, `${where}.row`));
    } else if (s.kind === 'form') {
      out.push({ module: ui.module, method: s.method, path: s.endpoint, where });
      if (s.load) out.push({ module: ui.module, method: 'GET', path: s.load, where: `${where}.load` });
      lookups(s.fields, where);
      lookups(s.lines?.fields, `${where}.lines`);
    } else {
      out.push({ module: ui.module, method: 'GET', path: s.endpoint, where });
      s.actions?.forEach((a) => action(a, where));
    }
  }
  return out;
}

/** Screens referenced from menus, links and actions must exist; import columns must be unambiguous. */
export function brokenLinks(ui: ModuleUi): string[] {
  const problems: string[] = [];
  for (const [id, s] of Object.entries(ui.screens)) {
    if (s.kind !== 'list' || !s.import) continue;
    if (!s.import.columns.length) problems.push(`${ui.module}: ${id}.import has no columns`);
    const keys = new Set<string>();
    const names = new Map<string, string>();
    for (const col of s.import.columns) {
      if (keys.has(col.key)) problems.push(`${ui.module}: ${id}.import column "${col.key}" is declared twice`);
      keys.add(col.key);
      for (const n of [headerKey(col.key), headerKey(col.label)]) {
        const prev = names.get(n);
        if (prev !== undefined && prev !== col.key) problems.push(`${ui.module}: ${id}.import header "${n}" matches both "${prev}" and "${col.key}"`);
        names.set(n, col.key);
      }
    }
  }
  return [...problems, ...brokenScreenLinks(ui)];
}

function brokenScreenLinks(ui: ModuleUi): string[] {
  const ids = new Set(Object.keys(ui.screens));
  const refs: [string, string][] = ui.menu.map((m) => [m.screen, `menu "${m.label}"`]);
  for (const [id, s] of Object.entries(ui.screens)) {
    if (s.kind === 'list') {
      if (s.create) refs.push([s.create, `${id}.create`]);
      if (s.rowLink) refs.push([s.rowLink.screen, `${id}.rowLink`]);
      [...(s.actions ?? []), ...(s.rowActions ?? [])].forEach((a) => a.then && refs.push([a.then.screen, `${id}.${a.id}.then`]));
    }
    if (s.kind === 'form' && s.after) refs.push([s.after.screen, `${id}.after`]);
    if (s.kind === 'detail') {
      if (s.edit) refs.push([s.edit, `${id}.edit`]);
      s.actions?.forEach((a) => a.then && refs.push([a.then.screen, `${id}.${a.id}.then`]));
    }
  }
  for (const sr of ui.search ?? []) refs.push([sr.screen, `search.${sr.id}`]);
  for (const c of ui.commands ?? []) refs.push([c.screen, `command.${c.id}`]);
  for (const w of ui.widgets ?? []) {
    if (w.href) refs.push([w.href, `widget.${w.id}.href`]);
    if ((w.kind === 'pipeline' || w.kind === 'floor3d') && w.link) refs.push([w.link.screen, `widget.${w.id}.link`]);
  }
  return refs.filter(([screen]) => !ids.has(screen)).map(([screen, where]) => `${ui.module}: ${where} points to unknown screen "${screen}"`);
}

/* ---------------- CSV export / import (pure; used by web lists and the import dialog) ---------------- */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "2026-10-02" -> "02/10/2569"; ISO timestamps use local time (+ " 14:05" with time). Plain text, as Thai Excel users read it. */
export function csvDate(value: string, withTime = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return `${m[3]}/${m[2]}/${Number(m[1]) + 543}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const date = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear() + 543}`;
  return withTime ? `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : date;
}

const NUMERIC_FORMATS: Format[] = ['money', 'qty', 'percent'];

/** One cell's text for a CSV export: numbers stay plain (no grouping) so Excel can sum them; codes get their Thai label. */
export function csvValue(value: unknown, format: Format = 'text', labels?: Record<string, string>): string {
  if (value === null || value === undefined || value === '') return '';
  switch (format) {
    case 'money':
    case 'qty':
    case 'percent': {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return format === 'money' ? n.toFixed(2) : String(n);
    }
    case 'date': return csvDate(String(value));
    case 'datetime': return csvDate(String(value), true);
    case 'month': {
      const m = /^(\d{4})-(\d{2})/.exec(String(value));
      return m ? `${m[2]}/${Number(m[1]) + 543}` : String(value);
    }
    case 'status':
    case 'label':
    case 'boolean':
    case 'list': return formatValue(value, format, labels);
    default: return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

/**
 * Quote a cell for CSV. Text that a spreadsheet would run as a formula (=, +, -, @) gets a leading
 * apostrophe so an exported list can never execute anything when opened.
 */
export function csvCell(text: string, numeric = false): string {
  let t = text;
  if (!numeric && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\r\n;]/.test(t) || /^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** A whole CSV file for Thai Excel: UTF-8 BOM, the screen's column labels as headers, CRLF line ends. */
export function toCsv(columns: Column[], rows: unknown[], labels?: Record<string, string>): string {
  const lines = [columns.map((c) => csvCell(c.label)).join(',')];
  for (const r of rows) {
    lines.push(columns.map((c) => csvCell(csvValue(get(r, c.key), c.format, labels), NUMERIC_FORMATS.includes(c.format ?? 'text'))).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** The empty template for an import: just the header row (labels), BOM included. */
export function csvTemplate(spec: ImportSpec): string {
  return `﻿${spec.columns.map((c) => csvCell(c.label)).join(',')}\r\n`;
}

function detectDelimiter(text: string): string {
  const first = text.slice(0, text.search(/\r|\n/) === -1 ? undefined : text.search(/\r|\n/));
  const unquoted = first.replace(/"[^"]*"/g, '');
  const counts = [',', ';', '\t'].map((d) => [d, unquoted.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ',';
}

/**
 * Parse CSV text (RFC 4180: quoted cells, "" escapes, line breaks inside quotes, CRLF/LF, BOM).
 * The delimiter (comma, semicolon or tab) is detected from the header line. Every record is returned —
 * blank ones included — so record i is spreadsheet row i + 1.
 */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (!text) return [];
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Normalised header text: case, spaces and a trailing "*" (required marker) don't matter. */
export function headerKey(text: string): string {
  return text.replace(/^﻿/, '').replace(/\*\s*$/, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Map parsed CSV records to request rows using the import columns (header matched by label or key).
 * Blank records are skipped; `lines[i]` is the spreadsheet row of `rows[i]` (header = row 1).
 * Empty cells are left out so the server applies its defaults.
 */
export function mapImportRows(columns: ImportColumn[], table: string[][]): {
  rows: Record<string, string>[]; lines: number[]; missing: ImportColumn[]; ignored: string[];
} {
  const [header = [], ...body] = table;
  const byName = new Map<string, string>();
  for (const c of columns) { byName.set(headerKey(c.label), c.key); byName.set(headerKey(c.key), c.key); }
  const keys = header.map((h) => byName.get(headerKey(h)));
  const found = new Set(keys.filter(Boolean));
  const rows: Record<string, string>[] = [];
  const lines: number[] = [];
  body.forEach((rec, i) => {
    if (!rec.some((v) => v.trim() !== '')) return;
    const out: Record<string, string> = {};
    rec.forEach((v, ci) => {
      const key = keys[ci];
      const val = v.trim();
      if (key && val !== '' && out[key] === undefined) out[key] = val;
    });
    rows.push(out);
    lines.push(i + 2);
  });
  return {
    rows,
    lines,
    missing: columns.filter((c) => c.required && !found.has(c.key)),
    ignored: header.filter((h, i) => h.trim() !== '' && !keys[i]),
  };
}

/** Client-side text search over loaded rows (mobile lists): every word must appear in some column, raw or formatted. */
export function filterRows<T>(rows: T[], columns: Column[], text: string, labels?: Record<string, string>): T[] {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => {
    const hay = columns.map((c) => {
      const v = get(r, c.key);
      return v === null || v === undefined ? '' : `${String(v)} ${formatValue(v, c.format, labels)}`;
    }).join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** List filters -> query string for the URL (empty values dropped, keys sorted so equal filters give equal URLs). */
export function filtersToQuery(values: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const k of Object.keys(values).sort()) {
    const v = values[k];
    if (v !== undefined && v !== null && v !== '' && v !== false) qs.set(k, String(v));
  }
  return qs.toString();
}
