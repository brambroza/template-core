/**
 * Pure tests (no database): ETDA XML for invoice / credit note / debit note with satang-exact totals, structure checks,
 * tax-ID validation, PKCS#12 reading and the XAdES-BES signature (verified with node:crypto, cross-checked with
 * libxml2 `xmllint --exc-c14n` and Python lxml when they are installed).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createVerify, createHash, X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEtaxXml, buyerRegistration, checkEtaxXml, money, namespacesFor, postcodeFrom, sellerProblems, settle, XML_DECL, type DocSnapshot, type SellerProfile } from '../src/etda.ts';
import { readPkcs12 } from '../src/pkcs12.ts';
import { rfc4514, verifyXadesSignature, xadesBesSigner } from '../src/xades.ts';
import { find, findAll, parseXml, serialize, textOf } from '../src/xml.ts';

export const P12_PASSWORD = 'test-pass-1234';
export const fixture = (name: string) => Buffer.from(readFileSync(new URL(`./fixtures/${name}.p12.b64`, import.meta.url), 'utf8'), 'base64');

/* valid 13-digit tax IDs (mod-11 check digit) */
export const SELLER_TAX = '0105561234560';
export const BUYER_TAX = '0105558123451';
export const PERSON_ID = '3109900123453';

export const seller: SellerProfile = {
  name: 'บริษัท สยามพาร์ท เมทัลเวิร์ค จำกัด', taxId: SELLER_TAX, branch: '00000', email: 'account@siampart.co.th', phone: '02-123-4567',
  buildingNumber: '99/1', addressLine1: 'หมู่ 4 ถนนบางนา-ตราด', addressLine2: null, subdistrict: 'บางโฉลง', subdistrictCode: '110101',
  district: 'บางพลี', districtCode: '1101', province: 'สมุทรปราการ', provinceCode: '11', postcode: '10540',
};

const invoice = (over: Partial<DocSnapshot> = {}): DocSnapshot => ({
  kind: 'invoice', no: 'INV-2569-0001', issueDate: '2026-10-01', dueDate: '2026-10-31',
  buyer: { name: 'บริษัท ชลบุรี พลาสติก & แม่พิมพ์ จำกัด', taxId: BUYER_TAX, branch: '00001', address: '88 ถ.สุขุมวิท ต.บ้านสวน อ.เมือง จ.ชลบุรี 20000', email: 'ap@cbp.co.th' },
  lines: [
    { itemCode: 'SH-45', description: 'เพลา S45C <Ø30>', qty: 3, uom: 'ชิ้น', unitPrice: 333.33, discount: 0, amount: 999.99, vatRate: 0.07 },
    { itemCode: null, description: 'ค่าบริการกลึง', qty: 1, uom: null, unitPrice: 1500, discount: 0, amount: 1500, vatRate: 0.07 },
  ],
  // documentTotals: 2,499.99 → VAT 7% = 174.9993 → 175.00 → 2,674.99
  net: 2499.99, vat: 175.0, gross: 2674.99, deposit: null, ref: null, reason: null, originalNet: null, correctNet: null,
  ...over,
});

const creditNote = (over: Partial<DocSnapshot> = {}): DocSnapshot => ({
  kind: 'credit', no: 'CN-2569-0001', issueDate: '2026-10-05', dueDate: null,
  buyer: invoice().buyer,
  lines: [{ itemCode: 'SH-45', description: 'รับคืนเพลา S45C (ชำรุด)', qty: 1, uom: 'ชิ้น', unitPrice: 333.33, discount: 0, amount: 333.33, vatRate: 0.07 }],
  // §86/10: original 2,499.99 → correct 2,166.66; difference 333.33, VAT 23.33 (333.33 × 7% = 23.3331), total 356.66
  net: 333.33, vat: 23.33, gross: 356.66, deposit: null, ref: { no: 'INV-2569-0001', date: '2026-10-01', typeCode: 'T02' },
  reason: 'สินค้าชำรุด รับคืน 1 ชิ้น', originalNet: 2499.99, correctNet: 2166.66,
  ...over,
});

