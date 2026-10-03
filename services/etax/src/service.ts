import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { EventData } from '@erp/contracts';
import { auth, badRequest, conflict, hasPerm, HttpError, loadManifest, now, one, parse, requirePerm, s, z, type AuthContext, type Client, type ServiceDefinition } from '@erp/kernel';
import { isValidThaiTaxId } from '@erp/thai';
import { buildEtaxXml, checkEtaxXml, defaultPurposeCode, isNote, namespacesFor, PURPOSE_CODES, purposeKindOf, sellerProblems, TYPE_NAMES, XML_DECL, type DocSnapshot, type LineSnapshot, type SellerProfile, type TypeCode } from './etda.ts';
import { Pkcs12Error, readPkcs12 } from './pkcs12.ts';
import { certificateInfo, verifyXadesSignature, xadesBesSigner } from './xades.ts';
import { parseXml, serialize } from './xml.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const READ = 'etax.document.read';
const WRITE = 'etax.document.write';
const SETTINGS = 'etax.settings.write';
/** uploaded_by of the XML files this module stores as attachments (users cannot delete them; `etax.attachment.delete` can) */
const SYSTEM_UPLOADER = 'system:etax';
const P12_MAX_BYTES = 64 * 1024;

export const STATUS_TH: Record<string, string> = {
  incomplete: 'ข้อมูลไม่พอ', draft: 'รอสร้าง XML', generated: 'สร้าง XML แล้ว', signed: 'ลงลายมือชื่อแล้ว',
  sent_manual: 'บันทึกว่าส่งแล้ว (e-Tax by Email)', sent_sp: 'บันทึกว่าส่งผ่านผู้ให้บริการ',
  cancelled: 'ยกเลิก (ไม่ออกเป็น e-Tax)', replaced: 'ถูกแทนที่ด้วยฉบับใหม่',
};
/** Lock-step status machine. Every route checks its source status against this table (and tests assert the refusals). */
export const TRANSITIONS: Record<string, string[]> = {
  generate: ['draft', 'generated', 'signed'], // re-generating drops the signature
  sign: ['generated', 'signed'], // re-signing replaces the signature
  markSent: ['generated', 'signed'],
  unmarkSent: ['sent_manual', 'sent_sp'], // correcting a wrong record; impossible once replaced
  editBuyer: ['draft', 'generated', 'signed'], // clears XML + signature → draft
  cancel: ['incomplete', 'draft', 'generated', 'signed'], // never once recorded as sent: then only a replacement
  restore: ['cancelled'],
  replace: ['sent_manual', 'sent_sp'], // tax invoices only
};
const KIND_TH: Record<string, string> = { invoice: 'ใบกำกับภาษี', credit: 'ใบลดหนี้', debit: 'ใบเพิ่มหนี้' };
const CHANNEL_TH: Record<string, string> = { email_etda: 'e-Tax Invoice by Email (สพธอ.)', service_provider: 'ผู้ให้บริการ (Service Provider)' };

/** One-line boundary shown at the top of every screen of this module. */
export const BOUNDARY =
  'ระบบนี้ไม่ได้ส่งให้กรมสรรพากร/ETDA — ส่งผ่าน e-Tax Invoice by Email หรือผู้ให้บริการ แล้วบันทึกผลที่นี่';

/** The honest boundary, shown on every document: this module prepares files, it never submits anything. */
export const DELIVERY_HELP =
  'โมดูลนี้สร้างไฟล์ XML ตามมาตรฐาน ขมธอ. 3-2560 และลงลายมือชื่อดิจิทัลด้วยใบรับรองของบริษัทเท่านั้น — ไม่ได้ส่งให้กรมสรรพากรหรือ สพธอ. เอง. ' +
  'ส่งได้ 2 ทาง: (1) e-Tax Invoice by Email — ส่งอีเมลใบกำกับภาษีถึงผู้ซื้อและสำเนาถึงระบบของ สพธอ. (ETDA) เพื่อประทับเวลา ' +
  '(สำหรับผู้ประกอบการรายได้ไม่เกินเกณฑ์ที่กรมสรรพากรกำหนด — ตรวจเงื่อนไขล่าสุดที่ etax.rd.go.th); ' +
  '(2) ผ่านผู้ให้บริการ (Service Provider) ที่กรมสรรพากรอนุมัติ — อัปโหลด XML ที่ดาวน์โหลดจากที่นี่ในระบบของผู้ให้บริการ. ' +
  'เมื่อส่งแล้ว กด "บันทึกว่าส่งแล้ว" พร้อมเลขอ้างอิงจากอีเมล/ผู้ให้บริการ — สถานะนี้เป็นข้อมูลที่ผู้ใช้บันทึก ระบบไม่ได้ตรวจสอบว่าส่งสำเร็จ.';

/* ---------------- time ---------------- */

/** "YYYY-MM-DDTHH:mm:ss" in Asia/Bangkok (UTC+7, no DST) from the kernel clock. */
function bangkok(d: Date = now()): string {
  return new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 19);
}

/* ---------------- settings ---------------- */

