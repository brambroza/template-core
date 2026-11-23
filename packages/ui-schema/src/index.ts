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

/** `image`: a picture kept as a data URL in a text field (company logo) — web shows preview + file picker; mobile leaves it to the web. */
export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'month' | 'select' | 'boolean' | 'lookup' | 'multilookup' | 'permissions' | 'password' | 'email' | 'image';

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

/**
 * status = coloured state badge; label = Thai name of a code (item type, partner kind…) without a badge;
 * accounting = money as accountants print it: negatives in parentheses "(1,250.00)", zero as "–".
 */
export type Format = 'text' | 'money' | 'accounting' | 'qty' | 'date' | 'datetime' | 'month' | 'status' | 'label' | 'boolean' | 'list' | 'qr' | 'percent';

export interface Column {
  /** dotted path into the record: "customer.name" */
  key: string;
  label: string;
  format?: Format;
  /** list / detail lines: add a footer row with the sum of this column (report heading/subtotal/total rows are not counted) */
  total?: boolean;
  /** report lists: indent this column by the row's level (`ReportSpec.levels` / `indentFrom`) — the account name of a statement */
  indent?: boolean;
  /** lists / detail lines: leave the cell blank when it repeats the row above (the account code on ledger lines) */
  hideRepeats?: boolean;
  /** detail facts: start a titled group here ("รายได้", "รายการหัก", "ผู้รับผิดชอบ"); the group runs until the next `section` */
  section?: string;
  /** detail facts: the figure the document is about (net pay, total) — shown larger, on screen and paper */
  emphasis?: boolean;
  /** detail facts: hide the fact when its value is 0 (optional amounts such as OT hours or a bonus) */
  hideZero?: boolean;
  /** `false`: leave this column out on phone-width screens (web) — secondary columns of a report that stays a table */
  phone?: boolean;
  /**
   * printed documents (detail facts and line columns): `false` = screen only, never on paper (status, owner, internal notes,
   * receiving progress). Facts with `format: 'status'` are screen only by default; `print: true` prints them anyway.
   */
  print?: boolean;
}

/**
 * A list screen that is a financial report (trial balance, P&L, ledger, tax register). Rows keep their order;
 * a row field (default `kind`) says what the row is and how it is drawn. Printing gives the company letterhead,
 * the title and the `subtitle` (period). Web only — mobile shows the plain list.
 */
export interface ReportSpec {
  /** period line under the title, e.g. "ณ วันที่ {asOf|date}" — `{path}` reads the response object; `|date`, `|month`, `|year` (พ.ศ.), `|money` format it */
  subtitle?: string;
  /** row field naming the row's role, default "kind" */
  rowKind?: string;
  /** row kinds drawn as section titles: bold, amount cells left empty */
  heading?: string[];
  /** row kinds drawn as subtotals: bold with a rule above */
  subtotal?: string[];
  /** row kinds drawn as totals / results: bold, rule above and a double rule below */
  total?: string[];
  /** row kinds drawn quietly (opening / closing balance lines) */
  muted?: string[];
  /** indentation level per row kind, e.g. { account: 1 } */
  levels?: Record<string, number>;
  /** or: a numeric row field holding the level (account hierarchy) */
  indentFrom?: string;
  /** a check shown with the report, e.g. the trial balance balances: boolean at a response path */
  check?: { path: string; ok: string; fail: string };
  /** label of the footer row of `total` columns, default "รวม" */
  totalLabel?: string;
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
  /**
   * "ผลกระทบเมื่อกดยืนยัน": the dialog previews what the action would do across the installed modules (stock, cost, accounting, QC…)
   * before it is saved. The endpoint must opt in to dry runs (`config: { dryRun: true }`, kernel impact.ts).
   */
  impact?: boolean;
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
  rowLink?: RowLink;
  /** buttons on the list itself (e.g. "generate PM work orders") */
  actions?: Action[];
  /** buttons on each row; endpoint params are filled from the row */
  rowActions?: Action[];
  /** bulk import from a CSV file (web): dry-run preview, then the real import — see ImportSpec */
  import?: ImportSpec;
  /** draw the list as a financial report (row styles, indentation, totals, period title, letterhead on paper) */
  report?: ReportSpec;
  /** web: offer a Kanban board beside the table (ตาราง / Kanban switch), one lane per value of a status field */
  kanban?: KanbanSpec;
  empty?: string;
}

/**
 * A Kanban board for a list: the same rows as the table, grouped into lanes by `field` (e.g. a sales pipeline by stage).
 * Cards open the list's `rowLink`. Rows whose value has no lane are left out of the board (they still show in the table).
 */
export interface KanbanSpec {
  /** the row field that picks the lane, e.g. "stage" */
  field: string;
  /** lanes left to right; `closed` lanes (won / lost) are drawn quieter */
  lanes: { value: string; label: string; closed?: boolean }[];
  /** card title and the line under it */
  title: string;
  subtitle?: string;
  /** the card's headline number, also summed per lane (e.g. opportunity value) */
  amount?: Column;
  /** small facts at the bottom of the card */
  meta?: Column[];
  /** a person's name shown as initials on the card (e.g. owner_name) */
  person?: string;
}

/**
 * CSV bulk import on a list screen. `endpoint` is a POST route of this module that accepts
 * `{ rows: Record<string, unknown>[], dryRun?: boolean }` (values arrive as text from the file) and answers
 * an ImportResult. File headers are matched to `columns` by label or by key (case-insensitive, a trailing "*" ignored).
 */
/**
 * Where a row opens. `byField` sends some rows elsewhere by a value in the row, e.g. invoices `{ field: 'kind', screens: { opening:
 * 'openingInvoice' } }` — a carried-over receivable is not a tax invoice and must not open (or print) as one.
 */
export interface RowLink {
  screen: string;
  idFrom?: string;
  byField?: { field: string; screens: Record<string, string> };
}

/** The screen a row opens (see RowLink.byField). */
export function rowLinkScreen(link: RowLink, row: Record<string, unknown>): string {
  const v = link.byField ? row[link.byField.field] : undefined;
  return (typeof v === 'string' && link.byField?.screens[v]) || link.screen;
}

export interface ImportSpec {
  endpoint: string;
  perm?: string;
  columns: ImportColumn[];
  /** what the import does with existing records, shown in the dialog (default: existing codes are updated, new ones added) */
  note?: string;
  /** file name of the downloadable empty template (header row only), e.g. "items-template.csv" (handed out as .xlsx) */
  template?: string;
  /**
   * Codes the importing module does not own, turned into ids by the module that does before the dry run: the app POSTs
   * `{ codes }` (the distinct values of `column`) to `module` `endpoint`, which answers `[{ code, …fields }]`; each row then gets
   * `row[target] = match[source]` for every pair in `into`. Unknown codes are left empty for the importing module to report.
   * E.g. opening stock (inventory) resolves item codes through master-data.
   */
  resolve?: { module: string; endpoint: string; column: string; into: Record<string, string> };
}