const debitNote = (): DocSnapshot => ({
  ...creditNote(), kind: 'debit', no: 'DN-2569-0001',
  lines: [{ itemCode: null, description: 'ค่าขนส่งที่ยังไม่ได้เรียกเก็บ', qty: 1, uom: 'เที่ยว', unitPrice: 450.5, discount: 0, amount: 450.5, vatRate: 0.07 }],
  // §86/9: original 2,499.99 → correct 2,950.49; difference 450.50, VAT 31.535 → 31.54, total 482.04
  net: 450.5, vat: 31.54, gross: 482.04, reason: 'เรียกเก็บค่าขนส่งเพิ่ม', originalNet: 2499.99, correctNet: 2950.49,
});

const CREATED = '2026-10-03T10:15:00';
const SUM = ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeSettlement', 'ram:SpecifiedTradeSettlementHeaderMonetarySummation'];
const sumOf = (xml: string, name: string) => textOf(find(parseXml(xml), ...SUM, name));

const tmp = mkdtempSync(join(tmpdir(), 'etax-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const has = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
const HAS_XMLLINT = has('xmllint', ['--version']);
const HAS_LXML = has('python3', ['-c', 'import lxml.etree']);

describe('ETDA XML — tax invoice (T02 / 388)', () => {
  it('builds a reconciled T02 with exact satang and every required element', () => {
    const r = buildEtaxXml(invoice(), seller, { typeCode: 'T02', createdAt: CREATED });
    expect(r.problems).toEqual([]);
    const root = parseXml(r.xml);
    expect(root.name).toBe('rsm:TaxInvoice_CrossIndustryInvoice');
    expect(root.ns?.rsm).toBe('urn:etda:uncefact:data:standard:TaxInvoice_CrossIndustryInvoice:2');
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:TypeCode'))).toBe('T02');
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:Name'))).toBe('ใบแจ้งหนี้/ใบกำกับภาษี');
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:IssueDateTime'))).toBe('2026-10-01T00:00:00');
    const agreement = ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement'];
    const sellerId = find(root, ...agreement, 'ram:SellerTradeParty', 'ram:SpecifiedTaxRegistration', 'ram:ID')!;
    expect(sellerId.attrs.schemeID).toBe('TXID');
    expect(textOf(sellerId)).toBe(`${SELLER_TAX}00000`);
    expect(textOf(find(root, ...agreement, 'ram:BuyerTradeParty', 'ram:SpecifiedTaxRegistration', 'ram:ID'))).toBe(`${BUYER_TAX}00001`);
    expect(textOf(find(root, ...agreement, 'ram:BuyerTradeParty', 'ram:PostalTradeAddress', 'ram:PostcodeCode'))).toBe('20000');
    expect(textOf(find(root, ...agreement, 'ram:SellerTradeParty', 'ram:PostalTradeAddress', 'ram:CountrySubDivisionID'))).toBe('11');
    // the "<Ø30>" and "&" in names are escaped, not breaking the document
    expect(r.xml).toContain('เพลา S45C &lt;Ø30&gt;');
    expect(r.xml).toContain('พลาสติก &amp; แม่พิมพ์');

    expect(sumOf(r.xml, 'ram:LineTotalAmount')).toBe('2499.99');
    expect(sumOf(r.xml, 'ram:TaxBasisTotalAmount')).toBe('2499.99');
    expect(sumOf(r.xml, 'ram:TaxTotalAmount')).toBe('175.00');
    expect(sumOf(r.xml, 'ram:GrandTotalAmount')).toBe('2674.99');
    const items = findAll(root, 'rsm:SupplyChainTradeTransaction', 'ram:IncludedSupplyChainTradeLineItem');
    expect(items).toHaveLength(2);
    // VAT 175.00 allocated by largest remainder: 999.99 → 70.00 (69.9993), 1,500.00 → 105.00
    const lineSum = (it: (typeof items)[0], n: string) => textOf(find(it, 'ram:SpecifiedLineTradeSettlement', 'ram:SpecifiedTradeSettlementLineMonetarySummation', n));
    expect(items.map((it) => [lineSum(it, 'ram:NetLineTotalAmount'), lineSum(it, 'ram:TaxTotalAmount'), lineSum(it, 'ram:NetIncludingTaxesLineTotalAmount')]))
      .toEqual([['999.99', '70.00', '1069.99'], ['1500.00', '105.00', '1605.00']]);
    expect(find(items[0], 'ram:SpecifiedLineTradeDelivery', 'ram:BilledQuantity')!.attrs.unitCode).toBe('C62');
    expect(textOf(find(items[0], 'ram:SpecifiedLineTradeAgreement', 'ram:GrossPriceProductTradePrice', 'ram:ChargeAmount'))).toBe('333.33');
    expect(checkEtaxXml(r.xml)).toMatchObject({ ok: true, errors: [], typeCode: 'T02', totals: { lineTotal: 249999, taxBasis: 249999, taxTotal: 17500, grand: 267499 } });
  });

  it('388 uses the same TaxInvoice schema and name ใบกำกับภาษี', () => {
    const r = buildEtaxXml(invoice(), seller, { typeCode: '388', createdAt: CREATED });
    expect(r.problems).toEqual([]);
    expect(textOf(find(parseXml(r.xml), 'rsm:ExchangedDocument', 'ram:Name'))).toBe('ใบกำกับภาษี');
  });

  it('VAT-inclusive lines are converted to ex-VAT amounts that still reconcile to the satang', () => {
    // three lines of 100.00 incl. VAT = 300.00 → net 280.37, VAT 19.63 (sales: calcVat inclusive)
    const doc = invoice({
      lines: [1, 2, 3].map((i) => ({ itemCode: `P${i}`, description: `สินค้า ${i}`, qty: 1, uom: 'ea', unitPrice: 100, discount: 0, amount: 100, vatRate: 0.07 })),
      net: 280.37, vat: 19.63, gross: 300,
    });
    const st = settle(doc);
    expect(st.inclusive).toBe(true);
    expect(st.problems).toEqual([]);
    // 100 / 1.07 = 93.457… → 93.46 × 3 = 280.38 → the 1-satang residual goes to one line
    expect(st.lines.map((l) => l.net).reduce((a, b) => a + b)).toBe(28037);
    expect(st.lines.map((l) => l.vat).reduce((a, b) => a + b)).toBe(1963);
    expect(st.lines.every((l) => l.gross === l.net + l.vat)).toBe(true);
    const r = buildEtaxXml(doc, seller, { typeCode: 'T02', createdAt: CREATED });
    expect(r.problems).toEqual([]);
    expect(checkEtaxXml(r.xml).ok).toBe(true);
  });

  it('a deposit deducted on the invoice (§78(1)(ข)) becomes a document allowance; basis and VAT are this invoice’s own', () => {
    // goods 100,000 + VAT 7,000; deposit DT-2569-0003 of 30,000 + 2,100 already taxed → this invoice: 70,000 + 4,900 = 74,900
    const doc = invoice({
      lines: [{ itemCode: 'MOLD-1', description: 'แม่พิมพ์ฉีด', qty: 1, uom: 'ชุด', unitPrice: 100000, discount: 0, amount: 100000, vatRate: 0.07 }],
      net: 70000, vat: 4900, gross: 74900, deposit: { net: 30000, vat: 2100, gross: 32100, refs: 'DT-2569-0003' },
    });
    const r = buildEtaxXml(doc, seller, { typeCode: 'T02', createdAt: CREATED });
    expect(r.problems).toEqual([]);
    expect([sumOf(r.xml, 'ram:LineTotalAmount'), sumOf(r.xml, 'ram:AllowanceTotalAmount'), sumOf(r.xml, 'ram:TaxBasisTotalAmount'), sumOf(r.xml, 'ram:TaxTotalAmount'), sumOf(r.xml, 'ram:GrandTotalAmount')])
      .toEqual(['100000.00', '30000.00', '70000.00', '4900.00', '74900.00']);
    expect(r.xml).toContain('หักเงินมัดจำ DT-2569-0003');
    expect(checkEtaxXml(r.xml).ok).toBe(true);
  });

  it('mixed 7% and 0% lines give one ApplicableTradeTax per rate', () => {
    const doc = invoice({
      lines: [
        { itemCode: 'A', description: 'สินค้าในประเทศ', qty: 2, uom: 'kg', unitPrice: 125.25, discount: 0.5, amount: 250, vatRate: 0.07 },
        { itemCode: 'B', description: 'สินค้าส่งออก', qty: 1, uom: null, unitPrice: 1000, discount: 0, amount: 1000, vatRate: 0 },
      ],
      net: 1250, vat: 17.5, gross: 1267.5,
    });
    const r = buildEtaxXml(doc, seller, { typeCode: '388', createdAt: CREATED });
    expect(r.problems).toEqual([]);
    const taxes = findAll(parseXml(r.xml), 'rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeSettlement', 'ram:ApplicableTradeTax');
    expect(taxes.map((x) => [textOf(find(x, 'ram:CalculatedRate')), textOf(find(x, 'ram:BasisAmount')), textOf(find(x, 'ram:CalculatedAmount'))]))
      .toEqual([['7.00', '250.00', '17.50'], ['0.00', '1000.00', '0.00']]);
    expect(r.xml).toContain('unitCode="KGM"');
    expect(r.xml).toMatch(/<ram:ChargeIndicator[^>]*>false<\/ram:ChargeIndicator><ram:ActualAmount currencyID="THB"[^>]*>0.50</);
  });

  it('refuses lines that do not belong to the totals (never "fixes" them silently)', () => {
    const r = buildEtaxXml(invoice({ net: 2600, vat: 182, gross: 2782 }), seller, { typeCode: 'T02', createdAt: CREATED });
    expect(r.problems.join(' ')).toContain('ยอดรวมรายการ 2499.99 ไม่ตรงกับมูลค่าก่อนภาษี 2600.00');
  });

  it('requires the buyer address with a postcode (§86/4)', () => {
    const r = buildEtaxXml(invoice({ buyer: { ...invoice().buyer, address: null } }), seller, { typeCode: 'T02', createdAt: CREATED });
    expect(r.problems.join(' ')).toContain('ไม่มีที่อยู่ผู้ซื้อ');
    const r2 = buildEtaxXml(invoice({ buyer: { ...invoice().buyer, address: '88 ถ.สุขุมวิท ชลบุรี' } }), seller, { typeCode: 'T02', createdAt: CREATED });
    expect(r2.problems.join(' ')).toContain('รหัสไปรษณีย์');
  });
});

describe('ETDA XML — credit note (81) / debit note (80)', () => {
  it('credit note references the original invoice and carries original / difference amounts', () => {
    const r = buildEtaxXml(creditNote(), seller, { typeCode: '81', createdAt: CREATED, purposeCode: 'CDNG02' });
    expect(r.problems).toEqual([]);
    const root = parseXml(r.xml);
    expect(root.name).toBe('rsm:DebitCreditNote_CrossIndustryInvoice');
    expect(root.ns?.rsm).toBe(namespacesFor('81').rsm);
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:TypeCode'))).toBe('81');
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:PurposeCode'))).toBe('CDNG02');
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:Purpose'))).toBe('สินค้าชำรุด รับคืน 1 ชิ้น');
    const ref = find(root, 'rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:AdditionalReferencedDocument')!;
    expect([textOf(find(ref, 'ram:IssuerAssignedID')), textOf(find(ref, 'ram:IssueDateTime')), textOf(find(ref, 'ram:ReferenceTypeCode'))])
      .toEqual(['INV-2569-0001', '2026-10-01T00:00:00', 'T02']);
    expect([sumOf(r.xml, 'ram:OriginalInformationAmount'), sumOf(r.xml, 'ram:LineTotalAmount'), sumOf(r.xml, 'ram:DifferenceInformationAmount'),
      sumOf(r.xml, 'ram:TaxBasisTotalAmount'), sumOf(r.xml, 'ram:TaxTotalAmount'), sumOf(r.xml, 'ram:GrandTotalAmount')])
      .toEqual(['2499.99', '333.33', '333.33', '333.33', '23.33', '356.66']);
    expect(checkEtaxXml(r.xml)).toMatchObject({ ok: true, typeCode: '81' });
  });

  it('debit note: difference 450.50, VAT 31.54 (31.535 rounded half up), total 482.04', () => {
    const r = buildEtaxXml(debitNote(), seller, { typeCode: '80', createdAt: CREATED });
    expect(r.problems).toEqual([]);
    expect(textOf(find(parseXml(r.xml), 'rsm:ExchangedDocument', 'ram:PurposeCode'))).toBe('DBNG99');
    expect([sumOf(r.xml, 'ram:DifferenceInformationAmount'), sumOf(r.xml, 'ram:TaxTotalAmount'), sumOf(r.xml, 'ram:GrandTotalAmount')]).toEqual(['450.50', '31.54', '482.04']);
    expect(checkEtaxXml(r.xml)).toMatchObject({ ok: true, typeCode: '80' });
  });

  it('a note must reference the original invoice, match its difference, and use a code of its own kind', () => {
    expect(buildEtaxXml(creditNote({ ref: null }), seller, { typeCode: '81', createdAt: CREATED }).problems.join(' ')).toContain('ต้องอ้างถึงใบกำกับภาษีเดิม');
    expect(buildEtaxXml(creditNote({ correctNet: 2200 }), seller, { typeCode: '81', createdAt: CREATED }).problems.join(' ')).toContain('ผลต่าง');
    expect(buildEtaxXml(creditNote(), seller, { typeCode: '81', createdAt: CREATED, purposeCode: 'DBNG01' }).problems.join(' ')).toContain('DBNG01');
    expect(buildEtaxXml(creditNote(), seller, { typeCode: 'T02', createdAt: CREATED }).problems.join(' ')).toContain('ไม่ตรงกับเอกสาร');
  });

  it('the structure check catches tampered totals and missing references', () => {
    const r = buildEtaxXml(creditNote(), seller, { typeCode: '81', createdAt: CREATED });
    const badTotal = r.xml.replace('<ram:GrandTotalAmount currencyID="THB">356.66', '<ram:GrandTotalAmount currencyID="THB">356.67');
    expect(checkEtaxXml(badTotal).errors).toContain('TaxBasisTotal + TaxTotal ≠ GrandTotal');
    const noRef = r.xml.replace(/<ram:AdditionalReferencedDocument[\s\S]*?<\/ram:AdditionalReferencedDocument>/, '');
    expect(checkEtaxXml(noRef).errors.join(' ')).toContain('AdditionalReferencedDocument');
    expect(checkEtaxXml('<a><b></a>').errors[0]).toContain('ไม่ well-formed');
  });
});

describe('tax ID, branch and postcode', () => {
  it('validates the seller with @erp/thai (13 digits + mod-11 check digit) and a 5-digit branch', () => {
    expect(sellerProblems(seller)).toEqual([]);
    expect(sellerProblems({ ...seller, taxId: '0105561234561' })).toContain('เลขประจำตัวผู้เสียภาษีของผู้ขายไม่ถูกต้อง');
    expect(sellerProblems({ ...seller, taxId: '010556123456' })).toContain('เลขประจำตัวผู้เสียภาษีของผู้ขายไม่ถูกต้อง');
    expect(sellerProblems({ ...seller, branch: '1' })[0]).toContain('รหัสสาขา');
    expect(sellerProblems(null)[0]).toContain('ยังไม่ได้ตั้งค่า');
  });

  it('buyer registration: juristic TXID 13+branch (head office default), individual NIDN, none OTHR', () => {
    const b = invoice().buyer;
    expect(buyerRegistration({ ...b, branch: null })).toEqual({ scheme: 'TXID', id: `${BUYER_TAX}00000` });
    expect(buyerRegistration({ ...b, taxId: '0-1055-58123-45-1', branch: '00012' })).toEqual({ scheme: 'TXID', id: `${BUYER_TAX}00012` });
    expect(buyerRegistration({ ...b, taxId: PERSON_ID })).toEqual({ scheme: 'NIDN', id: PERSON_ID });
    expect(buyerRegistration({ ...b, taxId: null })).toEqual({ scheme: 'OTHR', id: 'N/A' });
    expect(buyerRegistration({ ...b, taxId: '0105558123452' }).problem).toContain('ไม่ถูกต้อง');
  });

  it('takes the last 5-digit group of a Thai address as the postcode', () => {
    expect(postcodeFrom('99/12 หมู่ 5 ซ.10 ต.บางพลีใหญ่ อ.บางพลี สมุทรปราการ 10540')).toBe('10540');
    expect(postcodeFrom('เลขที่ 12345 ถนนพระราม 9 กรุงเทพฯ 10310 โทร 0812345678')).toBe('10310');
    expect(postcodeFrom('ไม่มีรหัส')).toBeNull();
  });

  it('formats money from satang without floating-point drift', () => {
    expect([money(0), money(5), money(100), money(123456789), money(-1999)]).toEqual(['0.00', '0.05', '1.00', '1234567.89', '-19.99']);
  });
});

describe('PKCS#12 (.p12) reader', () => {
  it('reads an OpenSSL 3 file (PBES2 / AES-256 / HMAC-SHA256 MAC) and a legacy one (3DES / SHA-1 MAC)', () => {
    for (const name of ['signer-aes', 'signer-3des']) {
      const p = readPkcs12(fixture(name), P12_PASSWORD);
      expect(p.privateKey.asymmetricKeyType).toBe('rsa');
      expect(p.certificate.subject).toContain('CN=ETAX TEST SIGNER');
      expect(p.certificate.checkPrivateKey(p.privateKey)).toBe(true);
    }
  });

  it('a wrong password or a non-PKCS#12 file gives a clear Thai error', () => {
    expect(() => readPkcs12(fixture('signer-aes'), 'nope')).toThrow('รหัสผ่านไฟล์ใบรับรองไม่ถูกต้อง');
    expect(() => readPkcs12(fixture('signer-3des'), 'nope')).toThrow('รหัสผ่านไฟล์ใบรับรองไม่ถูกต้อง');
    expect(() => readPkcs12(Buffer.from('not a certificate at all'), P12_PASSWORD)).toThrow(/ใบรับรอง/);
  });

  it('writes the issuer as an RFC 4514 string (least significant RDN first, escaped)', () => {
    expect(rfc4514('C=TH\nO=A, B & C\nCN=X')).toBe('CN=X,O=A\\, B & C,C=TH');
  });
});

describe('XAdES-BES signature', () => {
  const p12 = readPkcs12(fixture('signer-aes'), P12_PASSWORD);
  const build = (doc = invoice(), t: '81' | 'T02' = 'T02') => buildEtaxXml(doc, seller, { typeCode: t, createdAt: CREATED });

  it('signs an invoice and verifies with node:crypto (digests, RSA-SHA256, SigningCertificate)', () => {
    const r = build();
    const signed = xadesBesSigner(p12.privateKey, p12.certificate).sign(r.root, namespacesFor('T02'), { signingTime: '2026-10-03T10:20:00+07:00' });
    expect(signed.xml.startsWith(XML_DECL)).toBe(true);
    const v = verifyXadesSignature(signed.xml, { fingerprint256: p12.certificate.fingerprint256 });
    expect(v).toMatchObject({ valid: true, errors: [], signingTime: '2026-10-03T10:20:00+07:00' });
    expect(v.certificate!.serial).toBe(BigInt(`0x${p12.certificate.serialNumber}`).toString());
    // the signed document still passes the ETDA structure check (ds:Signature is ignored)
    expect(checkEtaxXml(signed.xml).ok).toBe(true);

    // independent re-implementation of the core check, straight from the bytes
    const root = parseXml(signed.xml);
    const sig = root.children.at(-1) as any;
    expect(sig.name).toBe('ds:Signature');
    const unsigned = signed.xml.slice(XML_DECL.length).replace(/<ds:Signature[\s\S]*<\/ds:Signature>/, '');
    expect(unsigned).toBe(r.xml);
    const digest = createHash('sha256').update(unsigned).digest('base64');
    expect(signed.xml).toContain(`<ds:DigestValue>${digest}</ds:DigestValue>`);
    const signedInfo = serialize(sig.children[0], { ...namespacesFor('T02') });
    const value = /<ds:SignatureValue[^>]*>([^<]+)</.exec(signed.xml)![1];
    expect(createVerify('RSA-SHA256').update(signedInfo).verify(new X509Certificate(p12.certificate.raw).publicKey, value, 'base64')).toBe(true);
  });

  it('a credit note signed with the legacy 3DES .p12 verifies too', () => {
    const legacy = readPkcs12(fixture('signer-3des'), P12_PASSWORD);
    const r = build(creditNote(), '81');
    const signed = xadesBesSigner(legacy.privateKey, legacy.certificate).sign(r.root, namespacesFor('81'), { signingTime: '2026-10-05T09:00:00+07:00' });
    expect(verifyXadesSignature(signed.xml).valid).toBe(true);
  });

  it('detects any change after signing, and a different certificate', () => {
    const signed = xadesBesSigner(p12.privateKey, p12.certificate).sign(build().root, namespacesFor('T02'), { signingTime: '2026-10-03T10:20:00+07:00' }).xml;
    expect(verifyXadesSignature(signed.replace('2674.99', '2674.98')).errors.join(' ')).toContain('เอกสารถูกแก้ไขหลังลงลายมือชื่อ');
    expect(verifyXadesSignature(signed.replace('2026-10-03T10:20:00+07:00', '2026-10-04T10:20:00+07:00')).valid).toBe(false);
    const sv = /<ds:SignatureValue[^>]*>([^<]+)</.exec(signed)![1];
    expect(verifyXadesSignature(signed.replace(sv, Buffer.alloc(256, 1).toString('base64'))).errors).toContain('SignatureValue ไม่ถูกต้อง');
    expect(verifyXadesSignature(signed, { fingerprint256: 'AA:BB' }).errors).toContain('ลงลายมือชื่อด้วยใบรับรองอื่น');
  });

  it.skipIf(!HAS_XMLLINT)('our serialization IS exclusive c14n (libxml2 xmllint --exc-c14n gives the same bytes), signed file is well-formed', () => {
    for (const [doc, t] of [[invoice(), 'T02'], [creditNote(), '81']] as const) {
      const r = build(doc, t as any);
      const f = join(tmp, `doc-${t}.xml`);
      writeFileSync(f, XML_DECL + r.xml);
      expect(execFileSync('xmllint', ['--exc-c14n', f]).toString('utf8')).toBe(r.xml);
      const sf = join(tmp, `signed-${t}.xml`);
      writeFileSync(sf, xadesBesSigner(p12.privateKey, p12.certificate).sign(r.root, namespacesFor(t as any), { signingTime: '2026-10-03T10:20:00+07:00' }).xml);
      execFileSync('xmllint', ['--noout', sf]);
    }
  });

  it.skipIf(!HAS_LXML)('lxml (libxml2 exclusive c14n) recomputes the same digests and SignedInfo bytes the RSA signature covers', () => {
    const r = build(creditNote(), '81');
    const signed = xadesBesSigner(p12.privateKey, p12.certificate).sign(r.root, namespacesFor('81'), { signingTime: '2026-10-05T09:00:00+07:00' }).xml;
    const f = join(tmp, 'lxml.xml');
    writeFileSync(f, signed);
    const script = `
import sys, json, hashlib, base64
from lxml import etree
DS = 'http://www.w3.org/2000/09/xmldsig#'
doc = etree.parse(sys.argv[1])
root = doc.getroot()
sig = root.find('{%s}Signature' % DS)
si = sig.find('{%s}SignedInfo' % DS)
si_c14n = etree.tostring(si, method='c14n', exclusive=True)
sp = [e for e in sig.iter() if e.get('Id', '').endswith('-signedprops')][0]
sp_digest = base64.b64encode(hashlib.sha256(etree.tostring(sp, method='c14n', exclusive=True)).digest()).decode()
root.remove(sig)
doc_digest = base64.b64encode(hashlib.sha256(etree.tostring(doc, method='c14n', exclusive=True)).digest()).decode()
refs = [r.find('{%s}DigestValue' % DS).text for r in si.findall('{%s}Reference' % DS)]
print(json.dumps({'si': base64.b64encode(si_c14n).decode(), 'doc': doc_digest, 'sp': sp_digest, 'refs': refs}))
`;
    const out = JSON.parse(execFileSync('python3', ['-c', script, f]).toString('utf8'));
    expect(out.refs).toEqual([out.doc, out.sp]);
    const value = /<ds:SignatureValue[^>]*>([^<]+)</.exec(signed)![1];
    expect(createVerify('RSA-SHA256').update(Buffer.from(out.si, 'base64')).verify(p12.certificate.publicKey, value, 'base64')).toBe(true);
  });
});
