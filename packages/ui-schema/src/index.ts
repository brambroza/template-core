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
export type Format = 'text' | 'money' | 'qty' | 'date' | 'datetime' | 'status' | 'label' | 'boolean' | 'list' | 'qr' | 'percent';

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
  then?: { screen: string; idFrom: string };
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

export interface DetailScreen extends ScreenBase {
  kind: 'detail';
  endpoint: string;
  /** record path used as heading, e.g. "no" */
  heading: string;
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

export interface ModuleUi {
  module: string;
  label: string;
  /** a short glyph for the menu (one or two characters) */
  glyph: string;
  menu: MenuItem[];
  screens: Record<string, Screen>;
}

export function defineUi(ui: ModuleUi): ModuleUi {
  return ui;
}

/* ---------------- helpers shared by web and mobile ---------------- */

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

/** A screen opened as /m/<module>/<screen>/<id> binds `id` to the first `:param` of its endpoint. */
export function routeParams(template: string, id?: string): Record<string, string> {
  if (!id) return {};
  const first = template.match(/:([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
  return first ? { [first]: id, id } : { id };
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
};

export type Tone = 'neutral' | 'progress' | 'ok' | 'warn' | 'stop';

export function statusTone(status: string): Tone {
  if (['received', 'delivered', 'invoiced', 'completed', 'done', 'running'].includes(status)) return 'ok';
  if (['approved', 'confirmed', 'released', 'in_progress'].includes(status)) return 'progress';
  if (['partially_received'].includes(status)) return 'warn';
  if (['cancelled', 'down', 'retired'].includes(status)) return 'stop';
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
  return refs.filter(([screen]) => !ids.has(screen)).map(([screen, where]) => `${ui.module}: ${where} points to unknown screen "${screen}"`);
}