/** Rows after `ImportSpec.resolve`: `answer` is what the owning module returned for the distinct codes. */
export function applyResolved(rows: Record<string, string>[], resolve: NonNullable<ImportSpec['resolve']>, answer: Record<string, unknown>[]): Record<string, string>[] {
  const byCode = new Map(answer.map((r) => [String(r.code ?? '').trim().toLowerCase(), r]));
  return rows.map((row) => {
    const hit = byCode.get(String(row[resolve.column] ?? '').trim().toLowerCase());
    if (!hit) return row;
    const out = { ...row };
    for (const [target, source] of Object.entries(resolve.into)) if (hit[source] != null) out[target] = String(hit[source]);
    return out;
  });
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
  /**
   * Optional AI button ("สแกนใบเสร็จ"): the web reads a photo/PDF with the customer's own Claude key and fills the
   * empty fields and lines; the user reviews and presses save. Ignored when AI is not configured. See docs/ai.md.
   */
  aiFill?: AiFillSpec;
}

/** `receipt` = Thai receipt / tax invoice (amount before VAT + VAT); `document` = any other paper the form describes. */
export interface AiFillSpec {
  kind: 'receipt' | 'document';
  /** button text, e.g. "สแกนใบเสร็จ" */
  label: string;
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
  /** `half: true` sections sit side by side in pairs on wide screens and paper (earnings | deductions on a payslip) */
  lines?: { path: string; label: string; columns: Column[]; half?: boolean; /** `false`: screen only (payments received on an invoice) */ print?: boolean }[];
  actions?: Action[];
  edit?: string;
  /** shorthand for `print: {}` — printable with the default layout */
  printable?: boolean;
  /** printed document layout (letterhead, title, copy label, signature boxes); see `printSpec` */
  print?: PrintOptions;
  /**
   * Files attached to this record (receipts, certificates, photos…), stored by the module's kernel `/_attachments` routes.
   * `entity` must be one the module's ServiceDefinition `attachments.entities` declares; the record id = the screen's id.
   * `perm` hides the panel from users without it (the server checks the module's own attachment perms either way).
   */
  attachments?: AttachmentsPanel;
}

export interface AttachmentsPanel {
  entity: string;
  perm?: string;
  /** panel heading, default "ไฟล์แนบ" */
  label?: string;
}

/**
 * How a detail screen prints as a real company document. Every printed document gets the company letterhead
 * (identity `GET /company`), the title, the record's facts and lines, signature boxes and a page footer.
 */
export type SignatureSpec = string | { label: string; name?: string };

export interface PrintOptions {
  /** document title on paper, e.g. "ใบกำกับภาษี / ใบเสร็จรับเงิน"; default = the screen title */
  title?: string;
  /**
   * signature boxes, e.g. ["ผู้จัดทำ", "ผู้อนุมัติ"]; `{ label, name }` also prints the person's name read from the
   * record path `name` under the line. Default = the company's default labels.
   */
  signatures?: SignatureSpec[];
  /** one more box per row of a record array, e.g. the approvers of a request: `{ path: 'steps', label: 'ผู้อนุมัติ', name: 'approver_name' }` */
  signers?: { path: string; label: string; name?: string };
  /** offer "ต้นฉบับ" / "สำเนา" and print the chosen label on the document */
  copyLabel?: boolean;
  /** legal form: 'tax-invoice' / 'receipt' print the buyer block and require the seller's tax ID */
  legal?: 'tax-invoice' | 'receipt' | 'none';
  /**
   * the company's document note (identity "หมายเหตุท้ายเอกสาร", usually payment terms such as "ชำระภายใน 30 วัน…"):
   * `'payment'` = print it as the payment-terms block (invoices, quotations), `true` = print it as a plain note,
   * `false` = never. Default: `'payment'` on `legal: 'tax-invoice'`, otherwise not printed — POs, receipts, claims,
   * payslips, 50 ทวิ, QC/NCR and approvals never carry "please pay within 30 days".
   */
  footer?: boolean | 'payment';
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

/**
 * One kind of decision waiting on the signed-in user, read from one of this module's list screens (its endpoint, `rowLink`,
 * and — unless `actions` is given — its `rowActions`). Home shows the most pressing items of every installed module together,
 * with the buttons to decide right there. A group shows only to users holding `perm` (default: the perm of the first action).
 */
export interface TodoSpec {
  id: string;
  /** group label shown on each item, e.g. "ใบสั่งซื้อรออนุมัติ" */
  label: string;
  /** a list screen of this module */
  screen: string;
  /** extra query for the screen's endpoint, e.g. { status: 'draft' } */
  query?: Record<string, string>;
  perm?: string;
  /** row fields: headline, the line under it (several fields joined by " · "), an amount */
  title: string;
  subtitle?: string | string[];
  amount?: string;
  /** when it started waiting (date/datetime field) → "รอ 3 วัน" */
  since?: string;
  /** deadline (date/datetime field) → "เกินกำหนด 2 วัน" / "ครบกำหนดวันนี้", and overdue items go first */
  due?: string;
  /** rows matching this are marked urgent (red) and sorted first */
  urgent?: Condition;
  /** quick buttons (default: the screen's rowActions); `when` and `perm` still apply per row */
  actions?: Action[];
}

/** The todo groups this user may act on: holds the group perm (default: the first button's perm) and may open the list screen. */
export function todoSources(modules: ModuleUi[], perms: string[]): { module: ModuleUi; spec: TodoSpec; screen: ListScreen }[] {
  return modules.flatMap((m) => (m.todo ?? []).flatMap((spec) => {
    const screen = m.screens[spec.screen];
    if (!screen || screen.kind !== 'list') return [];
    const gate = spec.perm ?? (spec.actions ?? screen.rowActions)?.[0]?.perm;
    return hasPerm(perms, gate) && hasPerm(perms, screen.perm) ? [{ module: m, spec, screen }] : [];
  }));
}

/** The buttons of one todo item this user may press now (`perm` and `when` per row). */
export function todoActions(item: TodoItem, screen: ListScreen, perms: string[]): Action[] {
  return (item.spec.actions ?? screen.rowActions ?? []).filter((a) => hasPerm(perms, a.perm) && matches(item.row, a.when));
}

/** One decision on the home page. */
export interface TodoItem {
  key: string;
  module: string;
  spec: TodoSpec;
  row: Record<string, unknown>;
  title: string;
  subtitle: string;
  amount?: number;
  /** "รอ 3 วัน" */
  waiting?: string;
  /** "เกินกำหนด 2 วัน" / "ครบกำหนดวันนี้" / "อีก 3 วัน" */
  dueText?: string;
  overdue: boolean;
  urgent: boolean;
  sinceMs: number;
}

const DAY_MS = 86_400_000;
/** Bangkok calendar day number of an ISO date/datetime (dates without time are taken as Bangkok dates). */
function bangkokDay(v: string): number {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00+07:00`) : Date.parse(v);
  return Math.floor((ms + 7 * 3_600_000) / DAY_MS);
}

/** "รอ 3 วัน" / "รอ 5 ชม." / "รอ 20 นาที" / "เพิ่งส่ง" since an ISO date or datetime. */
export function waitingText(since: string, now: Date = new Date()): string | undefined {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(since) ? Date.parse(`${since}T00:00:00+07:00`) : Date.parse(since);
  if (Number.isNaN(t)) return undefined;
  const min = Math.floor((now.getTime() - t) / 60_000);
  if (min < 5) return 'เพิ่งส่ง';
  if (min < 60) return `รอ ${min} นาที`;
  if (min < 24 * 60) return `รอ ${Math.floor(min / 60)} ชม.`;
  return `รอ ${Math.floor(min / (24 * 60))} วัน`;
}

/** Deadline in Bangkok days: "เกินกำหนด 2 วัน" (overdue), "ครบกำหนดวันนี้", "พรุ่งนี้", "อีก 3 วัน". */
export function dueText(due: string, now: Date = new Date()): { text: string; overdue: boolean } | undefined {
  if (Number.isNaN(Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due}T00:00:00+07:00` : due))) return undefined;
  const diff = bangkokDay(due) - bangkokDay(now.toISOString());
  if (diff < 0) return { text: `เกินกำหนด ${-diff} วัน`, overdue: true };
  if (diff === 0) return { text: 'ครบกำหนดวันนี้', overdue: false };
  if (diff === 1) return { text: 'ครบกำหนดพรุ่งนี้', overdue: false };
  return { text: `อีก ${diff} วัน`, overdue: false };
}

