/**
 * Thai e-Tax Invoice XML per ETDA ขมธอ. 3-2560 (มาตรฐานข้อความอิเล็กทรอนิกส์สำหรับใบกำกับภาษีอิเล็กทรอนิกส์, ver. 2.0),
 * a profile of UN/CEFACT Cross Industry Invoice (CII) D16B.
 *
 * Legal basis
 *   - ประมวลรัษฎากร มาตรา 86/4 (รายการในใบกำกับภาษีแบบเต็ม), 86/9 (ใบเพิ่มหนี้), 86/10 (ใบลดหนี้)
 *   - ประกาศอธิบดีกรมสรรพากร เกี่ยวกับภาษีมูลค่าเพิ่ม (ฉบับที่ 196) เรื่อง หลักเกณฑ์ วิธีการ และเงื่อนไขการจัดทำ ส่งมอบ และเก็บรักษา
 *     ใบกำกับภาษีอิเล็กทรอนิกส์ ใบเพิ่มหนี้อิเล็กทรอนิกส์ และใบลดหนี้อิเล็กทรอนิกส์ — e-Tax Invoice must follow the ETDA standard and be
 *     signed with the seller's digital certificate (or go through e-Tax Invoice by Email / a service provider).
 *   - พ.ร.บ.ว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544 มาตรา 26 (ลายมือชื่ออิเล็กทรอนิกส์ที่เชื่อถือได้)
 *
 * ELEMENT MAPPING (what this generator writes, in schema order)
 * ┌──────────────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────┬────────┐
 * │ XML path (prefix rsm = document, ram = reusable entities)                    │ source                                   │ conf.  │
 * ├──────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────┼────────┤
 * │ rsm:TaxInvoice_CrossIndustryInvoice (388/T02) / rsm:DebitCreditNote_… (80/81) │ type code                                │ high   │
 * │ …ExchangedDocumentContext/GuidelineSpecifiedDocumentContextParameter/ID      │ "ER3-2560" agency ETDA, version v2.0     │ CHECK  │
 * │ rsm:ExchangedDocument/ID, Name, TypeCode, IssueDateTime                      │ doc no, Thai name, code, issue date      │ high   │
 * │   Purpose, PurposeCode (80/81; 388/T02 only when replacing — TIVC01/02/99)   │ reason, CDNG99/DBNG99/TIVC99… code list  │ CHECK  │
 * │   CreationDateTime                                                           │ generation time (Asia/Bangkok)           │ high   │
 * │ …ApplicableHeaderTradeAgreement/SellerTradeParty                             │ module settings (seller profile)         │        │
 * │   Name, SpecifiedTaxRegistration/ID[@schemeID=TXID] = tax ID 13 + branch 5   │ "010556…" + "00000" (18 digits)          │ high   │
 * │   DefinedTradeContact/EmailURIUniversalCommunication/URIID, Telephone…       │ email / phone                            │ medium │
 * │   PostalTradeAddress: PostcodeCode, LineOne, LineTwo, CityName (อำเภอ code),  │ address parts; Thai admin codes when     │ CHECK  │
 * │   CitySubDivisionName (ตำบล code), CountryID[@schemeID=3166-1 alpha-2],       │ given (ETDA requires codes for TH        │        │
 * │   CountrySubDivisionID (จังหวัด code), BuildingNumber                         │ addresses — verify against the schema)   │        │
 * │ …/BuyerTradeParty: Name, SpecifiedTaxRegistration/ID                          │ event snapshot (customer…)               │        │
 * │   schemeID TXID (juristic: 13+branch), NIDN (individual 13), OTHR "N/A"      │                                          │ medium │
 * │   PostalTradeAddress: PostcodeCode (last 5-digit group of the address),      │ free-text address from sales             │ CHECK  │
 * │   LineOne/LineTwo (address text), CountryID TH                               │                                          │        │
 * │ …/AdditionalReferencedDocument (80/81, replacements): IssuerAssignedID,      │ original invoice no/date/type            │ high   │
 * │   ReferenceTypeCode                                                          │                                          │        │
 * │ …ApplicableHeaderTradeDelivery (empty)                                       │ —                                        │ CHECK  │
 * │ …ApplicableHeaderTradeSettlement/InvoiceCurrencyCode[@listID=ISO 4217 3A]    │ THB                                      │ high   │
 * │   ApplicableTradeTax (per VAT rate): TypeCode VAT, CalculatedRate (7.00),     │ satang-exact split, see `settle()`       │ high   │
 * │   BasisAmount, CalculatedAmount                                              │                                          │        │
 * │   SpecifiedTradeAllowanceCharge: ChargeIndicator false, ActualAmount, Reason │ VAT deposit deducted on the invoice      │ CHECK  │
 * │   SpecifiedTradePaymentTerms/DueDateDateTime                                 │ due date                                 │ medium │
 * │   SpecifiedTradeSettlementHeaderMonetarySummation: OriginalInformationAmount │ 80/81: value on the original invoice     │ high   │
 * │   LineTotalAmount, DifferenceInformationAmount (80/81), AllowanceTotalAmount,│ Σ lines, difference, deposit, 0,         │ high   │
 * │   ChargeTotalAmount, TaxBasisTotalAmount, TaxTotalAmount, GrandTotalAmount   │ net, vat, gross                          │        │
 * │ …IncludedSupplyChainTradeLineItem: AssociatedDocumentLineDocument/LineID,     │ lines                                    │ high   │
 * │   SpecifiedTradeProduct/ID, Name; SpecifiedLineTradeAgreement/               │ item code, description, unit price       │        │
 * │   GrossPriceProductTradePrice/ChargeAmount; SpecifiedLineTradeDelivery/       │ (ex-VAT), qty + UN/ECE rec.20 unit code  │ CHECK  │
 * │   BilledQuantity[@unitCode]; SpecifiedLineTradeSettlement/ApplicableTradeTax, │ line VAT (allocated), line discount,     │ medium │
 * │   SpecifiedTradeAllowanceCharge, …LineMonetarySummation/TaxTotalAmount,       │ net / incl. VAT                          │        │
 * │   NetLineTotalAmount, NetIncludingTaxesLineTotalAmount                       │                                          │        │
 * │ ds:Signature (last child of the root, XAdES-BES enveloped — see xades.ts)    │ seller's certificate                     │ CHECK  │
 * └──────────────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────┴────────┘
 * "CHECK" = written from the published standard as we understand it but NOT validated against ETDA's official XSD /
 * schematron or the ETDA e-Tax validation service from this repo. Before production use, run a generated file through
 * ETDA's validator (https://validation.teda.th or the current ETDA e-Tax validation tool) and fix any element order /
 * code-list mismatch here. The namespaces, root names and the guideline ID are the most likely items to need an update
 * when ETDA revises the schema.
 */
