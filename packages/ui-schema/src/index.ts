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
  empty?: string;
}

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
  search?: SearchSpec[];
  commands?: CommandSpec[];
}

/** Icon names the apps know how to draw (lucide names). */
export const ICONS = ['users', 'database', 'boxes', 'shopping-cart', 'receipt', 'factory', 'wrench', 'calculator', 'zap', 'bot', 'gauge'] as const;
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
  planned: 'วางแผน', released: 'ปล่อยงาน', completed: 'ผลิตเสร็จ',
  open: 'รอดำเนินการ', in_progress: 'กำลังซ่อม', done: 'เสร็จแล้ว',
  running: 'เดินเครื่อง', down: 'เครื่องเสีย', retired: 'เลิกใช้',
  receive: 'รับเข้า', issue: 'จ่ายออก', transfer_in: 'โอนเข้า', transfer_out: 'โอนออก', adjust: 'ปรับปรุง',
  breakdown: 'แจ้งเสีย', pm: 'PM', purchase: 'จากการซื้อ', manual: 'กำหนดเอง',
  raw: 'วัตถุดิบ', semi: 'กึ่งสำเร็จรูป', finished: 'สินค้าสำเร็จรูป', spare: 'อะไหล่', service: 'บริการ',
  customer: 'ลูกค้า', supplier: 'ผู้ขาย', both: 'ลูกค้าและผู้ขาย',
  failed: 'ล้มเหลว', skipped: 'ข้าม',
  inventory: 'คลังสินค้า', purchasing: 'จัดซื้อ', sales: 'ขาย', production: 'ผลิต', maintenance: 'ซ่อมบำรุง',
  info: 'ข้อมูล', warn: 'เตือน', stop: 'ด่วน', ok: 'สำเร็จ',
};

export type Tone = 'neutral' | 'progress' | 'ok' | 'warn' | 'stop';

export function statusTone(status: string): Tone {
  if (['received', 'delivered', 'invoiced', 'completed', 'done', 'running', 'ok'].includes(status)) return 'ok';
  if (['approved', 'confirmed', 'released', 'in_progress'].includes(status)) return 'progress';
  if (['partially_received', 'warn', 'skipped'].includes(status)) return 'warn';
  if (['cancelled', 'down', 'retired', 'failed', 'stop'].includes(status)) return 'stop';
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

export function formatValue(value: unknown, format: Format = 'text'): string {
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
    case 'label': return STATUS_TH[String(value)] ?? String(value);
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

/** Screens referenced from menus, links and actions must exist. */
export function brokenLinks(ui: ModuleUi): string[] {
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