/**
 * Rows of every todo group → one list, most pressing first: overdue, then urgent, then due today, then the longest waiting.
 * The same record listed by two groups (e.g. HR's leave queue and my team's) shows once.
 */
export function buildTodo(groups: { module: string; spec: TodoSpec; rows: Record<string, unknown>[] }[], now: Date = new Date()): TodoItem[] {
  const seen = new Set<string>();
  const out: TodoItem[] = [];
  for (const { module, spec, rows } of groups) {
    for (const row of rows) {
      const id = String(row.id ?? '');
      const key = `${module}:${id || JSON.stringify(row).slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sub = (Array.isArray(spec.subtitle) ? spec.subtitle : spec.subtitle ? [spec.subtitle] : [])
        .map((f) => get(row, f)).filter((v) => v !== null && v !== undefined && v !== '').join(' · ');
      const since = spec.since ? get(row, spec.since) : undefined;
      const due = spec.due ? get(row, spec.due) : undefined;
      const d = typeof due === 'string' && due ? dueText(due, now) : undefined;
      const amount = spec.amount !== undefined ? Number(get(row, spec.amount)) : NaN;
      out.push({
        key, module, spec, row,
        title: String(get(row, spec.title) ?? ''),
        subtitle: sub,
        amount: Number.isFinite(amount) && amount !== 0 ? amount : undefined,
        waiting: typeof since === 'string' && since ? waitingText(since, now) : undefined,
        dueText: d?.text,
        overdue: !!d?.overdue,
        urgent: !!spec.urgent && matches(row, spec.urgent),
        sinceMs: typeof since === 'string' && since ? Date.parse(since) || Infinity : Infinity,
      });
    }
  }
  const rank = (i: TodoItem) => (i.overdue ? 0 : i.urgent ? 1 : i.dueText === 'ครบกำหนดวันนี้' ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b) || a.sinceMs - b.sinceMs);
}

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
  /** work that waits on the signed-in user (approve, accept a repair…), shown first on the home page as "ต้องตัดสินใจวันนี้" */
  todo?: TodoSpec[];
  notifications?: NotificationsSpec;
  /** this module's wording for shared status/label codes, e.g. { in_progress: 'กำลังซ่อม' } */
  statusLabels?: Record<string, string>;
  search?: SearchSpec[];
  commands?: CommandSpec[];
  /** where the module sits in the menu and on the home dashboard; defaults per module id (see moduleArea) */
  area?: AreaId;
}

/* ---------------- areas: how 18+ modules are grouped in the menu and on the home dashboard ---------------- */

export type AreaId = 'operations' | 'commercial' | 'finance' | 'office' | 'service' | 'settings';

/** Business areas in display order. */
export const AREAS: readonly { id: AreaId; label: string }[] = [
  { id: 'operations', label: 'การผลิต & คลัง' },
  { id: 'commercial', label: 'ขาย & ลูกค้า' },
  { id: 'finance', label: 'บัญชี & การเงิน' },
  { id: 'office', label: 'สำนักงาน & บุคคล' },
  { id: 'service', label: 'บริการ & โครงการ' },
  { id: 'settings', label: 'ตั้งค่า' },
];

const MODULE_AREA: Record<string, AreaId> = {
  inventory: 'operations', purchasing: 'operations', production: 'operations', quality: 'operations', maintenance: 'operations', costing: 'operations',
  crm: 'commercial', sales: 'commercial',
  approvals: 'office', expense: 'office', hr: 'office', booking: 'office', assets: 'office',
  helpdesk: 'service', projects: 'service', contracts: 'service',
  accounting: 'finance', payroll: 'finance',
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
  'stamp', 'id-card', 'wallet', 'package', 'handshake', 'life-buoy', 'kanban', 'shield-check', 'calendar', 'book', 'banknote', 'file-signature'] as const;
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
 * The example shown in the ⌘K box ("พิมพ์ค้นหา หรือสั่งงาน เช่น “…”"): the first command the user can run, in module
 * order (preferring an example with an argument) — so an office that bought approvals/hr sees its own example, never a factory item. Null when none.
 */
export function commandExample(modules: Pick<ModuleUi, 'commands' | 'screens'>[], perms: string[]): string | null {
  const usable = modules.flatMap((m) => (m.commands ?? []).filter((x) => x.example && hasPerm(perms, x.perm) && hasPerm(perms, m.screens[x.screen]?.perm)));
  // a full sentence ("ลา ป่วย ไข้หวัด") teaches more than a bare keyword ("สลิป")
  return (usable.find((c) => c.example.trim().includes(' ')) ?? usable[0])?.example ?? null;
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
  // back-office permissions (`<module>.ops.<action>`) are never granted by a wildcard — same rule as the kernel
  if (perm.split('.')[1] === 'ops') return perms.includes(perm);
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

/** Thai wording of a status code for messages ("ร่าง", "อนุมัติแล้ว"); unknown codes come back unchanged. Server-safe. */
export function statusTh(status: string | null | undefined): string {
  const st = status ?? '';
  return STATUS_TH[st] ?? st;
}

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
    case 'accounting': return accounting(Number(value));
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
  for (const t of ui.todo ?? []) t.actions?.forEach((a) => action(a, `${ui.module}.todo.${t.id}`));
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
      if (s.attachments) {
        out.push({ module: ui.module, method: 'GET', path: '/_attachments', where: `${where}.attachments` });
        out.push({ module: ui.module, method: 'POST', path: '/_attachments', where: `${where}.attachments.upload` });
      }
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
  const todoProblems: string[] = [];
  for (const t of ui.todo ?? []) {
    const s = ui.screens[t.screen];
    if (!s) refs.push([t.screen, `todo.${t.id}`]);
    else if (s.kind !== 'list') todoProblems.push(`${ui.module}: todo.${t.id} must use a list screen, "${t.screen}" is a ${s.kind}`);
    else if (!(t.actions ?? s.rowActions)?.length && !s.rowLink) todoProblems.push(`${ui.module}: todo.${t.id} has no buttons and no rowLink`);
  }
  for (const [id, s] of Object.entries(ui.screens)) {
    if (s.kind === 'list') {
      if (s.create) refs.push([s.create, `${id}.create`]);
      if (s.rowLink) refs.push([s.rowLink.screen, `${id}.rowLink`]);
      for (const [v, target] of Object.entries(s.rowLink?.byField?.screens ?? {})) refs.push([target, `${id}.rowLink.byField.${v}`]);
      [...(s.actions ?? []), ...(s.rowActions ?? [])].forEach((a) => a.then && refs.push([a.then.screen, `${id}.${a.id}.then`]));
      if (s.kanban) {
        const values = s.kanban.lanes.map((l) => l.value);
        if (!values.length) todoProblems.push(`${ui.module}: ${id}.kanban has no lanes`);
        if (new Set(values).size !== values.length) todoProblems.push(`${ui.module}: ${id}.kanban has two lanes with the same value`);
      }
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
  return [...todoProblems, ...refs.filter(([screen]) => !ids.has(screen)).map(([screen, where]) => `${ui.module}: ${where} points to unknown screen "${screen}"`)];
}

/* ---------------- Kanban (pure; the web board draws what this returns) ---------------- */

export interface KanbanLane { value: string; label: string; closed: boolean; rows: Record<string, unknown>[]; total: number | null }

/**
 * Group list rows into the spec's lanes, keeping the list's row order inside each lane. `total` sums `amount`
 * (null without one; values that are not numbers count as 0).
 * @param spec the screen's kanban spec
 * @param rows the list rows
 */
export function kanbanLanes(spec: KanbanSpec, rows: Record<string, unknown>[]): KanbanLane[] {
  const lanes = spec.lanes.map((l) => ({ value: l.value, label: l.label, closed: !!l.closed, rows: [] as Record<string, unknown>[], total: spec.amount ? 0 : null as number | null }));
  const byValue = new Map(lanes.map((l) => [l.value, l]));
  for (const row of rows) {
    const lane = byValue.get(String(get(row, spec.field) ?? ''));
    if (!lane) continue;
    lane.rows.push(row);
    if (spec.amount && lane.total !== null) {
      const n = Number(get(row, spec.amount.key));
      lane.total += Number.isFinite(n) ? n : 0;
    }
  }
  return lanes;
}

/**
 * Initials for a card's person chip: "สมศักดิ์ ศรีสวัสดิ์" -> "สศ", "Jane Doe" -> "JD"; '' for no name.
 * Thai leading vowels (เ แ โ ใ ไ) are skipped so the chip shows the consonant.
 * @param name a person's display name
 */
export function initials(name: unknown): string {
  if (typeof name !== 'string') return '';
  const first = (w: string) => [...w.replace(/^[เแโใไ]+/, '')][0] ?? '';
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(first).join('').toUpperCase();
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

const NUMERIC_FORMATS: Format[] = ['money', 'accounting', 'qty', 'percent'];

/** One cell's text for a CSV export: numbers stay plain (no grouping) so Excel can sum them; codes get their Thai label. */
export function csvValue(value: unknown, format: Format = 'text', labels?: Record<string, string>): string {
  if (value === null || value === undefined || value === '') return '';
  switch (format) {
    case 'money':
    case 'accounting':
    case 'qty':
    case 'percent': {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      return format === 'money' || format === 'accounting' ? n.toFixed(2) : String(n);
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
  // a "numeric" column only skips the guard when the cell really is a number (security review 0.3, SEC-13)
  const isNumber = numeric && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(t);
  if (!isNumber && /^[=+\-@\t\r＝＋－＠]/.test(t)) t = `'${t}`;
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

/* ---------------- printed documents ---------------- */

export interface ResolvedPrint {
  title: string;
  /** static boxes; `name` is a record path */
  signatures: { label: string; name?: string }[];
  signers?: { path: string; label: string; name?: string };
  copyLabel: boolean;
  legal: 'tax-invoice' | 'receipt' | 'none';
  /** company note under the signatures: false = none, true = plain note, 'payment' = payment-terms block */
  footer: boolean | 'payment';
}

export const COPY_LABELS = ['ต้นฉบับ', 'สำเนา'] as const;
export type CopyLabel = (typeof COPY_LABELS)[number];

/** True when the screen prints (`print` set, or the older `printable: true`). */
export function isPrintable(screen: { kind: string; printable?: boolean; print?: PrintOptions }): boolean {
  return screen.kind === 'detail' && (!!screen.print || !!screen.printable);
}

/**
 * The print layout of a detail screen with every default filled in, or null when it does not print.
 * Signatures: the screen's own labels, else the company's default labels (`signature_labels`), else none.
 */
export function printSpec(screen: { kind: string; title: string; printable?: boolean; print?: PrintOptions }, companySignatures: string[] = []): ResolvedPrint | null {
  if (!isPrintable(screen)) return null;
  const p = screen.print ?? {};
  const boxes = (p.signatures ?? (p.signers ? [] : companySignatures))
    .map((x) => (typeof x === 'string' ? { label: x.trim() } : { ...x, label: x.label.trim() }))
    .filter((x) => x.label);
  return {
    title: p.title?.trim() || screen.title,
    signatures: boxes,
    ...(p.signers ? { signers: p.signers } : {}),
    copyLabel: !!p.copyLabel,
    legal: p.legal ?? 'none',
    footer: p.footer ?? (p.legal === 'tax-invoice' ? 'payment' : false),
  };
}

/**
 * Whether a detail fact / line column / line section goes on paper: `print: false` never does; a `format: 'status'`
 * badge does not unless `print: true` (a status changes after the paper leaves — "ร่าง", "ชำระครบ").
 */
export function printsOnPaper(f: { print?: boolean; format?: Format }): boolean {
  if (f.print === false) return false;
  if (f.format === 'status') return f.print === true;
  return true;
}

/** Thai juristic-person names: บริษัท…จำกัด, ห้างหุ้นส่วน…, บจก./บมจ./หจก. */
export function looksLikeCompany(name?: string | null): boolean {
  return /^\s*(บริษัท|ห้างหุ้นส่วน|บจก\.?|บมจ\.?|หจก\.?)/.test(name ?? '');
}

/** A 13-digit tax ID of a juristic person starts with 0 (a personal ID card number starts with 1–8). */
export function isJuristicTaxId(id?: string | null): boolean {
  const d = (id ?? '').replace(/[\s-]/g, '');
  return /^0\d{12}$/.test(d);
}

/**
 * What the buyer block of this document lacks, in Thai, for an on-screen warning (never printed).
 * A full tax invoice (§86/4) to a juristic person needs the buyer's tax ID and branch.
 */
export function buyerProblems(buyer: PartyInfo | null | undefined, legal: ResolvedPrint['legal']): string[] {
  if (legal !== 'tax-invoice' || !buyer) return [];
  const out: string[] = [];
  if (!buyer.taxId && looksLikeCompany(buyer.name)) out.push('ลูกค้าไม่มีเลขผู้เสียภาษี — ใบกำกับภาษีแบบเต็มต้องระบุ');
  if (buyer.taxId && isJuristicTaxId(buyer.taxId) && !buyer.branch) out.push('ลูกค้าไม่ได้ระบุสาขา — ใบกำกับภาษีจะพิมพ์ว่า "สำนักงานใหญ่" (แก้ที่ข้อมูลลูกค้าถ้าเป็นสาขาอื่น)');
  return out;
}

/** Branch wording printed in the buyer block: the record's branch, else "สำนักงานใหญ่" for a juristic tax ID, else none. */
export function buyerBranchText(buyer: PartyInfo): string {
  if (buyer.branch) return branchText(buyer.branch);
  return isJuristicTaxId(buyer.taxId) ? branchText('00000') : '';
}

/** The signature boxes of one record: static boxes with names filled in, then one box per `signers` row. */
export function signatureBoxes(spec: ResolvedPrint, record: unknown): { label: string; name?: string }[] {
  const text = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : String(v));
  const out = spec.signatures.map((b) => ({ label: b.label, name: b.name ? text(get(record, b.name)) : undefined }));
  if (spec.signers) {
    const rows = get(record, spec.signers.path);
    const list = Array.isArray(rows) ? rows : [];
    list.forEach((row, i) => out.push({
      label: list.length > 1 ? `${spec.signers!.label} ขั้นที่ ${i + 1}` : spec.signers!.label,
      name: spec.signers!.name ? text(get(row, spec.signers!.name)) : undefined,
    }));
  }
  return out;
}

/** Branch wording on Thai tax documents: "00000" -> "สำนักงานใหญ่", "00012" -> "สาขาที่ 00012"; other text as is. */
export function branchText(branch?: string | null): string {
  const b = (branch ?? '').trim();
  if (!b) return '';
  if (b === '00000') return 'สำนักงานใหญ่';
  return /^\d{5}$/.test(b) ? `สาขาที่ ${b}` : b;
}

/** "0105559123456" -> "0-1055-59123-45-6" (as printed on Thai documents); anything else unchanged. */
export function formatTaxId(id?: string | null): string {
  const d = (id ?? '').replace(/[\s-]/g, '');
  return /^\d{13}$/.test(d) ? `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}` : (id ?? '');
}

export interface PartyInfo {
  name?: string;
  address?: string;
  taxId?: string;
  branch?: string;
  /** record paths the info was read from (so the facts grid can skip them on paper) */
  keys: string[];
}

const PARTY_PATHS: Record<'name' | 'address' | 'taxId' | 'branch', string[]> = {
  name: ['customer.name', 'buyer.name', 'customer_name', 'customerName', 'buyer_name', 'partner_name'],
  address: ['customer.address', 'buyer.address', 'customer_address', 'customerAddress', 'buyer_address'],
  taxId: ['customer.taxId', 'customer.tax_id', 'buyer.taxId', 'buyer.tax_id', 'customer_tax_id', 'customerTaxId', 'buyer_tax_id'],
  branch: ['customer.branch', 'buyer.branch', 'customer_branch', 'customerBranch', 'buyer_branch'],
};

/** The buyer of a sales document (tax invoice / receipt), found under the usual record paths. Null when no name. */
export function buyerInfo(record: unknown): PartyInfo | null {
  const out: PartyInfo = { keys: [] };
  for (const [field, paths] of Object.entries(PARTY_PATHS) as [keyof typeof PARTY_PATHS, string[]][]) {
    for (const path of paths) {
      const v = get(record, path);
      if (v !== null && v !== undefined && String(v).trim() !== '') {
        out[field] = String(v);
        out.keys.push(path);
        break;
      }
    }
  }
  return out.name ? out : null;
}

/** The company profile fields a printed document uses (identity `GET /company`). */
export interface CompanyProfile {
  configured?: boolean;
  legal_name?: string;
  name_en?: string | null;
  branch_code?: string | null;
  branch_label?: string | null;
  /** branch wording to print: the typed label, else from the code */
  branch_text?: string | null;
  address?: string | null;
  tax_id?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logo?: string | null;
  footer_note?: string | null;
  signature_labels?: string[];
}

/**
 * What is missing from the company profile for this document, in Thai, for an on-screen warning (never printed).
 * Tax invoices need the seller's name, address and tax ID (Revenue Code §86/4).
 */
export function companyProblems(company: CompanyProfile | null | undefined, legal: ResolvedPrint['legal']): string[] {
  const out: string[] = [];
  if (!company || company.configured === false) out.push('ยังไม่ได้ตั้งค่าข้อมูลบริษัท — หัวกระดาษจะมีแค่ชื่อบริษัท');
  if (legal === 'tax-invoice') {
    if (!company?.tax_id) out.push('ข้อมูลบริษัทยังไม่มีเลขประจำตัวผู้เสียภาษี — ใบกำกับภาษีที่ไม่มีเลขนี้ใช้ไม่ได้ตามมาตรา 86/4');
    if (!company?.address) out.push('ข้อมูลบริษัทยังไม่มีที่อยู่ — ใบกำกับภาษีต้องมีที่อยู่ผู้ขาย');
  }
  return out;
}

/** Contact line under the letterhead: "โทร 02-… · อีเมล … · www…". */
export function companyContactLine(company: CompanyProfile | null | undefined): string {
  if (!company) return '';
  return [company.phone && `โทร ${company.phone}`, company.email && `อีเมล ${company.email}`, company.website].filter(Boolean).join(' · ');
}

/* ---------------- attachments & audit log (kernel routes every module has / can opt in to) ---------------- */

/** Largest file the kernel accepts (decoded). */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
/** What the file picker offers; the server re-checks extension AND content. */
export const ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.xlsx,.docx,.csv,.txt';

/** One row of `GET /_attachments?ref=` (the content is fetched separately). */
export interface AttachmentInfo {
  id: string;
  ref: string;
  file_name: string;
  content_type: string;
  size: number;
  uploaded_by: string;
  uploaded_by_name: string | null;
  created_at: string;
  can_delete: boolean;
}

/** `<entity>:<record id>` — how an attachment names the record it belongs to. */
export function attachmentRef(entity: string, id: string): string {
  return `${entity}:${id}`;
}

export type FileKind = 'image' | 'pdf' | 'sheet' | 'doc' | 'text' | 'file';

/** Icon family of a stored file; `image` = a browser can show a thumbnail (HEIC cannot). */
export function fileKind(contentType: string): FileKind {
  if (/^image\/(jpeg|png|webp)$/.test(contentType)) return 'image';
  if (contentType === 'application/pdf') return 'pdf';
  if (contentType.includes('spreadsheet') || contentType === 'text/csv') return 'sheet';
  if (contentType.includes('wordprocessing')) return 'doc';
  if (contentType.startsWith('text/')) return 'text';
  return 'file';
}

/** 1536000 -> "1.5 MB" */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
}

/** Permission prefix of a module ("master" for master-data) — kernel permissions use it, e.g. `master.audit.read`. */
export function permPrefix(module: string): string {
  return module.split('-')[0];
}

/** Permission that opens a module's audit log (`GET /_audit`); `*` and `<prefix>.*` include it. */
export function auditPerm(module: string): string {
  return `${permPrefix(module)}.audit.read`;
}

/** One row of `GET /_audit`. */
export interface AuditRow {
  id: string;
  at: string;
  user_id: string | null;
  user_name: string | null;
  method: string;
  route: string;
  entity_id: string | null;
  status: number;
  summary: unknown;
  /** "POST /claims/:id/approve" */
  action: string;
  /** short "field: value · …" text of the redacted body */
  summary_text: string;
}

const AUDIT_VERBS: Record<string, string> = {
  submit: 'ส่ง', approve: 'อนุมัติ', reject: 'ไม่อนุมัติ', return: 'ส่งกลับแก้ไข', cancel: 'ยกเลิก', pay: 'จ่าย', close: 'ปิด',
  receive: 'รับของ', start: 'เริ่ม', complete: 'เสร็จ', reopen: 'เปิดใหม่', assign: 'มอบหมาย', clear: 'เคลียร์', post: 'ลงบัญชี', void: 'ยกเลิก',
};

/** Thai wording of an audit row's action: "แนบไฟล์", "แก้ไข", "อนุมัติ" (last path word), else the method. */
export function auditActionLabel(row: { method: string; route: string }): string {
  if (row.route === '/_attachments') return 'แนบไฟล์';
  if (row.route.startsWith('/_attachments/')) return 'ลบไฟล์แนบ';
  const last = row.route.split('/').filter(Boolean).pop() ?? '';
  if (!last.startsWith(':') && AUDIT_VERBS[last]) return AUDIT_VERBS[last];
  return row.method === 'POST' ? (last.startsWith(':') ? 'บันทึก' : 'สร้าง') : row.method === 'DELETE' ? 'ลบ' : 'แก้ไข';
}


/* ---------------- reports: accounting numbers, row styles, totals, date ranges ---------------- */

/** Money as accountants print it: "1,250.00", "(1,250.00)" for a negative, "–" for zero (rounded to satang). */
export function accounting(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const r = Math.round(n * 100) / 100;
  if (r === 0) return '–';
  return r < 0 ? `(${money.format(-r)})` : money.format(r);
}

/** A number is negative in a report cell (drawn in red on screen, never on paper). */
export function isNegative(value: unknown, format?: Format): boolean {
  return (format === 'accounting' || format === 'money') && value !== null && value !== '' && Math.round(Number(value) * 100) < 0;
}

export type ReportRowStyle = 'heading' | 'subtotal' | 'total' | 'muted';

/** How a report row is drawn, from its kind field; null = an ordinary line. */
export function reportRowStyle(spec: ReportSpec | undefined, row: unknown): ReportRowStyle | null {
  if (!spec) return null;
  const kind = get(row, spec.rowKind ?? 'kind');
  if (kind === undefined || kind === null) return null;
  const k = String(kind);
  if (spec.heading?.includes(k)) return 'heading';
  if (spec.total?.includes(k)) return 'total';
  if (spec.subtotal?.includes(k)) return 'subtotal';
  if (spec.muted?.includes(k)) return 'muted';
  return null;
}

/** Indentation level of a report row (0 = flush): the numeric `indentFrom` field, else `levels[kind]`. */
export function reportIndent(spec: ReportSpec | undefined, row: unknown): number {
  if (!spec) return 0;
  if (spec.indentFrom) {
    const n = Number(get(row, spec.indentFrom));
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 6) : 0;
  }
  const kind = get(row, spec.rowKind ?? 'kind');
  return kind === undefined || kind === null ? 0 : spec.levels?.[String(kind)] ?? 0;
}