const opt = (max = 200) => z.string().trim().max(max).nullable().optional();
const SettingsInput = z.object({
  sellerName: z.string().trim().min(1).max(256),
  taxId: z.string().trim().transform((v) => v.replace(/[\s-]/g, '')).refine(isValidThaiTaxId, 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (13 หลัก / เลขตรวจสอบ)'),
  branch: z.string().trim().regex(/^\d{5}$/, 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)').default('00000'),
  buildingNumber: opt(50),
  addressLine1: z.string().trim().min(1).max(256),
  addressLine2: opt(256),
  subdistrict: opt(), subdistrictCode: z.string().trim().regex(/^\d{6}$/, 'รหัสตำบล/แขวง 6 หลัก').nullable().optional().or(z.literal('')),
  district: opt(), districtCode: z.string().trim().regex(/^\d{4}$/, 'รหัสอำเภอ/เขต 4 หลัก').nullable().optional().or(z.literal('')),
  province: opt(), provinceCode: z.string().trim().regex(/^\d{2}$/, 'รหัสจังหวัด 2 หลัก').nullable().optional().or(z.literal('')),
  postcode: z.string().trim().regex(/^\d{5}$/, 'รหัสไปรษณีย์ 5 หลัก'),
  email: z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
  phone: opt(50),
  invoiceTypeCode: z.enum(['388', 'T02']).default('T02'),
});

const CertificateInput = z.object({
  fileName: z.string().trim().max(255).optional(),
  dataBase64: z.string().min(1).max(Math.ceil(P12_MAX_BYTES / 3) * 4 + 200),
  password: z.string().max(200).optional(),
});

function sellerFrom(r: any): SellerProfile | null {
  if (!r) return null;
  return {
    name: r.seller_name ?? '', taxId: r.tax_id ?? '', branch: r.branch ?? '00000', email: r.email || null, phone: r.phone || null,
    buildingNumber: r.building_number || null, addressLine1: r.address_line1 ?? '', addressLine2: r.address_line2 || null,
    subdistrict: r.subdistrict || null, subdistrictCode: r.subdistrict_code || null, district: r.district || null, districtCode: r.district_code || null,
    province: r.province || null, provinceCode: r.province_code || null, postcode: r.postcode ?? '',
  };
}

async function loadSettings(c: Client): Promise<any | null> {
  return (await c.query('select * from etax_settings limit 1')).rows[0] ?? null;
}

/** UAT wave 9 (UX-W9): the holder of the uploaded certificate should be this seller (its tax ID in the subject). */
function certWarnings(r: any | null): string[] {
  if (!r?.p12 || !r.tax_id || String(r.cert_subject ?? '').includes(r.tax_id)) return [];
  return [`ใบรับรองนี้ไม่มีเลขผู้เสียภาษี ${r.tax_id} ในชื่อผู้ถือ — ตรวจว่าเป็นใบรับรองของบริษัทนี้ (ใบกำกับที่ลงลายมือชื่อด้วยใบรับรองของบริษัทอื่น กรมสรรพากรไม่รับ)`];
}

function settingsView(r: any | null, env: NodeJS.ProcessEnv) {
  const seller = sellerFrom(r);
  const problems = sellerProblems(seller);
  const expired = r?.cert_not_after ? new Date(r.cert_not_after) < now() : false;
  return {
    sellerName: r?.seller_name ?? null, taxId: r?.tax_id ?? null, branch: r?.branch ?? '00000', buildingNumber: r?.building_number ?? null,
    addressLine1: r?.address_line1 ?? null, addressLine2: r?.address_line2 ?? null,
    subdistrict: r?.subdistrict ?? null, subdistrictCode: r?.subdistrict_code ?? null, district: r?.district ?? null, districtCode: r?.district_code ?? null,
    province: r?.province ?? null, provinceCode: r?.province_code ?? null, postcode: r?.postcode ?? null, email: r?.email ?? null, phone: r?.phone ?? null,
    invoiceTypeCode: r?.invoice_type_code ?? 'T02', invoice_type_label: TYPE_NAMES[(r?.invoice_type_code ?? 'T02') as TypeCode],
    tax_id_text: r?.tax_id ? `${r.tax_id} สาขา ${r.branch === '00000' ? 'สำนักงานใหญ่' : r.branch}` : null,
    configured: problems.length === 0, problems,
    certificate: r?.p12 ? {
      file_name: r.p12_file_name, subject: r.cert_subject, issuer: r.cert_issuer, serial: r.cert_serial,
      not_before: r.cert_not_before, not_after: r.cert_not_after, fingerprint: r.cert_fingerprint, expired,
      uploaded_at: r.cert_uploaded_at, uploaded_by_name: r.cert_uploaded_by_name,
    } : null,
    has_certificate: !!r?.p12,
    cert_subject: r?.cert_subject ?? null, cert_not_after: r?.cert_not_after ?? null, cert_expired: expired,
    // kept on the settings screen (not only in the upload reply): a certificate of another company signs "valid" XML the RD will reject
    cert_warnings: certWarnings(r),
    password_source: env.ETAX_P12_PASSWORD ? 'env' : 'per_session',
    password_source_label: env.ETAX_P12_PASSWORD ? 'ตั้งไว้ในตัวแปรระบบ ETAX_P12_PASSWORD' : 'กรอกทุกครั้งที่ลงลายมือชื่อ (ไม่บันทึก)',
    boundary: BOUNDARY,
    help: DELIVERY_HELP,
  };
}

/* ---------------- documents ---------------- */

const toLines = (v: unknown): LineSnapshot[] | null => (Array.isArray(v) ? (v as LineSnapshot[]) : null);

function snapshotOf(r: any, refTypeCode: TypeCode): DocSnapshot {
  return {
    kind: r.kind, no: r.doc_no, issueDate: r.issue_date, dueDate: r.due_date ?? null,
    buyer: { name: r.buyer_name, taxId: r.buyer_tax_id, branch: r.buyer_branch, address: r.buyer_address, email: r.buyer_email },
    lines: toLines(r.lines) ?? [], net: r.net, vat: r.vat, gross: r.gross, deposit: r.deposit ?? null,
    ref: r.kind === 'invoice' ? null : r.ref_invoice_no ? { no: r.ref_invoice_no, date: r.ref_invoice_date, typeCode: refTypeCode } : null,
    replaces: r.replaces_id ? { no: r.replaces_no, date: r.replaces_date, typeCode: r.replaces_type_code as TypeCode } : null,
    reason: r.reason ?? null, originalNet: r.original_net ?? null, correctNet: r.correct_net ?? null,
  };
}

const LIST_COLS = `id, kind, doc_no, issue_date, type_code, buyer_name, buyer_tax_id, net, vat, gross, status, ref_invoice_no, replaces_no, sent_channel, sent_date,
  jsonb_array_length(problems) as problem_count, generated_at, signed_at, updated_at`;

function view(r: any) {
  const { xml, signed_xml, payload, ...rest } = r;
  const lines = toLines(r.lines);
  let verification: string | null = null;
  if (xml) {
    const st = checkEtaxXml(signed_xml ?? xml);
    const sig = signed_xml ? verifyXadesSignature(signed_xml) : null;
    verification = st.ok && (!sig || sig.valid)
      ? (sig ? 'ผ่าน: โครงสร้าง ยอดรวม และลายมือชื่อดิจิทัลถูกต้อง' : 'ผ่าน: โครงสร้างและยอดรวมถูกต้อง (ยังไม่ลงลายมือชื่อ)')
      : `ไม่ผ่าน: ${[...st.errors, ...(sig?.errors ?? [])].join(' · ')}`;
  }
  return {
    ...rest,
    /** which generate action applies (screens show one condition per action) */
    generate_as: TRANSITIONS.generate.includes(r.status) ? (r.kind !== 'invoice' ? 'note' : r.replaces_id ? 'replacement' : 'invoice') : null,
    replace_allowed: r.kind === 'invoice' && TRANSITIONS.replace.includes(r.status) && !r.replaced_by_id,
    purpose_label: r.purpose_code ? `${r.purpose_code} ${PURPOSE_CODES.find((p) => p.code === r.purpose_code)?.label ?? ''}`.trim() : null,
    boundary: BOUNDARY,
    verification,
    kind_label: r.replaces_id ? `${KIND_TH[r.kind]} (ออกแทนฉบับเดิม)` : KIND_TH[r.kind], status_label: STATUS_TH[r.status], type_label: r.type_code ? TYPE_NAMES[r.type_code as TypeCode] : null,
    sent_channel_label: r.sent_channel ? CHANNEL_TH[r.sent_channel] : null,
    lines: (lines ?? []).map((l, i) => ({ line_no: i + 1, ...l })),
    has_lines: lines !== null,
    xml_available: !!xml, signed_available: !!signed_xml,
    problems_text: (r.problems ?? []).join(' · ') || null,
    warnings_text: (r.warnings ?? []).join(' · ') || null,
    help: DELIVERY_HELP,
  };
}

/** `lock` = select … for update: every status change reads the row locked, so two clicks cannot both pass the status check */
async function loadDoc(c: Client, id: string, lock = false) {
  return one(c, `select * from etax_documents where id = $1${lock ? ' for update' : ''}`, [id], 'e-Tax document');
}

/** Replace the system-generated XML attachments of a document (kernel `_attachments`, same tenant transaction / RLS). */
async function replaceSystemFiles(c: Client, docId: string, files: { name: string; xml: string }[]) {
  const ref = `document:${docId}`;
  await c.query('delete from _attachments where ref = $1 and uploaded_by = $2', [ref, SYSTEM_UPLOADER]);
  for (const f of files) {
    const data = Buffer.from(f.xml, 'utf8');
    await c.query(
      `insert into _attachments (id, ref, file_name, content_type, size, sha256, data, uploaded_by, uploaded_by_name)
       values ($1, $2, $3, 'application/xml', $4, $5, $6, $7, 'ระบบ e-Tax')`,
      [randomUUID(), ref, f.name, data.length, createHash('sha256').update(data).digest('hex'), data, SYSTEM_UPLOADER],
    );
  }
}

const safeName = (no: string) => no.replace(/[^\w.-]+/g, '_');

/* ---------------- event snapshots ---------------- */

type Invoiced = EventData<'sales.invoiced'>;
type NoteIssued = EventData<'sales.note_issued'>;

const BUYER_COLS = ['buyer_name', 'buyer_tax_id', 'buyer_branch', 'buyer_address', 'buyer_email'];

async function upsertSnapshot(c: Client, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  const values = Object.values(row).map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
  // A re-sent fact (another event id for the same document) refreshes a snapshot nobody has acted on yet; generated / signed /
  // sent / cancelled documents are never touched, and a buyer the user corrected here is kept.
  const updates = cols.filter((k) => !['source', 'source_id'].includes(k)).map((k) => (BUYER_COLS.includes(k)
    ? `${k} = case when etax_documents.buyer_edited_at is null then excluded.${k} else etax_documents.${k} end`
    : `${k} = excluded.${k}`)).join(', ');
  await c.query(
    `insert into etax_documents (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
     on conflict (tenant_id, source, source_id) do update set ${updates}, updated_at = now()
     where etax_documents.status in ('incomplete', 'draft')`,
    values,
  );
}

/** a real calendar day "YYYY-MM-DD" (an event from an old/foreign producer may carry anything) */
const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/**
 * `sales.invoiced` → one snapshot per tax invoice. Never throws for business reasons (the invoice already exists in Sales):
 * an event without lines (Sales before wave 9) or with an unusable date becomes an `incomplete` record that says why.
 */
export async function snapshotInvoice(c: Client, e: Invoiced) {
  const lines: LineSnapshot[] | null = e.lines?.length ? e.lines.map((l) => ({
    itemCode: l.itemCode, description: l.description, qty: l.qty, uom: l.uom ?? null, unitPrice: l.unitPrice,
    discount: l.discount ?? 0, amount: l.amount, vatRate: l.vatRate,
  })) : null;
  const deposit = e.depositApplied && e.depositApplied.net > 0 ? {
    net: e.depositApplied.net, vat: e.depositApplied.vat, gross: e.depositApplied.gross,
    refs: e.depositApplied.deposits.map((d) => d.taxInvoiceNo ?? d.depositNo).join(', '),
  } : null;
  const problems: string[] = [];
  if (!lines) problems.push('ข้อมูลไม่พอ: เหตุการณ์ใบกำกับภาษีนี้ไม่มีรายการสินค้า (ส่งมาจากโมดูลขายรุ่นเก่า) — สร้าง XML ไม่ได้ ให้ออกผ่านผู้ให้บริการ หรือยกเลิกในโมดูลนี้');
  if (e.issueDate !== undefined && !isDay(e.issueDate)) problems.push(`ข้อมูลไม่พอ: วันที่ใบกำกับภาษี "${e.issueDate}" ไม่ถูกต้อง`);
  await upsertSnapshot(c, {
    source: 'invoice', source_id: e.invoiceId, kind: 'invoice', doc_no: e.invoiceNo, issue_date: isDay(e.issueDate) ? e.issueDate : bangkok().slice(0, 10),
    due_date: isDay(e.dueDate) ? e.dueDate : null, buyer_id: e.customerId ?? null, buyer_name: e.customerName || '-', buyer_tax_id: e.customerTaxId ?? null,
    buyer_branch: e.customerBranch ?? null, buyer_address: e.customerAddress ?? null, buyer_email: e.customerEmail ?? null,
    lines, net: e.net, vat: e.vat, gross: e.gross, vat_mode: e.vatMode ?? null, deposit,
    status: problems.length ? 'incomplete' : 'draft', problems, payload: e,
  });
  // notes that arrived before their invoice (or carried no address) take the buyer's address / e-mail from it
  await c.query(
    `update etax_documents set buyer_address = coalesce(buyer_address, $2), buyer_email = coalesce(buyer_email, $3), updated_at = now()
     where source = 'note' and ref_invoice_id = $1 and status = 'draft' and buyer_edited_at is null and (buyer_address is null or buyer_email is null)`,
    [e.invoiceId, e.customerAddress ?? null, e.customerEmail ?? null],
  );
}

/** The buyer as last corrected here: the invoice's snapshot, or the newest replacement of it. */
async function currentBuyerOf(c: Client, invoiceId: string) {
  let r = (await c.query(`select id, buyer_address, buyer_email, buyer_tax_id, buyer_branch, replaced_by_id from etax_documents where source = 'invoice' and source_id = $1`, [invoiceId])).rows[0];
  for (let i = 0; r?.replaced_by_id && i < 20; i++) {
    const next = (await c.query('select id, buyer_address, buyer_email, buyer_tax_id, buyer_branch, replaced_by_id from etax_documents where id = $1', [r.replaced_by_id])).rows[0];
    if (!next) break;
    r = next;
  }
  return r as { buyer_address: string | null; buyer_email: string | null; buyer_tax_id: string | null; buyer_branch: string | null } | undefined;
}

/** `sales.note_issued` → one snapshot per credit / debit note (amounts = the difference, lines in the invoice's price basis). */
export async function snapshotNote(c: Client, e: NoteIssued) {
  // the buyer's address / e-mail are not on the note event: take them from our own snapshot of the original invoice
  const inv = await currentBuyerOf(c, e.invoiceId);
  const rate = e.net > 0 && e.vat > 0 ? 0.07 : 0;
  const problems: string[] = [];
  if (!isDay(e.issueDate)) problems.push(`ข้อมูลไม่พอ: วันที่เอกสาร "${e.issueDate}" ไม่ถูกต้อง`);
  if (!isDay(e.invoiceDate)) problems.push(`ข้อมูลไม่พอ: วันที่ใบกำกับภาษีเดิม "${e.invoiceDate}" ไม่ถูกต้อง`);
  if (!e.lines.length) problems.push('ข้อมูลไม่พอ: เอกสารนี้ไม่มีรายการ');
  await upsertSnapshot(c, {
    source: 'note', source_id: e.noteId, kind: e.kind, doc_no: e.noteNo, issue_date: isDay(e.issueDate) ? e.issueDate : bangkok().slice(0, 10), due_date: null,
    buyer_id: e.customerId, buyer_name: e.customerName || '-', buyer_tax_id: e.customerTaxId ?? inv?.buyer_tax_id ?? null,
    buyer_branch: e.customerBranch ?? inv?.buyer_branch ?? null, buyer_address: inv?.buyer_address ?? null, buyer_email: inv?.buyer_email ?? null,
    lines: e.lines.length ? e.lines.map((l): LineSnapshot => ({ itemCode: l.itemCode, description: l.description, qty: l.qty, uom: null, unitPrice: l.unitPrice, discount: 0, amount: l.amount, vatRate: rate })) : null,
    net: e.net, vat: e.vat, gross: e.gross, vat_mode: null, deposit: null,
    ref_invoice_id: e.invoiceId, ref_invoice_no: e.invoiceNo, ref_invoice_date: isDay(e.invoiceDate) ? e.invoiceDate : null, reason: e.reason,
    original_net: e.originalNet, correct_net: e.correctNet, status: problems.length ? 'incomplete' : 'draft', problems, payload: e,
  });
}

/* ---------------- request schemas ---------------- */

const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['incomplete', 'draft', 'generated', 'signed', 'sent_manual', 'sent_sp', 'cancelled', 'replaced', 'open', 'sent']).optional().or(z.literal('')),
  kind: z.enum(['invoice', 'credit', 'debit']).optional().or(z.literal('')),
  from: s.isoDate.optional().or(z.literal('')),
  to: s.isoDate.optional().or(z.literal('')),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