import { isValidThaiTaxId } from '@erp/thai';
import { el, find, findAll, parseXml, serialize, textOf, type XmlElement } from './xml.ts';

export type TypeCode = '388' | 'T02' | '80' | '81';
export const TYPE_NAMES: Record<TypeCode, string> = {
  '388': 'ใบกำกับภาษี',
  T02: 'ใบแจ้งหนี้/ใบกำกับภาษี',
  '80': 'ใบเพิ่มหนี้',
  '81': 'ใบลดหนี้',
};

export const NS = {
  taxInvoice: {
    rsm: 'urn:etda:uncefact:data:standard:TaxInvoice_CrossIndustryInvoice:2',
    ram: 'urn:etda:uncefact:data:standard:TaxInvoice_ReusableAggregateBusinessInformationEntity:2',
  },
  debitCreditNote: {
    rsm: 'urn:etda:uncefact:data:standard:DebitCreditNote_CrossIndustryInvoice:2',
    ram: 'urn:etda:uncefact:data:standard:DebitCreditNote_ReusableAggregateBusinessInformationEntity:2',
  },
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  xades: 'http://uri.etsi.org/01903/v1.3.2#',
};

export const GUIDELINE = { id: 'ER3-2560', agency: 'ETDA', version: 'v2.0' };

export const isNote = (t: TypeCode) => t === '80' || t === '81';
export const rootName = (t: TypeCode) => (isNote(t) ? 'rsm:DebitCreditNote_CrossIndustryInvoice' : 'rsm:TaxInvoice_CrossIndustryInvoice');
export const namespacesFor = (t: TypeCode): Record<string, string> => ({ ...(isNote(t) ? NS.debitCreditNote : NS.taxInvoice), ds: NS.ds, xades: NS.xades });

/**
 * ETDA purpose codes (code list "Purpose Code" of ขมธอ. 3-2560) — CHECK against the current ETDA list.
 * CDN/DBN = credit / debit notes: G = goods (สินค้า), S = services (บริการ); 99 = other reason (the free-text `Purpose` then
 * carries the reason). TIVC = a tax invoice issued to REPLACE (ยกเลิกและออกฉบับใหม่แทน) one already delivered, for errors that do
 * not change the amounts (name, address …) — amount errors are corrected with a credit/debit note (มาตรา 86/9, 86/10) instead.
 */
export type PurposeKind = 'credit' | 'debit' | 'invoice';
export const PURPOSE_CODES: { code: string; kind: PurposeKind; label: string }[] = [
  { code: 'CDNG01', kind: 'credit', label: 'ลดราคาสินค้าที่ขาย (สินค้าผิดข้อกำหนดที่ตกลงกัน)' },
  { code: 'CDNG02', kind: 'credit', label: 'สินค้าชำรุดเสียหาย' },
  { code: 'CDNG03', kind: 'credit', label: 'สินค้าขาดจำนวนตามที่ตกลงซื้อขาย' },
  { code: 'CDNG04', kind: 'credit', label: 'คำนวณราคาสินค้าผิดพลาดสูงกว่าที่เป็นจริง' },
  { code: 'CDNG05', kind: 'credit', label: 'รับคืนสินค้า (ไม่ตรงตามคำพรรณนา)' },
  { code: 'CDNG99', kind: 'credit', label: 'เหตุอื่น (สินค้า)' },
  { code: 'CDNS01', kind: 'credit', label: 'ลดราคาค่าบริการ (บริการผิดข้อกำหนดที่ตกลงกัน)' },
  { code: 'CDNS02', kind: 'credit', label: 'ค่าบริการขาดจำนวน' },
  { code: 'CDNS03', kind: 'credit', label: 'คำนวณราคาค่าบริการผิดพลาดสูงกว่าที่เป็นจริง' },
  { code: 'CDNS04', kind: 'credit', label: 'บอกเลิกสัญญาบริการ' },
  { code: 'CDNS99', kind: 'credit', label: 'เหตุอื่น (บริการ)' },
  { code: 'DBNG01', kind: 'debit', label: 'มีการเพิ่มราคาค่าสินค้า (สินค้าเกินกว่าจำนวนที่ตกลงกัน)' },
  { code: 'DBNG02', kind: 'debit', label: 'คำนวณราคาสินค้าผิดพลาดต่ำกว่าที่เป็นจริง' },
  { code: 'DBNG99', kind: 'debit', label: 'เหตุอื่น (สินค้า)' },
  { code: 'DBNS01', kind: 'debit', label: 'การเพิ่มราคาค่าบริการ (บริการเกินกว่าข้อกำหนดที่ตกลงกัน)' },
  { code: 'DBNS02', kind: 'debit', label: 'คำนวณราคาค่าบริการผิดพลาดต่ำกว่าที่เป็นจริง' },
  { code: 'DBNS99', kind: 'debit', label: 'เหตุอื่น (บริการ)' },
  { code: 'TIVC01', kind: 'invoice', label: 'ชื่อผิด' },
  { code: 'TIVC02', kind: 'invoice', label: 'ที่อยู่ผิด' },
  { code: 'TIVC99', kind: 'invoice', label: 'เหตุอื่น' },
];
/** which purpose-code family a document type takes */
export const purposeKindOf = (t: TypeCode): PurposeKind => (t === '81' ? 'credit' : t === '80' ? 'debit' : 'invoice');
/** default code when the user picks none: "other reason" of the family */
export const defaultPurposeCode = (t: TypeCode) => (t === '81' ? 'CDNG99' : t === '80' ? 'DBNG99' : 'TIVC99');