/**
 * Footer sums of the `total: true` columns. Only ordinary rows count — a statement's own subtotal and result rows
 * (and opening/closing lines) would count twice. Null when no column asks for a total. Rounded to satang.
 */
export function columnTotals(columns: Column[], rows: unknown[], spec?: ReportSpec): Record<string, number> | null {
  const keys = columns.filter((c) => c.total).map((c) => c.key);
  if (!keys.length) return null;
  const out: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of rows) {
    if (reportRowStyle(spec, r)) continue;
    for (const k of keys) {
      const v = Number(get(r, k));
      if (Number.isFinite(v)) out[k] += v;
    }
  }
  for (const k of keys) out[k] = Math.round(out[k] * 100) / 100;
  return out;
}

/** True when the cell repeats the same column of the row above (for `hideRepeats`). */
export function repeatsAbove(rows: unknown[], index: number, key: string): boolean {
  if (index === 0) return false;
  const v = get(rows[index], key);
  return v !== null && v !== undefined && v !== '' && v === get(rows[index - 1], key);
}

/**
 * Fill "ณ วันที่ {asOf|date}" from a response. Pipes: date (Thai, พ.ศ.), month ("ตุลาคม 2569"), year (ค.ศ. → พ.ศ.), money.
 * An empty or missing value leaves the whole template empty, so no half-filled title is shown.
 */