const IdParam = z.object({ id: s.uuid });
const BuyerInput = z.object({
  buyerName: z.string().trim().min(1).max(256).optional(),
  buyerTaxId: z.string().trim().max(20).nullable().optional().or(z.literal('')),
  buyerBranch: z.string().trim().max(10).nullable().optional().or(z.literal('')),
  buyerAddress: z.string().trim().max(512).nullable().optional().or(z.literal('')),
  buyerEmail: z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
});
const GenerateInput = z.object({
  typeCode: z.enum(['388', 'T02']).optional().or(z.literal('')),
  purposeCode: z.string().trim().max(10).optional().or(z.literal('')),
}).default({});
const CancelInput = z.object({ reason: z.string().trim().min(3, 'ระบุเหตุผลอย่างน้อย 3 ตัวอักษร').max(500) });
const ReplaceInput = BuyerInput.extend({
  purposeCode: z.enum(['TIVC01', 'TIVC02', 'TIVC99']),
  reason: z.string().trim().max(256).optional().or(z.literal('')),
  docNo: z.string().trim().max(50).regex(/^[\w./-]+$/, 'ใช้ตัวอักษร ตัวเลข - / . _ เท่านั้น').optional().or(z.literal('')),
  issueDate: s.isoDate.optional().or(z.literal('')),
});
const SignInput = z.object({ password: z.string().max(200).optional().or(z.literal('')) }).default({});
const SentInput = z.object({
  channel: z.enum(['email_etda', 'service_provider']),
  sentDate: s.isoDate.optional().or(z.literal('')),
  reference: z.string().trim().max(200).optional().or(z.literal('')),
  note: z.string().trim().max(1000).optional().or(z.literal('')),
});