/* ---------------- inputs ---------------- */

/** The seller — this module's own settings (never identity's tables). */
export interface SellerProfile {
  name: string;
  taxId: string;
  branch: string;
  email: string | null;
  phone: string | null;
  buildingNumber: string | null;
  addressLine1: string;
  addressLine2: string | null;
  subdistrict: string | null;
  subdistrictCode: string | null;
  district: string | null;
  districtCode: string | null;
  province: string | null;
  provinceCode: string | null;
  postcode: string;
}

export interface BuyerSnapshot {
  name: string;
  taxId: string | null;
  branch: string | null;
  address: string | null;
  email: string | null;
}

export interface LineSnapshot {
  itemCode: string | null;
  description: string;
  qty: number;
  uom: string | null;
  unitPrice: number;
  discount: number;
  amount: number;
  /** 0.07, 0; null = take the document's rate (credit/debit note lines carry none) */
  vatRate: number | null;
}

export interface DocSnapshot {
  kind: 'invoice' | 'credit' | 'debit';
  no: string;
  issueDate: string;
  dueDate: string | null;
  buyer: BuyerSnapshot;
  lines: LineSnapshot[];
  net: number;
  vat: number;
  gross: number;
  /** VAT deposits deducted on this invoice (sales `depositApplied`) */
  deposit: { net: number; vat: number; gross: number; refs: string } | null;
  /** credit/debit notes: the tax invoice being corrected */
  ref: { no: string; date: string; typeCode: TypeCode } | null;
  /** a replacement tax invoice: the delivered document it replaces (ETDA PurposeCode TIVC…) */
  replaces?: { no: string; date: string; typeCode: TypeCode } | null;
  reason: string | null;
  originalNet: number | null;
  correctNet: number | null;
}

/* ---------------- satang-exact amounts ---------------- */