export function fillTemplate(template: string, data: unknown): string {
  let missing = false;
  const text = template.replace(/\{([\w.]+)(?:\|(\w+))?\}/g, (_, path: string, pipe?: string) => {
    const v = get(data, path);
    if (v === null || v === undefined || v === '') { missing = true; return ''; }
    if (pipe === 'date') return formatDate(String(v));
    if (pipe === 'month') {
      const d = new Date(`${String(v).slice(0, 7)}-01T00:00:00`);
      return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('th-TH-u-ca-buddhist', { month: 'long', year: 'numeric' });
    }
    if (pipe === 'money') return money.format(Number(v));
    if (pipe === 'year') { const y = Number(v); return Number.isFinite(y) ? String(y < 2400 ? y + 543 : y) : String(v); }
    return String(v);
  });
  return missing ? '' : text;
}

/** A list filter row: single fields, and "from … to" date pairs shown as one range control with presets. */
export type FilterGroup = { kind: 'field'; field: Field } | { kind: 'range'; from: Field; to: Field };

/** Adjacent date filters named like from/to (from, dateFrom, startFrom … to, dateTo) become one range. */
export function filterGroups(fields: Field[]): FilterGroup[] {
  const out: FilterGroup[] = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const n = fields[i + 1];
    if (f.type === 'date' && n?.type === 'date' && /from$/i.test(f.name) && /to$/i.test(n.name)
      && f.name.replace(/from$/i, '') === n.name.replace(/to$/i, '')) {
      out.push({ kind: 'range', from: f, to: n });
      i++;
    } else out.push({ kind: 'field', field: f });
  }
  return out;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Quick ranges for a date pair, computed from `today` (local date): this month, last month, this quarter, this year. */