const unprocessable = (message: string, details?: unknown) => new HttpError(422, 'unprocessable', message, details);

function signerPassword(k: { env: NodeJS.ProcessEnv }, given?: string): string {
  const pw = given || k.env.ETAX_P12_PASSWORD;
  if (!pw) throw badRequest('กรุณากรอกรหัสผ่านใบรับรอง (.p12) — ระบบไม่เก็บรหัสผ่าน', { fieldErrors: { password: ['ต้องกรอก'] } });
  return pw;
}

function readCert(file: Buffer, password: string) {
  try {
    return readPkcs12(file, password);
  } catch (e) {
    if (e instanceof Pkcs12Error) throw badRequest(e.message, { fieldErrors: { password: [e.message] } });
    throw badRequest('อ่านไฟล์ใบรับรองไม่ได้ — ต้องเป็นไฟล์ .p12 / .pfx');
  }
}

/** A replacement that was cancelled before it was sent: the document it was going to replace is "sent" again. */
async function reopenReplaced(c: Client, originalId: string, replacementId: string) {
  await c.query(
    `update etax_documents set status = case sent_channel when 'email_etda' then 'sent_manual' else 'sent_sp' end,
       replaced_by_id = null, replaced_by_no = null, updated_at = now()
     where id = $1 and status = 'replaced' and replaced_by_id = $2`,
    [originalId, replacementId],
  );
}