const sat = (x: number) => Math.round(x * 100);
/** "1234.50" from 123450 satang (exact integer formatting, never floating point). */
export function money(s: number): string {
  const neg = s < 0;
  const a = Math.abs(s);
  return `${neg ? '-' : ''}${Math.trunc(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}
/** up to 4 decimals, at least 2 (unit prices, quantities) */
export function decimal(x: number, min = 2): string {
  const s = (Math.round(x * 10000) / 10000).toFixed(4).replace(/0+$/, '');
  const [i, f = ''] = s.split('.');
  return `${i}.${f.padEnd(min, '0')}`;
}
const parseSat = (s: string | undefined): number => {
  if (s === undefined || !/^-?\d+(\.\d{1,4})?$/.test(s.trim())) return Number.NaN;
  return Math.round(Number(s) * 100);
};

export interface Settlement {
  /** per line, satang: amount before VAT, VAT, incl. VAT; unit price before VAT (baht, 4 dp) */
  lines: { net: number; vat: number; gross: number; rate: number; unitPrice: number; discount: number }[];
  groups: { rate: number; basis: number; tax: number }[];
  lineTotal: number;
  allowance: number;
  taxBasis: number;
  taxTotal: number;
  grand: number;
  inclusive: boolean;
  problems: string[];
}

/**
 * Split the document's totals over its lines to the satang. The header figures (net / vat / gross from sales) are the legal
 * ones (they are on the paper tax invoice); lines are fitted to them:
 *  1. line amounts are VAT-exclusive when they sum to net (+ deducted deposit), VAT-inclusive when they sum to gross;
 *     inclusive lines are converted with round(amount / (1 + rate)).
 *  2. a rounding residual of at most 1 satang per line goes to the largest taxable line; more than that = the lines do not
 *     belong to these totals → problem (never "fixed" silently).
 *  3. the VAT (incl. VAT already charged on deducted deposits, §78(1)(ข)) is allocated to taxable lines by largest remainder,
 *     so Σ line VAT = VAT exactly.
 *  4. a deducted deposit is a document-level allowance on the taxable group: basis − deposit net, tax − deposit VAT.
 * Invariants (checked again on the XML by `checkEtaxXml`): Σ line net = LineTotal; LineTotal − Allowance = TaxBasisTotal = net;
 * Σ group tax = TaxTotal = vat; TaxBasisTotal + TaxTotal = GrandTotal = gross.
 */
export function settle(doc: DocSnapshot): Settlement {
  const problems: string[] = [];
  const depNet = sat(doc.deposit?.net ?? 0);
  const depVat = sat(doc.deposit?.vat ?? 0);
  const N = sat(doc.net) + depNet;
  const V = sat(doc.vat) + depVat;
  const G = sat(doc.gross) + sat(doc.deposit?.gross ?? 0);
  const docRate = doc.vat > 0 ? 0.07 : 0;
  const rates = doc.lines.map((l) => l.vatRate ?? docRate);
  const amounts = doc.lines.map((l) => sat(l.amount));
  const sum = amounts.reduce((a, b) => a + b, 0);
  const tol = Math.max(1, doc.lines.length);
  let inclusive = false;
  if (Math.abs(sum - N) <= tol) inclusive = false;
  else if (Math.abs(sum - G) <= tol && G !== N) inclusive = true;
  else problems.push(`ยอดรวมรายการ ${money(sum)} ไม่ตรงกับมูลค่าก่อนภาษี ${money(N)} หรือยอดรวมภาษี ${money(G)} ของเอกสาร`);

  const nets = amounts.map((a, i) => (inclusive ? Math.round(a / (1 + rates[i])) : a));
  const residual = N - nets.reduce((a, b) => a + b, 0);
  if (residual !== 0 && nets.length) {
    if (Math.abs(residual) > tol) problems.push(`ยอดรายการต่างจากมูลค่าก่อนภาษี ${money(residual)} บาท (เกินเศษปัดสตางค์)`);
    let target = 0;
    for (let i = 1; i < nets.length; i++) {
      const better = (rates[i] > 0 && !(rates[target] > 0)) || ((rates[i] > 0) === (rates[target] > 0) && Math.abs(nets[i]) > Math.abs(nets[target]));
      if (better) target = i;
    }
    nets[target] += residual;
  }

  // VAT allocation by largest remainder over taxable lines
  const vats = nets.map(() => 0);
  const taxable = nets.map((n, i) => (rates[i] > 0 ? i : -1)).filter((i) => i >= 0);
  const taxableNet = taxable.reduce((a, i) => a + nets[i], 0);
  if (V !== 0) {
    if (!taxable.length || taxableNet <= 0) problems.push('เอกสารมีภาษีมูลค่าเพิ่มแต่ไม่มีรายการที่เสียภาษี');
    else {
      const raw = taxable.map((i) => (V * nets[i]) / taxableNet);
      const floor = raw.map(Math.floor);
      let left = V - floor.reduce((a, b) => a + b, 0);
      const order = raw.map((r, k) => ({ k, frac: r - floor[k] })).sort((a, b) => b.frac - a.frac || a.k - b.k);
      for (const o of order) { if (left <= 0) break; floor[o.k]++; left--; }
      taxable.forEach((i, k) => { vats[i] = floor[k]; });
    }
  }
  const expectedVat = Math.round(taxableNet * 0.07);
  if (V > 0 && Math.abs(expectedVat - V) > tol + 1 && taxable.every((i) => rates[i] === 0.07)) {
    problems.push(`ภาษีมูลค่าเพิ่ม ${money(V)} ไม่ใช่ 7% ของฐานภาษี ${money(taxableNet)} (ควรเป็น ${money(expectedVat)})`);
  }

  const groupMap = new Map<number, { rate: number; basis: number; tax: number }>();
  nets.forEach((n, i) => {
    const g = groupMap.get(rates[i]) ?? { rate: rates[i], basis: 0, tax: 0 };
    g.basis += n;
    g.tax += vats[i];
    groupMap.set(rates[i], g);
  });
  const groups = [...groupMap.values()].sort((a, b) => b.rate - a.rate);
  if (depNet || depVat) {
    const g = groups.find((x) => (depVat > 0 ? x.rate > 0 : x.rate === 0)) ?? groups[0];
    if (g) { g.basis -= depNet; g.tax -= depVat; }
    if (!g || g.basis < 0 || g.tax < 0) problems.push('เงินมัดจำที่หักมากกว่ามูลค่าของรายการ');
  }
  const lineTotal = nets.reduce((a, b) => a + b, 0);
  const taxBasis = groups.reduce((a, g) => a + g.basis, 0);
  const taxTotal = groups.reduce((a, g) => a + g.tax, 0);
  const grand = taxBasis + taxTotal;
  if (!problems.length) {
    if (taxBasis !== sat(doc.net)) problems.push(`ฐานภาษี ${money(taxBasis)} ไม่เท่ามูลค่าก่อนภาษี ${money(sat(doc.net))}`);
    if (taxTotal !== sat(doc.vat)) problems.push(`ภาษีรวม ${money(taxTotal)} ไม่เท่าภาษีของเอกสาร ${money(sat(doc.vat))}`);
    if (grand !== sat(doc.gross)) problems.push(`มูลค่าก่อนภาษี + ภาษี = ${money(grand)} ไม่เท่ายอดรวม ${money(sat(doc.gross))}`);
  }
  if (doc.kind !== 'invoice' && doc.originalNet !== null && doc.correctNet !== null) {
    const diff = doc.kind === 'credit' ? sat(doc.originalNet) - sat(doc.correctNet) : sat(doc.correctNet) - sat(doc.originalNet);
    if (diff !== sat(doc.net)) problems.push(`ผลต่าง (มูลค่าเดิม ${money(sat(doc.originalNet))} → ที่ถูกต้อง ${money(sat(doc.correctNet))}) ไม่เท่ามูลค่าใน${doc.kind === 'credit' ? 'ใบลดหนี้' : 'ใบเพิ่มหนี้'} ${money(sat(doc.net))}`);
  }

  return {
    lines: nets.map((n, i) => {
      const l = doc.lines[i];
      const unitPrice = inclusive ? l.unitPrice / (1 + rates[i]) : l.unitPrice;
      const discount = inclusive ? Math.round(sat(l.discount) / (1 + rates[i])) : sat(l.discount);
      return { net: n, vat: vats[i], gross: n + vats[i], rate: rates[i], unitPrice, discount };
    }),
    groups, lineTotal, allowance: depNet, taxBasis, taxTotal, grand, inclusive, problems,
  };
}

/* ---------------- parties ---------------- */

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** Buyer tax registration: juristic (starts with 0) → TXID 13+branch; individual → NIDN; none → OTHR "N/A". */
export function buyerRegistration(b: BuyerSnapshot): { scheme: 'TXID' | 'NIDN' | 'OTHR'; id: string; problem?: string } {
  const tax = digits(b.taxId);
  if (!tax) return { scheme: 'OTHR', id: 'N/A' };
  if (!isValidThaiTaxId(tax)) return { scheme: 'OTHR', id: 'N/A', problem: `เลขประจำตัวผู้เสียภาษีของผู้ซื้อ "${b.taxId}" ไม่ถูกต้อง (13 หลัก / เลขตรวจสอบ)` };
  const branch = digits(b.branch) || '00000';
  if (!/^\d{5}$/.test(branch)) return { scheme: 'TXID', id: tax + '00000', problem: `รหัสสาขาของผู้ซื้อ "${b.branch}" ต้องเป็นตัวเลข 5 หลัก` };
  return tax.startsWith('0') ? { scheme: 'TXID', id: tax + branch } : { scheme: 'NIDN', id: tax };
}

/** The last 5-digit group in a Thai address is the postcode ("… กรุงเทพฯ 10110"). */
export function postcodeFrom(address: string | null): string | null {
  const all = [...(address ?? '').matchAll(/(?<!\d)(\d{5})(?!\d)/g)];
  return all.length ? all[all.length - 1][1] : null;
}

export function sellerProblems(s: SellerProfile | null): string[] {
  if (!s) return ['ยังไม่ได้ตั้งค่าข้อมูลผู้ขาย (ตั้งค่า e-Tax)'];
  const p: string[] = [];
  if (!s.name?.trim()) p.push('ไม่มีชื่อผู้ขาย');
  if (!isValidThaiTaxId(digits(s.taxId))) p.push('เลขประจำตัวผู้เสียภาษีของผู้ขายไม่ถูกต้อง');
  if (!/^\d{5}$/.test(s.branch ?? '')) p.push('รหัสสาขาของผู้ขายต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)');
  if (!s.addressLine1?.trim()) p.push('ไม่มีที่อยู่ผู้ขาย');
  if (!/^\d{5}$/.test(s.postcode ?? '')) p.push('รหัสไปรษณีย์ของผู้ขายต้องเป็นตัวเลข 5 หลัก');
  return p;
}

/** UN/ECE Recommendation 20 unit codes for common Thai units — CHECK the code list ETDA accepts; unknown → C62 ("one"). */
export function unitCode(uom: string | null): string {
  const u = (uom ?? '').trim().toLowerCase();
  const map: Record<string, string> = {
    kg: 'KGM', 'กก.': 'KGM', 'กิโลกรัม': 'KGM', g: 'GRM', 'กรัม': 'GRM', ton: 'TNE', 'ตัน': 'TNE',
    l: 'LTR', 'ลิตร': 'LTR', m: 'MTR', 'เมตร': 'MTR', m2: 'MTK', 'ตร.ม.': 'MTK', m3: 'MTQ', 'ลบ.ม.': 'MTQ',
    h: 'HUR', hr: 'HUR', 'ชม.': 'HUR', 'ชั่วโมง': 'HUR', day: 'DAY', 'วัน': 'DAY', month: 'MON', 'เดือน': 'MON',
    set: 'SET', 'ชุด': 'SET', box: 'BX', 'กล่อง': 'BX', pair: 'PR', 'คู่': 'PR',
  };
  return map[u] ?? 'C62';
}

/* ---------------- XML ---------------- */

export interface BuildOptions {
  typeCode: TypeCode;
  /** "YYYY-MM-DDTHH:mm:ss" Asia/Bangkok */
  createdAt: string;
  purposeCode?: string | null;
}

export interface BuildResult {
  /** the unsigned document, exclusive-c14n form (no XML declaration) */
  root: XmlElement;
  xml: string;
  settlement: Settlement;
  problems: string[];
  warnings: string[];
}

/** XML declaration + document. The declaration is not part of the canonical form, so it never affects the signature. */
export const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>\n';

export function buildEtaxXml(doc: DocSnapshot, seller: SellerProfile, o: BuildOptions): BuildResult {
  const t = o.typeCode;
  const problems = [...sellerProblems(seller)];
  const warnings: string[] = [];
  if ((doc.kind === 'invoice') !== !isNote(t)) problems.push(`ประเภทเอกสาร ${t} ไม่ตรงกับเอกสาร (${doc.kind})`);
  if (!doc.lines.length) problems.push('เอกสารไม่มีรายการสินค้า/บริการ');
  const st = settle(doc);
  problems.push(...st.problems);
  const reg = buyerRegistration(doc.buyer);
  if (reg.problem) problems.push(reg.problem);
  const buyerPostcode = postcodeFrom(doc.buyer.address);
  if (!doc.buyer.address?.trim()) problems.push('ไม่มีที่อยู่ผู้ซื้อ (มาตรา 86/4 ต้องระบุ) — แก้ข้อมูลผู้ซื้อก่อนสร้าง XML');
  else if (!buyerPostcode) problems.push('ที่อยู่ผู้ซื้อไม่มีรหัสไปรษณีย์ 5 หลัก');
  if (isNote(t) && !doc.ref) problems.push('ใบเพิ่มหนี้/ใบลดหนี้ต้องอ้างถึงใบกำกับภาษีเดิม');
  const replacing = !isNote(t) && !!doc.replaces;
  if (!isNote(t) && o.purposeCode && !replacing) problems.push('รหัสเหตุผล (TIVC…) ใช้ได้เฉพาะใบกำกับภาษีที่ออกแทนฉบับเดิม');
  const purposeCode = isNote(t) || replacing ? (o.purposeCode || defaultPurposeCode(t)) : null;
  if (purposeCode && !PURPOSE_CODES.some((p) => p.code === purposeCode && p.kind === purposeKindOf(t))) problems.push(`รหัสเหตุผล ${purposeCode} ใช้กับเอกสารประเภทนี้ไม่ได้`);
  // the referenced document: the corrected invoice (80/81) or the replaced one (388/T02)
  const refDoc = isNote(t) ? doc.ref : replacing ? doc.replaces! : null;
  if (!seller.provinceCode || !seller.districtCode || !seller.subdistrictCode) warnings.push('ที่อยู่ผู้ขายยังไม่มีรหัสจังหวัด/อำเภอ/ตำบล — ETDA กำหนดให้ใช้รหัสสำหรับที่อยู่ในประเทศไทย (ตรวจกับ validator ก่อนใช้จริง)');
  if (!doc.buyer.taxId) warnings.push('ผู้ซื้อไม่มีเลขประจำตัวผู้เสียภาษี (บันทึกเป็น OTHR "N/A")');

  const A = (name: string, s: number) => el(name, { currencyID: 'THB' }, money(s));
  const tax = (rate: number, basis: number | null, calc: number | null) => el('ram:ApplicableTradeTax', null,
    el('ram:TypeCode', null, 'VAT'),
    el('ram:CalculatedRate', null, decimal(rate * 100)),
    basis !== null && A('ram:BasisAmount', basis),
    calc !== null && A('ram:CalculatedAmount', calc));

  const sellerParty = el('ram:SellerTradeParty', null,
    el('ram:Name', null, seller.name.trim()),
    el('ram:SpecifiedTaxRegistration', null, el('ram:ID', { schemeID: 'TXID' }, digits(seller.taxId) + seller.branch)),
    (seller.email || seller.phone) && el('ram:DefinedTradeContact', null,
      seller.email && el('ram:EmailURIUniversalCommunication', null, el('ram:URIID', null, seller.email)),
      seller.phone && el('ram:TelephoneUniversalCommunication', null, el('ram:CompleteNumber', null, seller.phone))),
    el('ram:PostalTradeAddress', null,
      el('ram:PostcodeCode', null, seller.postcode),
      el('ram:LineOne', null, seller.addressLine1.trim()),
      seller.addressLine2?.trim() && el('ram:LineTwo', null, seller.addressLine2.trim()),
      seller.districtCode ? el('ram:CityName', null, seller.districtCode) : null,
      seller.subdistrictCode ? el('ram:CitySubDivisionName', null, seller.subdistrictCode) : null,
      el('ram:CountryID', { schemeID: '3166-1 alpha-2' }, 'TH'),
      seller.provinceCode ? el('ram:CountrySubDivisionID', null, seller.provinceCode) : null,
      seller.buildingNumber?.trim() && el('ram:BuildingNumber', null, seller.buildingNumber.trim())));

  const addr = (doc.buyer.address ?? '').replace(/\s+/g, ' ').trim();
  const buyerParty = el('ram:BuyerTradeParty', null,
    el('ram:Name', null, doc.buyer.name.trim()),
    el('ram:SpecifiedTaxRegistration', null, el('ram:ID', { schemeID: reg.scheme }, reg.id)),
    doc.buyer.email && el('ram:DefinedTradeContact', null, el('ram:EmailURIUniversalCommunication', null, el('ram:URIID', null, doc.buyer.email))),
    el('ram:PostalTradeAddress', null,
      el('ram:PostcodeCode', null, buyerPostcode ?? ''),
      el('ram:LineOne', null, addr.slice(0, 256)),
      addr.length > 256 && el('ram:LineTwo', null, addr.slice(256, 512)),
      el('ram:CountryID', { schemeID: '3166-1 alpha-2' }, 'TH')));

  const note = isNote(t);
  const root = el(rootName(t), null,
    el('rsm:ExchangedDocumentContext', null,
      el('ram:GuidelineSpecifiedDocumentContextParameter', null,
        el('ram:ID', { schemeAgencyID: GUIDELINE.agency, schemeVersionID: GUIDELINE.version }, GUIDELINE.id))),
    el('rsm:ExchangedDocument', null,
      el('ram:ID', null, doc.no),
      el('ram:Name', null, TYPE_NAMES[t]),
      el('ram:TypeCode', null, t),
      el('ram:IssueDateTime', null, `${doc.issueDate}T00:00:00`),
      purposeCode && el('ram:Purpose', null, (doc.reason ?? '').slice(0, 256) || PURPOSE_CODES.find((p) => p.code === purposeCode)?.label || ''),
      purposeCode && el('ram:PurposeCode', null, purposeCode),
      el('ram:CreationDateTime', null, o.createdAt)),
    el('rsm:SupplyChainTradeTransaction', null,
      el('ram:ApplicableHeaderTradeAgreement', null,
        sellerParty,
        buyerParty,
        refDoc && el('ram:AdditionalReferencedDocument', null,
          el('ram:IssuerAssignedID', null, refDoc.no),
          el('ram:IssueDateTime', null, `${refDoc.date}T00:00:00`),
          el('ram:ReferenceTypeCode', null, refDoc.typeCode))),
      el('ram:ApplicableHeaderTradeDelivery', null),
      el('ram:ApplicableHeaderTradeSettlement', null,
        el('ram:InvoiceCurrencyCode', { listID: 'ISO 4217 3A' }, 'THB'),
        st.groups.map((g) => tax(g.rate, g.basis, g.tax)),
        st.allowance > 0 && el('ram:SpecifiedTradeAllowanceCharge', null,
          el('ram:ChargeIndicator', null, 'false'),
          A('ram:ActualAmount', st.allowance),
          el('ram:Reason', null, `หักเงินมัดจำ ${doc.deposit?.refs ?? ''}`.trim())),
        doc.dueDate && !note && el('ram:SpecifiedTradePaymentTerms', null, el('ram:DueDateDateTime', null, `${doc.dueDate}T00:00:00`)),
        el('ram:SpecifiedTradeSettlementHeaderMonetarySummation', null,
          note && doc.originalNet !== null && A('ram:OriginalInformationAmount', sat(doc.originalNet)),
          A('ram:LineTotalAmount', st.lineTotal),
          note && A('ram:DifferenceInformationAmount', sat(doc.net)),
          A('ram:AllowanceTotalAmount', st.allowance),
          A('ram:ChargeTotalAmount', 0),
          A('ram:TaxBasisTotalAmount', st.taxBasis),
          A('ram:TaxTotalAmount', st.taxTotal),
          A('ram:GrandTotalAmount', st.grand))),
      doc.lines.map((l, i) => {
        const s = st.lines[i] ?? { net: 0, vat: 0, gross: 0, rate: 0, unitPrice: 0, discount: 0 };
        return el('ram:IncludedSupplyChainTradeLineItem', null,
          el('ram:AssociatedDocumentLineDocument', null, el('ram:LineID', null, String(i + 1))),
          el('ram:SpecifiedTradeProduct', null,
            l.itemCode && el('ram:ID', null, l.itemCode),
            el('ram:Name', null, l.description.trim().slice(0, 256) || '-')),
          el('ram:SpecifiedLineTradeAgreement', null,
            el('ram:GrossPriceProductTradePrice', null, el('ram:ChargeAmount', { currencyID: 'THB' }, decimal(s.unitPrice)))),
          el('ram:SpecifiedLineTradeDelivery', null, el('ram:BilledQuantity', { unitCode: unitCode(l.uom) }, decimal(l.qty))),
          el('ram:SpecifiedLineTradeSettlement', null,
            tax(s.rate, s.net, s.vat),
            s.discount > 0 && el('ram:SpecifiedTradeAllowanceCharge', null, el('ram:ChargeIndicator', null, 'false'), A('ram:ActualAmount', s.discount)),
            el('ram:SpecifiedTradeSettlementLineMonetarySummation', null,
              A('ram:TaxTotalAmount', s.vat),
              A('ram:NetLineTotalAmount', s.net),
              A('ram:NetIncludingTaxesLineTotalAmount', s.gross))));
      })));

  const xml = serialize(root, namespacesFor(t));
  if (!problems.length) {
    const check = checkEtaxXml(xml);
    problems.push(...check.errors);
  }
  return { root, xml, settlement: st, problems, warnings };
}

/* ---------------- structure check ---------------- */

export interface CheckResult {
  ok: boolean;
  errors: string[];
  typeCode: string | null;
  /** satang */
  totals: { lineTotal: number; allowance: number; charge: number; taxBasis: number; taxTotal: number; grand: number } | null;
}

const REQUIRED_COMMON = [
  ['rsm:ExchangedDocumentContext', 'ram:GuidelineSpecifiedDocumentContextParameter', 'ram:ID'],
  ['rsm:ExchangedDocument', 'ram:ID'],
  ['rsm:ExchangedDocument', 'ram:Name'],
  ['rsm:ExchangedDocument', 'ram:TypeCode'],
  ['rsm:ExchangedDocument', 'ram:IssueDateTime'],
  ['rsm:ExchangedDocument', 'ram:CreationDateTime'],
  ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:SellerTradeParty', 'ram:Name'],
  ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:SellerTradeParty', 'ram:SpecifiedTaxRegistration', 'ram:ID'],
  ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:SellerTradeParty', 'ram:PostalTradeAddress', 'ram:PostcodeCode'],
  ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:SellerTradeParty', 'ram:PostalTradeAddress', 'ram:CountryID'],
  ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:BuyerTradeParty', 'ram:Name'],
  ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:BuyerTradeParty', 'ram:SpecifiedTaxRegistration', 'ram:ID'],
  ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:BuyerTradeParty', 'ram:PostalTradeAddress', 'ram:PostcodeCode'],
  ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeSettlement', 'ram:InvoiceCurrencyCode'],
  ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeSettlement', 'ram:ApplicableTradeTax', 'ram:TypeCode'],
];
const SUM = ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeSettlement', 'ram:SpecifiedTradeSettlementHeaderMonetarySummation'];

/**
 * Re-read a generated document and check it independently of the generator: well-formed, the root/namespace for its type,
 * required elements present, IDs valid, and every total reconciles to the satang. Signed documents may be checked too
 * (the ds:Signature element is ignored).
 */
export function checkEtaxXml(xml: string): CheckResult {
  const errors: string[] = [];
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (e) {
    return { ok: false, errors: [`XML ไม่ well-formed: ${(e as Error).message}`], typeCode: null, totals: null };
  }
  const typeCode = textOf(find(root, 'rsm:ExchangedDocument', 'ram:TypeCode')) ?? null;
  if (!typeCode || !(typeCode in TYPE_NAMES)) errors.push(`TypeCode "${typeCode}" ไม่รองรับ`);
  const t = (typeCode ?? '388') as TypeCode;
  if (root.name !== rootName(t)) errors.push(`root element ${root.name} ไม่ตรงกับประเภท ${t}`);
  const ns = namespacesFor(t);
  if (root.ns?.rsm !== ns.rsm) errors.push('namespace ของ rsm ไม่ถูกต้อง');
  for (const p of REQUIRED_COMMON) if (!textOf(find(root, ...p))?.trim()) errors.push(`ขาด ${p.join('/')}`);
  for (const p of ['ram:LineTotalAmount', 'ram:TaxBasisTotalAmount', 'ram:TaxTotalAmount', 'ram:GrandTotalAmount']) if (!find(root, ...SUM, p)) errors.push(`ขาด ${p}`);
  if (isNote(t)) {
    if (!textOf(find(root, 'rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:AdditionalReferencedDocument', 'ram:IssuerAssignedID'))) errors.push('ใบเพิ่มหนี้/ใบลดหนี้ไม่มีเลขที่ใบกำกับภาษีเดิม (AdditionalReferencedDocument)');
    if (!textOf(find(root, 'rsm:ExchangedDocument', 'ram:PurposeCode'))) errors.push('ขาด PurposeCode');
    if (!find(root, ...SUM, 'ram:DifferenceInformationAmount')) errors.push('ขาด DifferenceInformationAmount');
  } else if (textOf(find(root, 'rsm:ExchangedDocument', 'ram:PurposeCode'))) {
    // a replacement tax invoice must name the document it replaces
    if (!textOf(find(root, 'rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:AdditionalReferencedDocument', 'ram:IssuerAssignedID'))) errors.push('ใบกำกับภาษีที่ออกแทนต้องอ้างถึงฉบับเดิม (AdditionalReferencedDocument)');
  }
  const sellerId = textOf(find(root, 'rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:SellerTradeParty', 'ram:SpecifiedTaxRegistration', 'ram:ID')) ?? '';
  if (!/^\d{18}$/.test(sellerId) || !isValidThaiTaxId(sellerId.slice(0, 13))) errors.push('เลขผู้เสียภาษี+สาขาของผู้ขายต้องเป็น 18 หลักและเลขตรวจสอบถูกต้อง');

  const items = findAll(root, 'rsm:SupplyChainTradeTransaction', 'ram:IncludedSupplyChainTradeLineItem');
  if (!items.length) errors.push('ไม่มีรายการ (IncludedSupplyChainTradeLineItem)');
  const v = (e: XmlElement | undefined) => parseSat(textOf(e));
  let lineSum = 0;
  items.forEach((it, i) => {
    const ls = ['ram:SpecifiedLineTradeSettlement', 'ram:SpecifiedTradeSettlementLineMonetarySummation'];
    const net = v(find(it, ...ls, 'ram:NetLineTotalAmount'));
    const tx = v(find(it, ...ls, 'ram:TaxTotalAmount'));
    const gross = v(find(it, ...ls, 'ram:NetIncludingTaxesLineTotalAmount'));
    if ([net, tx, gross].some(Number.isNaN)) errors.push(`รายการที่ ${i + 1}: จำนวนเงินไม่ครบ/ไม่ใช่ตัวเลข`);
    else if (net + tx !== gross) errors.push(`รายการที่ ${i + 1}: ${money(net)} + ${money(tx)} ≠ ${money(gross)}`);
    if (!textOf(find(it, 'ram:SpecifiedTradeProduct', 'ram:Name'))) errors.push(`รายการที่ ${i + 1}: ไม่มีชื่อสินค้า/บริการ`);
    lineSum += net;
  });
  const s = (name: string) => v(find(root, ...SUM, name));
  const totals = {
    lineTotal: s('ram:LineTotalAmount'), allowance: find(root, ...SUM, 'ram:AllowanceTotalAmount') ? s('ram:AllowanceTotalAmount') : 0,
    charge: find(root, ...SUM, 'ram:ChargeTotalAmount') ? s('ram:ChargeTotalAmount') : 0,
    taxBasis: s('ram:TaxBasisTotalAmount'), taxTotal: s('ram:TaxTotalAmount'), grand: s('ram:GrandTotalAmount'),
  };
  if (Object.values(totals).some(Number.isNaN)) errors.push('ยอดรวมไม่ใช่ตัวเลข');
  else {
    if (lineSum !== totals.lineTotal) errors.push(`Σ รายการ ${money(lineSum)} ≠ LineTotalAmount ${money(totals.lineTotal)}`);
    if (totals.lineTotal - totals.allowance + totals.charge !== totals.taxBasis) errors.push('LineTotal − Allowance + Charge ≠ TaxBasisTotal');
    if (totals.taxBasis + totals.taxTotal !== totals.grand) errors.push('TaxBasisTotal + TaxTotal ≠ GrandTotal');
    const headerTaxes = findAll(root, 'rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeSettlement', 'ram:ApplicableTradeTax');
    const basisSum = headerTaxes.reduce((a, x) => a + v(find(x, 'ram:BasisAmount')), 0);
    const taxSum = headerTaxes.reduce((a, x) => a + v(find(x, 'ram:CalculatedAmount')), 0);
    if (basisSum !== totals.taxBasis) errors.push(`Σ BasisAmount ${money(basisSum)} ≠ TaxBasisTotal ${money(totals.taxBasis)}`);
    if (taxSum !== totals.taxTotal) errors.push(`Σ CalculatedAmount ${money(taxSum)} ≠ TaxTotal ${money(totals.taxTotal)}`);
    if (isNote(t)) {
      const diff = s('ram:DifferenceInformationAmount');
      if (diff !== totals.taxBasis) errors.push('DifferenceInformationAmount ≠ TaxBasisTotal');
    }
  }
  return { ok: errors.length === 0, errors, typeCode, totals: Object.values(totals).some(Number.isNaN) ? null : totals };
}