export function datePresets(today: Date = new Date()): { id: string; label: string; from: string; to: string }[] {
  const y = today.getFullYear();
  const m = today.getMonth();
  const q = Math.floor(m / 3) * 3;
  return [
    { id: 'month', label: 'เดือนนี้', from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) },
    { id: 'last-month', label: 'เดือนก่อน', from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) },
    { id: 'quarter', label: 'ไตรมาสนี้', from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) },
    { id: 'year', label: 'ปีนี้', from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) },
  ];
}

/** Detail facts split into titled groups at each `section` column (the first group may be untitled). */
export function factSections(fields: Column[]): { title?: string; fields: Column[] }[] {
  const out: { title?: string; fields: Column[] }[] = [];
  for (const f of fields) {
    if (f.section || !out.length) out.push({ title: f.section, fields: [] });
    out[out.length - 1].fields.push(f);
  }
  return out;
}

const AUDIT_HIDDEN = new Set(['ref', 'contentType', 'dataBase64', 'password', 'token']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What an audit row changed, for people: internal parts of the stored summary text ("ref: claim:…", content
 * types, bare record ids) are left out, file uploads read "ไฟล์ <name>".
 */
export function auditDetailText(row: { route: string; summary_text: string }): string {
  const parts = (row.summary_text ?? '').split(' · ').map((p) => p.trim()).filter(Boolean);
  const kept = parts.filter((p) => {
    const i = p.indexOf(': ');
    if (i < 0) return true;
    const key = p.slice(0, i);
    const value = p.slice(i + 2).replace(/^[\w-]+:/, '');
    return !AUDIT_HIDDEN.has(key) && !UUID.test(value) && !/Id$/.test(key);
  });
  if (row.route === '/_attachments') {
    const file = kept.find((p) => p.startsWith('fileName: '));
    if (file) return `ไฟล์ ${file.slice('fileName: '.length)}`;
  }
  return kept.join(' · ');
}

/* ---------------- AI helpers (server routes in apps/web/src/app/assist/*, docs/ai.md) ---------------- */

/** Field types the AI may propose a value for. Booleans (e.g. "ส่งขออนุมัติทันที"), passwords, permissions and pictures stay with the person. */
export const AI_FILL_TYPES: readonly FieldType[] = ['text', 'textarea', 'email', 'number', 'date', 'month', 'select', 'lookup'];

export function aiFillable(fields: Field[]): Field[] {
  return fields.filter((f) => AI_FILL_TYPES.includes(f.type));
}

/** 2569 -> 2026: Thai papers print Buddhist-era years. */
const ceYear = (y: number) => (y > 2400 ? y - 543 : y);

/** "2569-03-05", "5/3/2569", "05-03-2026" -> "2026-03-05"; anything else -> undefined. */
export function toIsoDate(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim();
  let y: number, m: number, d: number;
  let r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return undefined;
  y = ceYear(y);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Clean one value an AI proposed for a field: numbers to 2 decimals ("1,070.00 บาท" -> 1070), dates to
 * YYYY-MM-DD in ค.ศ., selects must be one of the options (value or Thai label). `undefined` = leave the field alone.
 * Lookup ids are returned as text — the caller checks them against the records it offered.
 */
export function cleanAiValue(field: Field, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '') return undefined;
  switch (field.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s]|บาท|฿/g, ''));
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
    }
    case 'date': return toIsoDate(raw);
    case 'month': {
      const r = String(raw).trim().match(/^(\d{4})-(\d{1,2})/);
      if (!r || Number(r[2]) < 1 || Number(r[2]) > 12) return undefined;
      return `${ceYear(Number(r[1]))}-${pad2(Number(r[2]))}`;
    }
    case 'select': {
      const s = String(raw).trim();
      return field.options?.find((o) => o.value === s || o.label === s)?.value;
    }
    case 'lookup': case 'text': case 'textarea': case 'email': {
      const s = String(raw).trim().slice(0, field.type === 'textarea' ? 2000 : 500);
      return s || undefined;
    }
    default: return undefined;
  }
}