const canRead = (a: AuthContext) => hasPerm(a, READ) || hasPerm(a, WRITE) || hasPerm(a, SETTINGS);

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  // generated XML files (download) + proof of delivery the user attaches (ETDA e-mail receipt, SP acknowledgement)
  attachments: {
    read: READ,
    write: WRITE,
    entities: { document: 'etax_documents' },
  },
  handlers: {
    'sales.invoiced': async (e, { client }) => snapshotInvoice(client, e),
    'sales.note_issued': async (e, { client }) => snapshotNote(client, e),
  },
  routes(app, k) {
    /* ---------------- settings (seller profile + certificate) ---------------- */

    app.get('/settings', async (req) => {
      const a = auth(req);
      if (!canRead(a)) requirePerm(a, SETTINGS);
      return k.db.tx(a.tenantId, async (c) => settingsView(await loadSettings(c), k.env));
    });

    app.put('/settings', async (req) => {
      const a = auth(req);
      requirePerm(a, SETTINGS);
      const b = parse(SettingsInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await c.query(
          `insert into etax_settings (seller_name, tax_id, branch, building_number, address_line1, address_line2, subdistrict, subdistrict_code,
             district, district_code, province, province_code, postcode, email, phone, invoice_type_code, updated_by_name)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           on conflict (tenant_id) do update set seller_name = excluded.seller_name, tax_id = excluded.tax_id, branch = excluded.branch,
             building_number = excluded.building_number, address_line1 = excluded.address_line1, address_line2 = excluded.address_line2,
             subdistrict = excluded.subdistrict, subdistrict_code = excluded.subdistrict_code, district = excluded.district,
             district_code = excluded.district_code, province = excluded.province, province_code = excluded.province_code,
             postcode = excluded.postcode, email = excluded.email, phone = excluded.phone, invoice_type_code = excluded.invoice_type_code,
             updated_by_name = excluded.updated_by_name, updated_at = now()`,
          [b.sellerName, b.taxId, b.branch, b.buildingNumber || null, b.addressLine1, b.addressLine2 || null, b.subdistrict || null, b.subdistrictCode || null,
            b.district || null, b.districtCode || null, b.province || null, b.provinceCode || null, b.postcode, b.email || null, b.phone || null,
            b.invoiceTypeCode, a.userName ?? null],
        );
        return settingsView(await loadSettings(c), k.env);
      });
    });

    app.post('/settings/certificate', { bodyLimit: Math.ceil(P12_MAX_BYTES / 3) * 4 + 16 * 1024 }, async (req) => {
      const a = auth(req);
      requirePerm(a, SETTINGS);
      const b = parse(CertificateInput, req.body);
      const raw = b.dataBase64.replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.length % 4 !== 0) throw badRequest('ข้อมูลไฟล์ (base64) ไม่ถูกต้อง', { fieldErrors: { dataBase64: ['base64 ไม่ถูกต้อง'] } });
      const file = Buffer.from(raw, 'base64');
      if (!file.length || file.length > P12_MAX_BYTES) throw badRequest(`ไฟล์ใบรับรองต้องไม่ว่างและไม่เกิน ${P12_MAX_BYTES / 1024} KB`);
      // the password only proves the file opens; it is used in memory and discarded
      const p12 = readCert(file, signerPassword(k, b.password));
      const info = certificateInfo(p12.certificate);
      if (new Date(info.notAfter) < now()) throw badRequest(`ใบรับรองหมดอายุแล้ว (${info.notAfter.slice(0, 10)})`);
      return k.db.tx(a.tenantId, async (c) => {
        const cur = await loadSettings(c);
        if (!cur) throw conflict('บันทึกข้อมูลผู้ขายก่อน แล้วจึงอัปโหลดใบรับรอง');
        await c.query(
          `update etax_settings set p12 = $1, p12_file_name = $2, cert_subject = $3, cert_issuer = $4, cert_serial = $5, cert_not_before = $6,
             cert_not_after = $7, cert_fingerprint = $8, cert_uploaded_at = now(), cert_uploaded_by_name = $9, updated_at = now()`,
          [file, b.fileName || 'certificate.p12', info.subject, info.issuer, info.serial, info.notBefore, info.notAfter, info.fingerprint256, a.userName ?? null],
        );
        const v = settingsView(await loadSettings(c), k.env);
        return { ...v, warnings: v.cert_warnings };
      });
    });

    app.delete('/settings/certificate', async (req) => {
      const a = auth(req);
      requirePerm(a, SETTINGS);
      return k.db.tx(a.tenantId, async (c) => {
        await c.query(`update etax_settings set p12 = null, p12_file_name = null, cert_subject = null, cert_issuer = null, cert_serial = null,
          cert_not_before = null, cert_not_after = null, cert_fingerprint = null, cert_uploaded_at = null, cert_uploaded_by_name = null, updated_at = now()`);
        return settingsView(await loadSettings(c), k.env);
      });
    });

    app.get('/meta', async (req) => {
      const a = auth(req);
      if (!canRead(a)) requirePerm(a, READ);
      return { statuses: STATUS_TH, kinds: KIND_TH, typeCodes: TYPE_NAMES, purposeCodes: PURPOSE_CODES, channels: CHANNEL_TH, help: DELIVERY_HELP };
    });

    /* ---------------- documents ---------------- */

    app.get('/documents', async (req) => {
      const a = auth(req);
      requirePerm(a, READ);
      const q = parse(ListQuery, req.query);
      const status = q.status === 'open' ? ['draft', 'generated', 'signed'] : q.status === 'sent' ? ['sent_manual', 'sent_sp'] : q.status ? [q.status] : null;
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select ${LIST_COLS} from etax_documents
         where ($1::text[] is null or status = any($1)) and ($2::text is null or kind = $2)
           and ($3::date is null or issue_date >= $3) and ($4::date is null or issue_date <= $4)
           and ($5::text is null or doc_no ilike '%' || $5 || '%' or buyer_name ilike '%' || $5 || '%' or ref_invoice_no ilike '%' || $5 || '%')
         order by issue_date desc, doc_no desc limit $6`,
        [status, q.kind || null, q.from || null, q.to || null, q.q || null, q.limit],
      )).rows.map((r) => ({ ...r, kind_label: KIND_TH[r.kind], status_label: STATUS_TH[r.status] })));
    });

    app.get('/documents/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, READ);
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => view(await loadDoc(c, id)));
    });

    /** Download the XML (`?signed=1` = the signed file). The UI offers the same files in the attachments panel. */
    app.get('/documents/:id/xml', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, READ);
      const { id } = parse(IdParam, req.params);
      const signed = ['1', 'true'].includes(String((req.query as any)?.signed ?? ''));
      const r = await k.db.tx(a.tenantId, (c) => loadDoc(c, id));
      const xml = signed ? r.signed_xml : r.xml;
      if (!xml) throw conflict(signed ? 'เอกสารนี้ยังไม่ได้ลงลายมือชื่อ' : 'ยังไม่ได้สร้าง XML');
      const name = `${safeName(r.doc_no)}${signed ? '-signed' : ''}.xml`;
      reply.header('content-type', 'application/xml; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`).header('x-content-type-options', 'nosniff');
      return signed ? xml : XML_DECL + xml;
    });

    /** Re-check the stored files: structure + totals of the XML, and the signature (digests, RSA value, signing certificate). */
    app.get('/documents/:id/verification', async (req) => {
      const a = auth(req);
      requirePerm(a, READ);
      const { id } = parse(IdParam, req.params);
      const r = await k.db.tx(a.tenantId, (c) => loadDoc(c, id));
      if (!r.xml) throw conflict('ยังไม่ได้สร้าง XML');
      const structure = checkEtaxXml(r.signed_xml ?? r.xml);
      const signature = r.signed_xml ? verifyXadesSignature(r.signed_xml) : null;
      const ok = structure.ok && (!signature || signature.valid);
      return {
        ok, structure, signature,
        summary: ok ? (signature ? 'โครงสร้างและยอดรวมถูกต้อง ลายมือชื่อดิจิทัลถูกต้อง' : 'โครงสร้างและยอดรวมถูกต้อง (ยังไม่ได้ลงลายมือชื่อ)')
          : [...structure.errors, ...(signature?.errors ?? [])].join(' · '),
        note: 'ตรวจด้วยตัวตรวจในระบบเท่านั้น — ก่อนใช้งานจริงควรตรวจไฟล์กับเครื่องมือตรวจสอบของ สพธอ. (ETDA) อีกครั้ง',
      };
    });

    app.patch('/documents/:id/buyer', async (req) => {
      const a = auth(req);
      requirePerm(a, WRITE);
      const { id } = parse(IdParam, req.params);
      const b = parse(BuyerInput, req.body);
      if (b.buyerTaxId && !isValidThaiTaxId(b.buyerTaxId)) throw badRequest('เลขประจำตัวผู้เสียภาษีของผู้ซื้อไม่ถูกต้อง', { fieldErrors: { buyerTaxId: ['13 หลัก / เลขตรวจสอบไม่ถูกต้อง'] } });
      if (b.buyerBranch && !/^\d{5}$/.test(b.buyerBranch)) throw badRequest('รหัสสาขาต้องเป็นตัวเลข 5 หลัก', { fieldErrors: { buyerBranch: ['ตัวเลข 5 หลัก'] } });
      return k.db.tx(a.tenantId, async (c) => {
        const r = await loadDoc(c, id, true);
        if (!TRANSITIONS.editBuyer.includes(r.status)) {
          throw conflict(r.status.startsWith('sent') && r.kind === 'invoice'
            ? 'ส่งเอกสารนี้แล้ว — แก้ข้อมูลผู้ซื้อด้วย "ออกใบกำกับภาษีฉบับใหม่แทน" (TIVC01/TIVC02)'
            : `แก้ข้อมูลผู้ซื้อไม่ได้ในสถานะ "${STATUS_TH[r.status]}"`);
        }
        const pick = <T>(v: T | undefined, cur: T) => (v === undefined ? cur : (v === '' ? null : v));
        await c.query(
          `update etax_documents set buyer_name = $2, buyer_tax_id = $3, buyer_branch = $4, buyer_address = $5, buyer_email = $6, buyer_edited_by_name = $7, buyer_edited_at = now(),
             status = 'draft', xml = null, xml_sha256 = null, generated_at = null, signed_xml = null, signed_sha256 = null, signed_at = null,
             signing_cert_serial = null, signing_cert_subject = null, problems = '[]', warnings = '[]', updated_at = now()
           where id = $1`,
          [id, b.buyerName ?? r.buyer_name, pick(b.buyerTaxId, r.buyer_tax_id), pick(b.buyerBranch, r.buyer_branch), pick(b.buyerAddress, r.buyer_address),
            pick(b.buyerEmail, r.buyer_email), a.userName ?? null],
        );
        await replaceSystemFiles(c, id, []);
        return view(await loadDoc(c, id));
      });
    });

    app.post('/documents/:id/generate', async (req) => {
      const a = auth(req);
      requirePerm(a, WRITE);
      const { id } = parse(IdParam, req.params);
      const b = parse(GenerateInput, req.body ?? {});
      const out = await k.db.tx(a.tenantId, async (c) => {
        const r = await loadDoc(c, id, true);
        if (r.status === 'incomplete') throw conflict(`สร้าง XML ไม่ได้ — ${(r.problems ?? []).join(' · ') || 'ข้อมูลไม่พอ'}`);
        if (!TRANSITIONS.generate.includes(r.status)) throw conflict(`สร้าง XML ใหม่ไม่ได้ในสถานะ "${STATUS_TH[r.status]}"`);
        const settings = await loadSettings(c);
        const seller = sellerFrom(settings);
        const sp = sellerProblems(seller);
        if (sp.length) throw unprocessable(`ตั้งค่าข้อมูลผู้ขายก่อน: ${sp.join(', ')}`, { problems: sp });
        const defaultType = (settings.invoice_type_code ?? 'T02') as TypeCode;
        // a replacement keeps the replaced document's type unless the user picks one
        const typeCode: TypeCode = r.kind === 'credit' ? '81' : r.kind === 'debit' ? '80' : ((b.typeCode || r.replaces_type_code || defaultType) as TypeCode);
        let refType = defaultType;
        if (r.ref_invoice_id) {
          const orig = (await c.query(`select type_code from etax_documents where source = 'invoice' and source_id = $1`, [r.ref_invoice_id])).rows[0];
          if (orig?.type_code) refType = orig.type_code;
        }
        const usesPurpose = isNote(typeCode) || !!r.replaces_id;
        if (b.purposeCode && (!usesPurpose || !PURPOSE_CODES.some((p) => p.code === b.purposeCode && p.kind === purposeKindOf(typeCode)))) {
          throw badRequest(`รหัสเหตุผล ${b.purposeCode} ใช้กับ${TYPE_NAMES[typeCode]}${r.replaces_id ? 'ที่ออกแทน' : ''}ไม่ได้`, { fieldErrors: { purposeCode: ['ไม่ตรงกับประเภทเอกสาร'] } });
        }
        const purposeCode = usesPurpose ? (b.purposeCode || r.purpose_code || defaultPurposeCode(typeCode)) : null;
        const res = buildEtaxXml(snapshotOf(r, refType), seller!, { typeCode, createdAt: bangkok(), purposeCode });
        if (res.problems.length) {
          await c.query(`update etax_documents set problems = $2, warnings = $3, updated_at = now() where id = $1`, [id, JSON.stringify(res.problems), JSON.stringify(res.warnings)]);
          return { error: res.problems };
        }
        await c.query(
          `update etax_documents set status = 'generated', type_code = $2, purpose_code = $3, xml = $4, xml_sha256 = $5, generated_at = now(), generated_by_name = $6,
             signed_xml = null, signed_sha256 = null, signed_at = null, signing_cert_serial = null, signing_cert_subject = null,
             problems = '[]', warnings = $7, updated_at = now() where id = $1`,
          [id, typeCode, purposeCode, res.xml,
            createHash('sha256').update(res.xml).digest('hex'), a.userName ?? null, JSON.stringify(res.warnings)],
        );
        await replaceSystemFiles(c, id, [{ name: `${safeName(r.doc_no)}.xml`, xml: XML_DECL + res.xml }]);
        return { doc: view(await loadDoc(c, id)) };
      });
      // problems are saved on the document (outside the failed path) so the screen shows why
      if ('error' in out) throw unprocessable(`สร้าง XML ไม่ได้: ${out.error!.join(' · ')}`, { problems: out.error });
      return out.doc;
    });

    app.post('/documents/:id/sign', async (req) => {
      const a = auth(req);
      requirePerm(a, WRITE);
      const { id } = parse(IdParam, req.params);
      const b = parse(SignInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const r = await loadDoc(c, id, true);
        if (!TRANSITIONS.sign.includes(r.status) || !r.xml) throw conflict(r.status === 'draft' || r.status === 'incomplete' ? 'สร้าง XML ก่อนลงลายมือชื่อ' : `ลงลายมือชื่อไม่ได้ในสถานะ "${STATUS_TH[r.status]}"`);
        const settings = await loadSettings(c);
        if (!settings?.p12) throw conflict('ยังไม่ได้อัปโหลดใบรับรองดิจิทัล (.p12) ในตั้งค่า e-Tax');
        const p12 = readCert(settings.p12, signerPassword(k, b.password));
        if (new Date(p12.certificate.validTo) < now()) throw conflict('ใบรับรองหมดอายุแล้ว — อัปโหลดใบรับรองใหม่');
        if (new Date(p12.certificate.validFrom) > now()) throw conflict('ใบรับรองยังไม่เริ่มใช้งาน');
        const typeCode = r.type_code as TypeCode;
        const ns = namespacesFor(typeCode);
        const root = parseXml(r.xml);
        // the stored XML is our own exclusive-c14n output; refuse to sign anything else (e.g. edited by hand in the database)
        if (serialize(root, ns) !== r.xml) throw conflict('XML ที่เก็บไว้ไม่อยู่ในรูปแบบมาตรฐานของระบบ — สร้าง XML ใหม่ก่อนลงลายมือชื่อ');
        const signed = xadesBesSigner(p12.privateKey, p12.certificate, p12.chain).sign(root, ns, { signingTime: `${bangkok()}+07:00` });
        const check = verifyXadesSignature(signed.xml, { fingerprint256: p12.certificate.fingerprint256 });
        if (!check.valid) throw new HttpError(500, 'internal', `ตรวจลายมือชื่อที่สร้างไม่ผ่าน: ${check.errors.join(', ')}`);
        await c.query(
          `update etax_documents set status = 'signed', signed_xml = $2, signed_sha256 = $3, signed_at = now(), signed_by_name = $4,
             signing_cert_serial = $5, signing_cert_subject = $6, updated_at = now() where id = $1`,
          [id, signed.xml, createHash('sha256').update(signed.xml).digest('hex'), a.userName ?? null, signed.certificate.serial, signed.certificate.subject],
        );
        await replaceSystemFiles(c, id, [
          { name: `${safeName(r.doc_no)}.xml`, xml: XML_DECL + r.xml },
          { name: `${safeName(r.doc_no)}-signed.xml`, xml: signed.xml },
        ]);
        return view(await loadDoc(c, id));
      });
    });

    /** Record that the user delivered the document outside this module. Nothing is sent from here. */
    app.post('/documents/:id/mark-sent', async (req) => {
      const a = auth(req);
      requirePerm(a, WRITE);
      const { id } = parse(IdParam, req.params);
      const b = parse(SentInput, req.body);
      const sentDate = b.sentDate || bangkok().slice(0, 10);
      if (sentDate > bangkok().slice(0, 10)) throw badRequest('วันที่ส่งต้องไม่เป็นวันในอนาคต', { fieldErrors: { sentDate: ['วันในอนาคต'] } });
      return k.db.tx(a.tenantId, async (c) => {
        const r = await loadDoc(c, id, true);
        if (!TRANSITIONS.markSent.includes(r.status)) {
          throw conflict(r.status.startsWith('sent') ? 'บันทึกว่าส่งแล้ว' : ['draft', 'incomplete'].includes(r.status) ? 'สร้าง XML ก่อนบันทึกการส่ง' : `บันทึกการส่งไม่ได้ในสถานะ "${STATUS_TH[r.status]}"`);
        }
        if (sentDate < r.issue_date) throw badRequest('วันที่ส่งต้องไม่ก่อนวันที่ออกเอกสาร', { fieldErrors: { sentDate: ['ก่อนวันที่เอกสาร'] } });
        await c.query(
          `update etax_documents set status = $2, sent_channel = $3, sent_date = $4, sent_reference = $5, sent_note = $6, sent_recorded_at = now(),
             sent_by_name = $7, updated_at = now() where id = $1`,
          [id, b.channel === 'email_etda' ? 'sent_manual' : 'sent_sp', b.channel, sentDate, b.reference || null, b.note || null, a.userName ?? null],
        );
        return view(await loadDoc(c, id));
      });
    });

    app.post('/documents/:id/unmark-sent', async (req) => {
      const a = auth(req);
      requirePerm(a, WRITE);
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const r = await loadDoc(c, id, true);
        if (!TRANSITIONS.unmarkSent.includes(r.status)) {
          throw conflict(r.status === 'replaced' ? `เอกสารนี้ถูกแทนที่ด้วย ${r.replaced_by_no} แล้ว — ยกเลิกการบันทึกส่งไม่ได้` : 'เอกสารนี้ยังไม่ได้บันทึกว่าส่ง');
        }
        await c.query(
          `update etax_documents set status = $2, sent_channel = null, sent_date = null, sent_reference = null, sent_note = null,
             sent_recorded_at = null, sent_by_name = null, updated_at = now() where id = $1`,
          [id, r.signed_xml ? 'signed' : 'generated'],
        );
        return view(await loadDoc(c, id));
      });
    });

    /**
     * Cancel inside this module: the document will not be issued as e-Tax from here (paper tax invoice instead, duplicate, …).
     * Only before it is recorded as sent — a delivered e-Tax invoice is corrected with a replacement (TIVC…) or a credit/debit
     * note, never cancelled silently. Does not touch the tax invoice in Sales. Cancelling an unsent replacement re-opens the
     * document it was going to replace.
     */
    app.post('/documents/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, WRITE);
      const { id } = parse(IdParam, req.params);
      const b = parse(CancelInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const r = await loadDoc(c, id, true);
        if (!TRANSITIONS.cancel.includes(r.status)) {
          throw conflict(r.status.startsWith('sent')
            ? 'ส่งเอกสารนี้แล้ว ยกเลิกไม่ได้ — ออกใบกำกับภาษีฉบับใหม่แทน (แก้ชื่อ/ที่อยู่) หรือออกใบลดหนี้/ใบเพิ่มหนี้ในโมดูลขาย (แก้ยอดเงิน)'
            : `ยกเลิกไม่ได้ในสถานะ "${STATUS_TH[r.status]}"`);
        }
        await c.query(
          `update etax_documents set status = 'cancelled', cancel_reason = $2, cancelled_at = now(), cancelled_by_name = $3,
             xml = null, xml_sha256 = null, generated_at = null, signed_xml = null, signed_sha256 = null, signed_at = null,
             signing_cert_serial = null, signing_cert_subject = null, updated_at = now() where id = $1`,
          [id, b.reason, a.userName ?? null],
        );
        await replaceSystemFiles(c, id, []);
        if (r.replaces_id) await reopenReplaced(c, r.replaces_id, id);
        return view(await loadDoc(c, id));
      });
    });

    /** Undo a cancel (cancelled by mistake): back to draft (or incomplete), XML must be generated again. */
    app.post('/documents/:id/restore', async (req) => {
      const a = auth(req);
      requirePerm(a, WRITE);
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const r = await loadDoc(c, id, true);
        if (!TRANSITIONS.restore.includes(r.status)) throw conflict(`เอกสารนี้ไม่ได้ถูกยกเลิก (สถานะ "${STATUS_TH[r.status]}")`);
        if (r.replaces_id) {
          const orig = await loadDoc(c, r.replaces_id, true);
          if (!TRANSITIONS.replace.includes(orig.status) || orig.replaced_by_id) {
            throw conflict(`ฉบับเดิม ${orig.doc_no} อยู่ในสถานะ "${STATUS_TH[orig.status]}" — นำฉบับแทนนี้กลับมาไม่ได้`);
          }
          await c.query(`update etax_documents set status = 'replaced', replaced_by_id = $2, replaced_by_no = $3, updated_at = now() where id = $1`, [orig.id, id, r.doc_no]);
        }
        const incomplete = toLines(r.lines) === null || (r.problems ?? []).some((p: string) => p.startsWith('ข้อมูลไม่พอ'));
        await c.query(
          `update etax_documents set status = $2, cancel_reason = null, cancelled_at = null, cancelled_by_name = null, updated_at = now() where id = $1`,
          [id, incomplete ? 'incomplete' : 'draft'],
        );
        return view(await loadDoc(c, id));
      });
    });

    /**
     * ออกใบกำกับภาษีฉบับใหม่แทนฉบับเดิม: a delivered tax invoice had wrong non-amount data (buyer name / address …).
     * Creates a NEW e-Tax document (same lines and amounts, corrected buyer) with ETDA PurposeCode TIVC01 (ชื่อผิด) / TIVC02
     * (ที่อยู่ผิด) / TIVC99 (เหตุอื่น) and an AdditionalReferencedDocument pointing at the original; the original becomes `replaced`.
     * Amounts cannot change here — that is a credit / debit note (มาตรา 86/9, 86/10) issued in Sales.
     * Number / date conventions of the replacement (new number vs. suffix, date of the original vs. today) — CHECK with your
     * accountant / service provider; the user may type both.
     */
    app.post('/documents/:id/replace', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, WRITE);
      const { id } = parse(IdParam, req.params);
      const b = parse(ReplaceInput, req.body);
      if (b.buyerTaxId && !isValidThaiTaxId(b.buyerTaxId)) throw badRequest('เลขประจำตัวผู้เสียภาษีของผู้ซื้อไม่ถูกต้อง', { fieldErrors: { buyerTaxId: ['13 หลัก / เลขตรวจสอบไม่ถูกต้อง'] } });
      if (b.buyerBranch && !/^\d{5}$/.test(b.buyerBranch)) throw badRequest('รหัสสาขาต้องเป็นตัวเลข 5 หลัก', { fieldErrors: { buyerBranch: ['ตัวเลข 5 หลัก'] } });
      const today = bangkok().slice(0, 10);
      const issueDate = b.issueDate || today;
      if (issueDate > today) throw badRequest('วันที่ออกเอกสารต้องไม่เป็นวันในอนาคต', { fieldErrors: { issueDate: ['วันในอนาคต'] } });
      return k.db.tx(a.tenantId, async (c) => {
        const r = await loadDoc(c, id, true);
        if (r.kind !== 'invoice') throw conflict('ออกฉบับแทนได้เฉพาะใบกำกับภาษี — ใบลดหนี้/ใบเพิ่มหนี้ที่ผิดให้ออกเอกสารใหม่ในโมดูลขาย');
        if (r.replaced_by_id) throw conflict(`เอกสารนี้ถูกแทนที่ด้วย ${r.replaced_by_no} แล้ว`);
        if (!TRANSITIONS.replace.includes(r.status)) {
          throw conflict(`ออกฉบับแทนได้เฉพาะเอกสารที่บันทึกว่าส่งแล้ว — ยังไม่ได้ส่ง ให้ใช้ "แก้ข้อมูลผู้ซื้อ" แทน (สถานะ "${STATUS_TH[r.status]}")`);
        }
        if (issueDate < r.issue_date) throw badRequest('วันที่ฉบับใหม่ต้องไม่ก่อนวันที่ฉบับเดิม', { fieldErrors: { issueDate: ['ก่อนวันที่ฉบับเดิม'] } });
        const pick = <T>(v: T | undefined, cur: T) => (v === undefined ? cur : (v === '' ? null : v));
        const buyer = {
          name: b.buyerName ?? r.buyer_name, taxId: pick(b.buyerTaxId, r.buyer_tax_id), branch: pick(b.buyerBranch, r.buyer_branch),
          address: pick(b.buyerAddress, r.buyer_address), email: pick(b.buyerEmail, r.buyer_email),
        };
        const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
        // the purpose code must describe a real correction
        if (b.purposeCode === 'TIVC01' && norm(buyer.name) === norm(r.buyer_name)) throw badRequest('TIVC01 (ชื่อผิด): กรอกชื่อผู้ซื้อที่ถูกต้อง', { fieldErrors: { buyerName: ['ชื่อเหมือนฉบับเดิม'] } });
        if (b.purposeCode === 'TIVC02' && norm(buyer.address) === norm(r.buyer_address)) throw badRequest('TIVC02 (ที่อยู่ผิด): กรอกที่อยู่ที่ถูกต้อง', { fieldErrors: { buyerAddress: ['ที่อยู่เหมือนฉบับเดิม'] } });
        if (b.purposeCode === 'TIVC99' && (b.reason ?? '').length < 3) throw badRequest('TIVC99 (เหตุอื่น): ระบุเหตุผล', { fieldErrors: { reason: ['ต้องกรอก'] } });
        const root = r.doc_no.replace(/-R\d+$/, '');
        const taken = (await c.query(`select doc_no from etax_documents where replaces_id is not null and starts_with(doc_no, $1)`, [`${root}-R`])).rows
          .map((x) => /-R(\d+)$/.exec(x.doc_no.slice(root.length))?.[1]).filter(Boolean).map(Number);
        const n = taken.length ? Math.max(...taken) : 0;
        const docNo = b.docNo || `${root}-R${n + 1}`;
        const dup = (await c.query(`select doc_no from etax_documents where kind = 'invoice' and doc_no = $1 and status <> 'cancelled' limit 1`, [docNo])).rows[0];
        if (dup) throw conflict(`มีเอกสาร e-Tax เลขที่ ${docNo} อยู่แล้ว — ระบุเลขที่อื่น`);
        const newId = randomUUID();
        const reason = b.reason || PURPOSE_CODES.find((p) => p.code === b.purposeCode)!.label;
        await c.query(
          `insert into etax_documents (id, source, source_id, kind, doc_no, issue_date, due_date, buyer_id, buyer_name, buyer_tax_id, buyer_branch,
             buyer_address, buyer_email, buyer_edited_by_name, buyer_edited_at, lines, net, vat, gross, vat_mode, deposit, reason, purpose_code,
             replaces_id, replaces_no, replaces_date, replaces_type_code, status, payload)
           values ($1, 'replacement', $1, 'invoice', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12, $13, $14, $15, $16, $17, $18, $19,
             $20, $21, $22, $23, 'draft', $24)`,
          [newId, docNo, issueDate, r.due_date, r.buyer_id, buyer.name, buyer.taxId, buyer.branch, buyer.address, buyer.email, a.userName ?? null,
            JSON.stringify(r.lines), r.net, r.vat, r.gross, r.vat_mode, r.deposit === null ? null : JSON.stringify(r.deposit), reason, b.purposeCode,
            r.id, r.doc_no, r.issue_date, r.type_code ?? 'T02', JSON.stringify({ replaces: r.id, source: r.source, sourceId: r.source_id })],
        );
        await c.query(`update etax_documents set status = 'replaced', replaced_by_id = $2, replaced_by_no = $3, updated_at = now() where id = $1`, [r.id, newId, docNo]);
        reply.code(201);
        return view(await loadDoc(c, newId));
      });
    });

    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, READ);
      return k.db.tx(a.tenantId, async (c) => {
        const r = (await c.query(
          `select count(*) filter (where status = 'incomplete')::int as incomplete, count(*) filter (where status = 'draft')::int as draft,
                  count(*) filter (where status in ('generated', 'signed'))::int as ready, count(*) filter (where status in ('sent_manual', 'sent_sp'))::int as sent
           from etax_documents`,
        )).rows[0];
        return r;
      });
    });
  },
};