/** Only the filters a list screen declares, cleaned (for "ค้นหาด้วย AI"): { status: 'รออนุมัติ', bogus: 1 } -> { status: 'submitted' }. */
export function cleanListFilters(filters: Field[] | undefined, raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of filters ?? []) {
    const v = f.type === 'boolean' ? (raw[f.name] === true || raw[f.name] === 'true' ? 'true' : undefined) : cleanAiValue(f, raw[f.name]);
    if (v !== undefined) out[f.name] = String(v);
  }
  return out;
}

const emptyValue = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** A line nobody has typed in yet (only defaults). */
export function isBlankLine(line: Record<string, unknown>, blank: Record<string, unknown> = {}): boolean {
  return Object.entries(line).every(([k, v]) => k.startsWith('__') || emptyValue(v) || v === blank[k]);
}

/**
 * Put an AI proposal into a form without overwriting what the person already typed: empty fields are filled
 * (with their lookup display text `__label.<field>`), proposed lines replace untouched lines and are added after typed ones.
 */
export function mergeAiFill(
  current: { values: Record<string, unknown>; lines: Record<string, unknown>[] },
  proposal: { values: Record<string, unknown>; lines: Record<string, unknown>[] },
  blankLine: Record<string, unknown> = {},
): { values: Record<string, unknown>; lines: Record<string, unknown>[]; filled: number } {
  const values = { ...current.values };
  let filled = 0;
  for (const [k, v] of Object.entries(proposal.values)) {
    if (k.startsWith('__') || emptyValue(v) || !emptyValue(values[k])) continue;
    values[k] = v;
    filled++;
    if (proposal.values[`__label.${k}`] !== undefined) values[`__label.${k}`] = proposal.values[`__label.${k}`];
  }
  const kept = current.lines.filter((l) => !isBlankLine(l, blankLine));
  const added = proposal.lines.filter((l) => !isBlankLine(l)).map((l) => ({ ...blankLine, ...l }));
  filled += added.length;
  const lines = added.length ? [...kept, ...added] : current.lines;
  return { values, lines, filled };
}

/* ---- Thai (Buddhist-era) date entry: the value stays ISO (YYYY-MM-DD / YYYY-MM), people see and type พ.ศ. ---- */

export const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
export const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
/** Sunday first, as Thai wall calendars print it. */
export const THAI_WEEKDAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/**
 * Year as typed → Christian year. 4 digits ≥ 2400 = พ.ศ. (−543); other 4 digits = ค.ศ.;
 * 2 digits = the last two digits of a พ.ศ. year ("69" → 2569 → 2026), the way Thai forms abbreviate it.
 */
function typedYear(text: string): number | null {
  if (/^\d{4}$/.test(text)) { const y = Number(text); return y >= 2400 ? y - 543 : y; }
  if (/^\d{2}$/.test(text)) return 2500 + Number(text) - 543;
  return null;
}

/** "ตุลาคม" / "ต.ค." / "ต.ค" → 9 (0-based), unknown → -1. */
function thaiMonthIndex(name: string): number {
  const full = THAI_MONTHS.indexOf(name);
  if (full >= 0) return full;
  const bare = name.replace(/\.$/, '');
  return THAI_MONTHS_SHORT.findIndex((x) => x.replace(/\.$/, '') === bare);
}

const validDate = (y: number, m: number, d: number) => {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d > last ? null : `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

/** "2026-10-03" → "03/10/2569" (what a date box shows). Not an ISO date → "". */
export function dateInputText(isoDate: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? '');
  return m ? `${m[3]}/${m[2]}/${Number(m[1]) + 543}` : '';
}

/**
 * What someone typed in a date box → ISO "YYYY-MM-DD", or null when it is not a real date.
 * Accepts d/m/yyyy, d-m-yyyy, d.m.yyyy (พ.ศ. or ค.ศ., or 2-digit พ.ศ.), "3 ต.ค. 2569" / "3 ตุลาคม 69", ISO "2026-10-03", and the 8 digits "03102569".
 */
export function parseDateInput(text: string): string | null {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) { const y = typedYear(m[1]); return y === null ? null : validDate(y, Number(m[2]), Number(m[3])); }
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(t) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (m) { const y = typedYear(m[3]); return y === null ? null : validDate(y, Number(m[2]), Number(m[1])); }
  m = /^(\d{1,2}) ?([ก-๙.]+) ?(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const idx = thaiMonthIndex(m[2]);
    const y = typedYear(m[3]);
    return idx < 0 || y === null ? null : validDate(y, idx + 1, Number(m[1]));
  }
  return null;
}

/** "2026-10" → "ตุลาคม 2569" (what a month box shows). Not "YYYY-MM" → "". */
export function monthInputText(period: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})$/.exec(period ?? '');
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${THAI_MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}` : '';
}

/** Typed month → "YYYY-MM" or null: "10/2569", "10/69", "ต.ค. 2569", "ตุลาคม 2569", "2026-10". */
export function parseMonthInput(text: string): string | null {
  const t = text.trim().replace(/\s+/g, ' ');
  let m = /^(\d{4})-(\d{1,2})$/.exec(t);
  let month: number, y: number | null;
  if (m) { y = typedYear(m[1]); month = Number(m[2]); }
  else if ((m = /^(\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(t))) { y = typedYear(m[2]); month = Number(m[1]); }
  else if ((m = /^([ก-๙.]+) ?(\d{2}|\d{4})$/.exec(t))) {
    y = typedYear(m[2]); month = thaiMonthIndex(m[1]) + 1;
  } else return null;
  if (y === null || y < 1900 || y > 2200 || month < 1 || month > 12) return null;
  return `${y}-${String(month).padStart(2, '0')}`;
}

/**
 * The days shown for one month of a Sunday-first calendar: 6 weeks × 7 ISO dates (spilling into the months around it),
 * so the grid never changes height when paging months. `month` is 1–12, `year` is ค.ศ.
 */
export function calendarWeeks(year: number, month: number): { iso: string; inMonth: boolean }[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = new Date(first.getTime() - first.getUTCDay() * 86_400_000);
  const weeks: { iso: string; inMonth: boolean }[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: { iso: string; inMonth: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(start.getTime() + (w * 7 + d) * 86_400_000);
      row.push({ iso: day.toISOString().slice(0, 10), inMonth: day.getUTCMonth() === month - 1 });
    }
    weeks.push(row);
  }
  return weeks;
}

/* ---- cloud plan banner ---- */

/** The company's cloud plan as identity's GET /subscription returns it (`subscription`; null = no plan limit). */
export interface PlanView { planName: string; status: 'trial' | 'active' | 'suspended' | 'cancelled'; daysLeft: number | null; blocked: string | null }

/** remind paid companies this many days before access ends */
export const PLAN_REMIND_DAYS = 7;

/**
 * Banner above every page (web and mobile): trial days left, or a payment reminder in the last REMIND_DAYS of a paid period.
 * Null when there is nothing to say (self-hosted, plenty of time left).
 */
export function planNotice(p: PlanView | null): { text: string; urgent: boolean } | null {
  if (!p || p.daysLeft === null) return null;
  if (p.status === 'trial') {
    return { text: p.daysLeft > 0 ? `ทดลองใช้แพ็กเกจ ${p.planName} เหลือ ${p.daysLeft} วัน` : `ทดลองใช้แพ็กเกจ ${p.planName} วันสุดท้าย`, urgent: p.daysLeft <= 3 };
  }
  if (p.status === 'active' && p.daysLeft <= PLAN_REMIND_DAYS) return { text: `ใกล้ครบกำหนดชำระค่าบริการ — ใช้งานได้อีก ${p.daysLeft} วัน`, urgent: p.daysLeft <= 3 };
  return null;
}
export * from './xlsx.ts';

/* ------------------------------------------------------------------ opening receivables / payables (phase 2) ------------------------------------------------------------------ */

/** One unpaid document carried over from the old system, as read from the import file (codes resolved by master-data). */
export interface OpeningDocRow {
  row: number;
  partnerId: string;
  partnerCode: string;
  partnerName: string;
  taxId: string | null;
  branch: string | null;
  address: string | null;
  docNo: string;
  docDate: string;
  dueDate: string;
  amount: number;
  note: string | null;
}

/** Import columns shared by ลูกหนี้ยกมา (side customer) and เจ้าหนี้ยกมา (side supplier). */
export const openingDocColumns = (side: 'customer' | 'supplier'): ImportColumn[] => [
  { key: 'partnerCode', label: side === 'customer' ? 'รหัสลูกค้า' : 'รหัสผู้ขาย', required: true },
  { key: 'docNo', label: side === 'customer' ? 'เลขที่ใบแจ้งหนี้เดิม' : 'เลขที่ใบแจ้งหนี้ของผู้ขาย', required: true },
  { key: 'docDate', label: 'วันที่เอกสาร', required: true },
  { key: 'dueDate', label: 'ครบกำหนดชำระ' },
  { key: 'amount', label: 'ยอดค้าง (รวม VAT)', required: true },
  { key: 'note', label: 'หมายเหตุ' },
];

/** `ImportSpec.resolve` for the opening documents: partner codes → partner details from master-data. */
export const OPENING_PARTNER_RESOLVE = {
  module: 'master-data', endpoint: '/partners/resolve', column: 'partnerCode',
  into: { partnerId: 'id', partnerName: 'name', partnerKind: 'kind', taxId: 'tax_id', branch: 'branch', address: 'address' },
};

/**
 * Check the rows of an opening receivables / payables file (dates in any form people type: ISO, d/m/yyyy พ.ศ. or ค.ศ., Excel dates).
 * Duplicates inside the file are reported here; duplicates against documents already in the system are the service's job.
 */
export function checkOpeningDocs(rows: Record<string, unknown>[], side: 'customer' | 'supplier', today: string): { valid: OpeningDocRow[]; errors: ImportRowError[] } {
  const errors: ImportRowError[] = [];
  const valid: OpeningDocRow[] = [];
  const seen = new Map<string, number>();
  const who = side === 'customer' ? 'ลูกค้า' : 'ผู้ขาย';
  rows.forEach((raw, i) => {
    const row = i + 1;
    const str = (k: string) => String(raw[k] ?? '').trim();
    const before = errors.length;
    const code = str('partnerCode');
    const kind = str('partnerKind');
    if (!code) errors.push({ row, field: 'partnerCode', message: `กรอกรหัส${who}` });
    else if (!/^[0-9a-f-]{36}$/i.test(str('partnerId'))) errors.push({ row, field: 'partnerCode', message: `ไม่พบรหัส${who} ${code} ในข้อมูลหลัก — นำเข้าคู่ค้าก่อน` });
    else if (kind && kind !== side && kind !== 'both') errors.push({ row, field: 'partnerCode', message: `${code} ไม่ได้ตั้งเป็น${who} — แก้ "เป็น" ในข้อมูลคู่ค้า` });
    const docNo = str('docNo');
    if (!docNo) errors.push({ row, field: 'docNo', message: 'กรอกเลขที่เอกสาร' });
    else if (docNo.length > 50) errors.push({ row, field: 'docNo', message: 'เลขที่เอกสารยาวเกิน 50 ตัวอักษร' });
    const docDate = parseDateInput(str('docDate'));
    if (!docDate) errors.push({ row, field: 'docDate', message: 'วันที่ไม่ถูกต้อง — ใช้ วัน/เดือน/ปี เช่น 15/10/2569' });
    else if (docDate > today) errors.push({ row, field: 'docDate', message: 'วันที่เอกสารอยู่ในอนาคต' });
    const dueRaw = str('dueDate');
    const dueDate = dueRaw ? parseDateInput(dueRaw) : docDate;
    if (dueRaw && !dueDate) errors.push({ row, field: 'dueDate', message: 'วันครบกำหนดไม่ถูกต้อง' });
    else if (docDate && dueDate && dueDate < docDate) errors.push({ row, field: 'dueDate', message: 'ครบกำหนดก่อนวันที่เอกสาร' });
    const amount = Number(str('amount').replace(/,/g, ''));
    if (!str('amount') || !Number.isFinite(amount) || amount <= 0) errors.push({ row, field: 'amount', message: 'ยอดค้างต้องเป็นตัวเลขมากกว่า 0' });
    else if (Math.round(amount * 100) !== amount * 100 && Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) errors.push({ row, field: 'amount', message: 'ยอดเงินมีทศนิยมได้ 2 ตำแหน่ง' });
    if (errors.length > before) return;
    const key = side === 'customer' ? docNo.toLowerCase() : `${code.toLowerCase()}|${docNo.toLowerCase()}`;
    if (seen.has(key)) return void errors.push({ row, field: 'docNo', message: `เลขที่ ${docNo} ซ้ำกับแถวที่ ${seen.get(key)}` });
    seen.set(key, row);
    valid.push({
      row, partnerId: str('partnerId'), partnerCode: code, partnerName: str('partnerName') || code, taxId: str('taxId') || null, branch: str('branch') || null,
      address: str('address') || null, docNo, docDate: docDate!, dueDate: dueDate!, amount: Math.round(amount * 100) / 100, note: str('note').slice(0, 500) || null,
    });
  });
  return { valid, errors };
}
