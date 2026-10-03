/**
 * e-Tax service tests against a real database (RLS enforced): event snapshots, seller settings, XML generation, XAdES-BES
 * signing with the fixture certificates, delivery records, cancel / replace, lock-step status transitions, permissions and
 * tenant isolation. Amounts are checked to the satang.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '@erp/kernel';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { checkEtaxXml } from '../src/etda.ts';
import { readPkcs12 } from '../src/pkcs12.ts';
import { BOUNDARY, definition, TRANSITIONS } from '../src/service.ts';
import ui, { BOUNDARY_TEXT, purposeCodes, replaceCodes } from '../src/ui.ts';
import { PURPOSE_CODES } from '../src/etda.ts';
import { verifyXadesSignature } from '../src/xades.ts';
import { find, parseXml, textOf } from '../src/xml.ts';

const P12_PASSWORD = 'test-pass-1234';
const p12b64 = (name: string) => readFileSync(new URL(`./fixtures/${name}.p12.b64`, import.meta.url), 'utf8').replace(/\s+/g, '');
const FINGERPRINT = readPkcs12(Buffer.from(p12b64('signer-aes'), 'base64'), P12_PASSWORD).certificate.fingerprint256;

/* valid 13-digit tax IDs (mod-11 check digit) */
const SELLER_TAX = '0105561234560';
const BUYER_TAX = '0105558123451';

const READ = 'etax.document.read';
const WRITE = 'etax.document.write';
const SETTINGS = 'etax.settings.write';
const NOW = '2026-10-10T03:00:00Z'; // 10:00 on 10 Oct 2026 in Bangkok — after the fixture certificate's notBefore

const SELLER = {
  sellerName: 'บริษัท สยามพาร์ท เมทัลเวิร์ค จำกัด', taxId: '0-1055-61234-56-0', branch: '00000', buildingNumber: '99/1',
  addressLine1: 'หมู่ 4 ถนนบางนา-ตราด', subdistrict: 'บางโฉลง', subdistrictCode: '110101', district: 'บางพลี', districtCode: '1101',
  province: 'สมุทรปราการ', provinceCode: '11', postcode: '10540', email: 'account@siampart.co.th', phone: '02-123-4567', invoiceTypeCode: 'T02',
};
const ADDRESS = '88 ถ.สุขุมวิท ต.บ้านสวน อ.เมือง จ.ชลบุรี 20000';

/** INV: 999.99 + 1,500.00 = 2,499.99; VAT 7% = 174.9993 → 175.00; total 2,674.99 */
const invoiceEvent = (over: Record<string, unknown> = {}) => ({
  invoiceId: randomUUID(), invoiceNo: 'INV-2569-0001', orderId: randomUUID(), net: 2499.99, vat: 175, gross: 2674.99,
  customerId: randomUUID(), customerName: 'บริษัท ชลบุรี พลาสติก จำกัด', dueDate: '2026-10-31', issueDate: '2026-10-01', vatMode: 'exclusive',
  customerTaxId: BUYER_TAX, customerBranch: '00001', customerAddress: ADDRESS, customerEmail: 'ap@cbp.co.th',
  lines: [
    { itemId: null, itemCode: 'SH-45', description: 'เพลา S45C Ø30', qty: 3, uom: 'ชิ้น', unitPrice: 333.33, discount: 0, amount: 999.99, vatRate: 0.07 },
    { itemId: null, itemCode: null, description: 'ค่าบริการกลึง', qty: 1, uom: null, unitPrice: 1500, discount: 0, amount: 1500, vatRate: 0.07 },
  ],
  ...over,
});

/** CN: 333.33 returned; VAT 23.3331 → 23.33; total 356.66; 2,499.99 → 2,166.66 (มาตรา 86/10) */
const creditEvent = (inv: { invoiceId: string; invoiceNo: string }, over: Record<string, unknown> = {}) => ({
  noteId: randomUUID(), noteNo: 'CN-2569-0001', kind: 'credit', issueDate: '2026-10-05', invoiceId: inv.invoiceId, invoiceNo: inv.invoiceNo, invoiceDate: '2026-10-01',
  customerId: null, customerName: 'บริษัท ชลบุรี พลาสติก จำกัด', customerTaxId: BUYER_TAX, customerBranch: '00001',
  reason: 'ลดราคาสินค้าเนื่องจากสินค้าชำรุดเสียหาย — รับคืน 1 ชิ้น', originalNet: 2499.99, correctNet: 2166.66, net: 333.33, vat: 23.33, gross: 356.66,
  lines: [{ itemId: null, itemCode: 'SH-45', description: 'รับคืนเพลา S45C (ชำรุด)', qty: 1, unitPrice: 333.33, amount: 333.33 }],
  ...over,
});

const SUM = ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeSettlement', 'ram:SpecifiedTradeSettlementHeaderMonetarySummation'];
const REF = ['rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:AdditionalReferencedDocument'];

let t: TestService;
let n = 0;
beforeAll(async () => {
  setClock(NOW);
  t = await bootTestService(definition);
});
afterAll(async () => {
  setClock(null);
  await t?.close();
});
beforeEach(() => setClock(NOW));

/** a fresh tenant per scenario keeps the tests independent */
function tenant() {
  const id = randomUUID();
  const admin = t.token(['*'], id, { userId: randomUUID(), userName: `ผู้ทดสอบ ${++n}` });
  const api = (method: string, url: string, body?: unknown, token = admin) => t.api(method, url, body, { token });
  const deliver = (type: string, data: unknown, eventId?: string) => t.deliver(type, data, { tenantId: id, id: eventId });
  const docBySource = async (no: string) => (await api('GET', `/documents?q=${encodeURIComponent(no)}`)).body.find((d: any) => d.doc_no === no);
  return { id, admin, api, deliver, docBySource };
}

async function readyTenant(withCert = false) {
  const x = tenant();
  expect((await x.api('PUT', '/settings', SELLER)).status).toBe(200);
  if (withCert) expect((await x.api('POST', '/settings/certificate', { fileName: 'company.p12', dataBase64: p12b64('signer-aes'), password: P12_PASSWORD })).status).toBe(200);
  const inv = invoiceEvent();
  expect((await x.deliver('sales.invoiced', inv)).status).toBe(200);
  const doc = await x.docBySource(inv.invoiceNo);
  return { ...x, inv, doc };
}

async function xmlOf(x: ReturnType<typeof tenant>, id: string, signed = false) {
  const r = await t.raw('GET', `/documents/${id}/xml${signed ? '?signed=1' : ''}`, undefined, { token: x.admin });
  expect(r.status).toBe(200);
  expect(String(r.headers['content-type'])).toContain('application/xml');
  return r.body.toString('utf8');
}

describe('event snapshots', () => {
  it('sales.invoiced → a draft snapshot; the same event twice and a re-sent fact never duplicate it', async () => {
    const x = tenant();
    const inv = invoiceEvent();
    const eventId = randomUUID();
    expect((await x.deliver('sales.invoiced', inv, eventId)).status).toBe(200);
    expect((await x.deliver('sales.invoiced', inv, eventId)).status).toBe(200);
    expect((await x.deliver('sales.invoiced', { ...inv, customerName: 'ชื่อใหม่จากโมดูลขาย' })).status).toBe(200);
    const list = (await x.api('GET', '/documents')).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ doc_no: 'INV-2569-0001', kind: 'invoice', status: 'draft', buyer_name: 'ชื่อใหม่จากโมดูลขาย', net: 2499.99, vat: 175, gross: 2674.99 });
    const d = (await x.api('GET', `/documents/${list[0].id}`)).body;
    expect(d.lines).toHaveLength(2);
    expect(d.lines[0]).toMatchObject({ line_no: 1, itemCode: 'SH-45', amount: 999.99, vatRate: 0.07 });
    expect(d).toMatchObject({ buyer_address: ADDRESS, buyer_email: 'ap@cbp.co.th', buyer_tax_id: BUYER_TAX, buyer_branch: '00001', generate_as: 'invoice', boundary: BOUNDARY });
    expect(d.payload).toBeUndefined(); // the raw event is not echoed
  });

  it('an invoice event without lines (old Sales) becomes an incomplete record instead of failing', async () => {
    const x = tenant();
    const { lines: _drop, ...old } = invoiceEvent({ invoiceNo: 'INV-OLD-1' });
    expect((await x.deliver('sales.invoiced', old)).status).toBe(200);
    expect((await x.deliver('sales.invoiced', invoiceEvent({ invoiceNo: 'INV-EMPTY', lines: [] }))).status).toBe(200);
    expect((await x.deliver('sales.invoiced', invoiceEvent({ invoiceNo: 'INV-BADDATE', issueDate: '2026-02-31' }))).status).toBe(200);
    for (const no of ['INV-OLD-1', 'INV-EMPTY', 'INV-BADDATE']) {
      const d = (await x.api('GET', `/documents/${(await x.docBySource(no)).id}`)).body;
      expect(d.status).toBe('incomplete');
      expect(d.problems_text).toContain('ข้อมูลไม่พอ');
      expect(d.generate_as).toBeNull();
      const g = await x.api('POST', `/documents/${d.id}/generate`, {});
      expect(g.status).toBe(409);
    }
    expect((await x.api('GET', '/summary')).body).toMatchObject({ incomplete: 3, draft: 0 });
  });

  it('a note that arrives before its invoice gets the buyer address when the invoice arrives', async () => {
    const x = tenant();
    const inv = invoiceEvent();
    const cn = creditEvent(inv);
    await x.deliver('sales.note_issued', cn);
    let note = (await x.api('GET', `/documents/${(await x.docBySource('CN-2569-0001')).id}`)).body;
    expect(note).toMatchObject({ kind: 'credit', status: 'draft', buyer_address: null, ref_invoice_no: 'INV-2569-0001', original_net: 2499.99, correct_net: 2166.66 });
    await x.deliver('sales.invoiced', inv);
    note = (await x.api('GET', `/documents/${note.id}`)).body;
    expect(note).toMatchObject({ buyer_address: ADDRESS, buyer_email: 'ap@cbp.co.th' });
  });

  it('a re-sent fact never touches a generated document, and keeps a buyer corrected here', async () => {
    const x = await readyTenant();
    expect((await x.api('PATCH', `/documents/${x.doc.id}/buyer`, { buyerName: 'บริษัท ชลบุรี พลาสติก แอนด์ โมลด์ จำกัด' })).status).toBe(200);
    await x.deliver('sales.invoiced', { ...x.inv, customerName: 'ชื่อเก่า', net: 1 });
    let d = (await x.api('GET', `/documents/${x.doc.id}`)).body;
    expect(d).toMatchObject({ status: 'draft', buyer_name: 'บริษัท ชลบุรี พลาสติก แอนด์ โมลด์ จำกัด', net: 1 }); // amounts follow Sales, buyer kept
    await x.deliver('sales.invoiced', x.inv);
    expect((await x.api('POST', `/documents/${x.doc.id}/generate`, {})).status).toBe(200);
    await x.deliver('sales.invoiced', { ...x.inv, net: 5, vat: 0.35, gross: 5.35 });
    d = (await x.api('GET', `/documents/${x.doc.id}`)).body;
    expect(d).toMatchObject({ status: 'generated', net: 2499.99, gross: 2674.99 });
  });
});

describe('seller settings and certificate', () => {
  it('validates and stores the seller profile; the certificate password is never stored', async () => {
    const x = tenant();
    expect((await x.api('GET', '/settings')).body).toMatchObject({ configured: false, has_certificate: false, sellerName: null, boundary: BOUNDARY });
    const bad = await x.api('PUT', '/settings', { ...SELLER, taxId: '0105561234561' });
    expect(bad.status).toBe(400);
    expect((await x.api('PUT', '/settings', { ...SELLER, branch: '1' })).status).toBe(400);
    // the certificate needs the seller first
    expect((await x.api('POST', '/settings/certificate', { dataBase64: p12b64('signer-aes'), password: P12_PASSWORD })).status).toBe(409);
    const ok = await x.api('PUT', '/settings', SELLER);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ configured: true, taxId: SELLER_TAX, tax_id_text: `${SELLER_TAX} สาขา สำนักงานใหญ่`, invoiceTypeCode: 'T02' });

    expect((await x.api('POST', '/settings/certificate', { dataBase64: p12b64('signer-aes') })).status).toBe(400); // no password, no env
    const wrong = await x.api('POST', '/settings/certificate', { dataBase64: p12b64('signer-aes'), password: 'nope' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toContain('รหัสผ่าน');
    expect((await x.api('POST', '/settings/certificate', { dataBase64: 'not base64!', password: P12_PASSWORD })).status).toBe(400);
    expect((await x.api('POST', '/settings/certificate', { dataBase64: Buffer.from('hello').toString('base64'), password: P12_PASSWORD })).status).toBe(400);

    const up = await x.api('POST', '/settings/certificate', { fileName: 'company.p12', dataBase64: p12b64('signer-3des'), password: P12_PASSWORD });
    expect(up.status).toBe(200);
    expect(up.body.certificate).toMatchObject({ file_name: 'company.p12', expired: false });
    expect(up.body.cert_subject).toContain('ETAX TEST SIGNER');
    // the fixture certificate belongs to 0105561234567, not this seller → a warning, not a refusal
    expect(up.body.warnings.join(' ')).toContain(SELLER_TAX);
    // … and the warning stays on the settings screen afterwards (UAT wave 9 UX finding)
    expect((await x.api('GET', '/settings')).body.cert_warnings.join(' ')).toContain(SELLER_TAX);
    const all = JSON.stringify((await x.api('GET', '/settings')).body);
    expect(all).not.toContain(P12_PASSWORD);
    expect(all).not.toContain(p12b64('signer-3des').slice(0, 40)); // the file itself is never sent back
    expect((await t.svc.db.pool.query(`select column_name from information_schema.columns where table_name = 'etax_settings' and column_name ilike '%pass%'`)).rowCount).toBe(0);

    const del = await x.api('DELETE', '/settings/certificate');
    expect(del.body).toMatchObject({ has_certificate: false, certificate: null });
  });

  it('refuses an expired certificate on upload and when signing', async () => {
    const x = await readyTenant(true);
    expect((await x.api('POST', `/documents/${x.doc.id}/generate`, {})).status).toBe(200);
    setClock('2127-01-01T00:00:00Z');
    const up = await x.api('POST', '/settings/certificate', { dataBase64: p12b64('signer-aes'), password: P12_PASSWORD });
    expect(up.status).toBe(400);
    expect(up.body.error.message).toContain('หมดอายุ');
    expect((await x.api('GET', '/settings')).body.cert_expired).toBe(true);
    const s = await x.api('POST', `/documents/${x.doc.id}/sign`, { password: P12_PASSWORD });
    expect(s.status).toBe(409);
    expect(s.body.error.message).toContain('หมดอายุ');
  });
});

describe('XML generation', () => {
  it('needs the seller profile first', async () => {
    const x = tenant();
    await x.deliver('sales.invoiced', invoiceEvent());
    const d = await x.docBySource('INV-2569-0001');
    const r = await x.api('POST', `/documents/${d.id}/generate`, {});
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain('ตั้งค่าข้อมูลผู้ขาย');
  });

  it('builds a T02 whose totals match the invoice to the satang and offers it for download', async () => {
    const x = await readyTenant();
    const g = await x.api('POST', `/documents/${x.doc.id}/generate`, {});
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ status: 'generated', type_code: 'T02', xml_available: true, signed_available: false, purpose_code: null });
    expect(g.body.verification).toMatch(/^ผ่าน/);
    expect(g.body.xml).toBeUndefined(); // the file is downloaded, not embedded in the JSON

    const xml = await xmlOf(x, x.doc.id);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const check = checkEtaxXml(xml);
    expect(check).toMatchObject({ ok: true, typeCode: 'T02' });
    expect(check.totals).toEqual({ lineTotal: 249999, allowance: 0, charge: 0, taxBasis: 249999, taxTotal: 17500, grand: 267499 });
    const root = parseXml(xml);
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:ID'))).toBe('INV-2569-0001');
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:IssueDateTime'))).toBe('2026-10-01T00:00:00');
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:PurposeCode'))).toBeUndefined();
    expect(textOf(find(root, 'rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:SellerTradeParty', 'ram:SpecifiedTaxRegistration', 'ram:ID'))).toBe(`${SELLER_TAX}00000`);
    expect(textOf(find(root, 'rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:BuyerTradeParty', 'ram:SpecifiedTaxRegistration', 'ram:ID'))).toBe(`${BUYER_TAX}00001`);
    expect(textOf(find(root, ...SUM, 'ram:GrandTotalAmount'))).toBe('2674.99');
    expect(textOf(find(root, ...SUM, 'ram:TaxTotalAmount'))).toBe('175.00');

    // 388 on request; the generated file is also in the attachments panel
    const g388 = await x.api('POST', `/documents/${x.doc.id}/generate`, { typeCode: '388' });
    expect(g388.body.type_code).toBe('388');
    const files = (await x.api('GET', `/_attachments?ref=document:${x.doc.id}`)).body;
    expect(files.map((f: any) => f.file_name)).toEqual(['INV-2569-0001.xml']);
    expect((await x.api('GET', `/documents/${x.doc.id}/verification`)).body).toMatchObject({ ok: true, signature: null });
    expect((await x.api('GET', `/documents/${x.doc.id}/xml?signed=1`)).status).toBe(409);
  });

  it('records why a document cannot be generated (no buyer address) and lets the user fix the buyer', async () => {
    const x = tenant();
    await x.api('PUT', '/settings', SELLER);
    await x.deliver('sales.invoiced', invoiceEvent({ customerAddress: null }));
    const d = await x.docBySource('INV-2569-0001');
    const g = await x.api('POST', `/documents/${d.id}/generate`, {});
    expect(g.status).toBe(422);
    expect((await x.api('GET', `/documents/${d.id}`)).body.problems_text).toContain('ไม่มีที่อยู่ผู้ซื้อ');
    expect((await x.api('PATCH', `/documents/${d.id}/buyer`, { buyerTaxId: '0105558123452' })).status).toBe(400);
    expect((await x.api('PATCH', `/documents/${d.id}/buyer`, { buyerBranch: '1' })).status).toBe(400);
    const fixed = await x.api('PATCH', `/documents/${d.id}/buyer`, { buyerAddress: ADDRESS });
    expect(fixed.body).toMatchObject({ status: 'draft', buyer_address: ADDRESS, problems_text: null });
    expect((await x.api('POST', `/documents/${d.id}/generate`, {})).status).toBe(200);
  });

  it('credit note: purpose code, reference to the original invoice and the difference to the satang', async () => {
    const x = await readyTenant();
    await x.api('POST', `/documents/${x.doc.id}/generate`, {});
    await x.deliver('sales.note_issued', creditEvent(x.inv));
    const cn = await x.docBySource('CN-2569-0001');
    expect((await x.api('GET', `/documents/${cn.id}`)).body.generate_as).toBe('note');
    expect((await x.api('POST', `/documents/${cn.id}/generate`, { purposeCode: 'DBNG01' })).status).toBe(400);
    expect((await x.api('POST', `/documents/${cn.id}/generate`, { purposeCode: 'TIVC01' })).status).toBe(400);
    expect((await x.api('POST', `/documents/${x.doc.id}/generate`, { purposeCode: 'CDNG02' })).status).toBe(400); // not on a plain invoice
    const g = await x.api('POST', `/documents/${cn.id}/generate`, { purposeCode: 'CDNG02' });
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ type_code: '81', purpose_code: 'CDNG02', purpose_label: 'CDNG02 สินค้าชำรุดเสียหาย' });
    const xml = await xmlOf(x, cn.id);
    const root = parseXml(xml);
    expect(root.name).toBe('rsm:DebitCreditNote_CrossIndustryInvoice');
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:TypeCode'))).toBe('81');
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:PurposeCode'))).toBe('CDNG02');
    expect(textOf(find(root, ...REF, 'ram:IssuerAssignedID'))).toBe('INV-2569-0001');
    expect(textOf(find(root, ...REF, 'ram:ReferenceTypeCode'))).toBe('T02');
    expect(textOf(find(root, ...SUM, 'ram:OriginalInformationAmount'))).toBe('2499.99');
    expect(textOf(find(root, ...SUM, 'ram:DifferenceInformationAmount'))).toBe('333.33');
    expect(checkEtaxXml(xml).totals).toMatchObject({ taxBasis: 33333, taxTotal: 2333, grand: 35666 });
    // without a code: "other reason" of the family
    await x.deliver('sales.note_issued', creditEvent(x.inv, { noteNo: 'DN-2569-0001', kind: 'debit', originalNet: 2499.99, correctNet: 2833.32 }));
    const dn = await x.docBySource('DN-2569-0001');
    expect((await x.api('POST', `/documents/${dn.id}/generate`, {})).body).toMatchObject({ type_code: '80', purpose_code: 'DBNG99' });
  });
});

describe('signing', () => {
  it('signs with the uploaded .p12 (password per request) and the signature verifies', async () => {
    const x = await readyTenant(true);
    expect((await x.api('POST', `/documents/${x.doc.id}/sign`, { password: P12_PASSWORD })).status).toBe(409); // no XML yet
    await x.api('POST', `/documents/${x.doc.id}/generate`, {});
    const noPw = await x.api('POST', `/documents/${x.doc.id}/sign`, {});
    expect(noPw.status).toBe(400);
    expect(noPw.body.error.message).toContain('ระบบไม่เก็บรหัสผ่าน');
    expect((await x.api('POST', `/documents/${x.doc.id}/sign`, { password: 'wrong' })).status).toBe(400);
    const s = await x.api('POST', `/documents/${x.doc.id}/sign`, { password: P12_PASSWORD });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ status: 'signed', signed_available: true });
    expect(s.body.signing_cert_subject).toContain('ETAX TEST SIGNER');
    expect(s.body.verification).toContain('ลายมือชื่อดิจิทัลถูกต้อง');

    const signed = await xmlOf(x, x.doc.id, true);
    const v = verifyXadesSignature(signed, { fingerprint256: FINGERPRINT });
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
    expect(v.signingTime).toBe('2026-10-10T10:00:00+07:00');
    expect(checkEtaxXml(signed)).toMatchObject({ ok: true });
    expect(checkEtaxXml(signed).totals?.grand).toBe(267499);
    // the unsigned file is the signed one minus the signature
    expect(signed).toContain(textOf(find(parseXml(await xmlOf(x, x.doc.id)), 'rsm:ExchangedDocument', 'ram:CreationDateTime'))!);
    expect((await x.api('GET', `/documents/${x.doc.id}/verification`)).body).toMatchObject({ ok: true, signature: { valid: true } });
    const files = (await x.api('GET', `/_attachments?ref=document:${x.doc.id}`)).body.map((f: any) => f.file_name).sort();
    expect(files).toEqual(['INV-2569-0001-signed.xml', 'INV-2569-0001.xml']);
    expect(JSON.stringify((await x.api('GET', `/documents/${x.doc.id}`)).body)).not.toContain(P12_PASSWORD);

    // re-sign is allowed; re-generating drops the signature
    expect((await x.api('POST', `/documents/${x.doc.id}/sign`, { password: P12_PASSWORD })).body.status).toBe('signed');
    expect((await x.api('POST', `/documents/${x.doc.id}/generate`, {})).body).toMatchObject({ status: 'generated', signed_available: false });
  });

  it('refuses to sign without a certificate', async () => {
    const x = await readyTenant(false);
    await x.api('POST', `/documents/${x.doc.id}/generate`, {});
    const r = await x.api('POST', `/documents/${x.doc.id}/sign`, { password: P12_PASSWORD });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('.p12');
  });

  it('the stored XML is signed only in the canonical form the module produced', async () => {
    const x = await readyTenant(true);
    await x.api('POST', `/documents/${x.doc.id}/generate`, {});
    await t.svc.db.tx(x.id, (c) => c.query(`update etax_documents set xml = regexp_replace(xml, '><', '><!--x--><') where id = $1`, [x.doc.id]));
    expect((await x.api('POST', `/documents/${x.doc.id}/sign`, { password: P12_PASSWORD })).status).toBe(409);
  });
});

describe('delivery records (the module never submits)', () => {
  it('records and un-records delivery by the user, in lock-step', async () => {
    const x = await readyTenant(true);
    const id = x.doc.id;
    expect((await x.api('POST', `/documents/${id}/mark-sent`, { channel: 'email_etda' })).status).toBe(409); // draft
    await x.api('POST', `/documents/${id}/generate`, {});
    expect((await x.api('POST', `/documents/${id}/mark-sent`, { channel: 'fax' })).status).toBe(400);
    expect((await x.api('POST', `/documents/${id}/mark-sent`, { channel: 'email_etda', sentDate: '2026-10-11' })).status).toBe(400); // future
    expect((await x.api('POST', `/documents/${id}/mark-sent`, { channel: 'email_etda', sentDate: '2026-09-30' })).status).toBe(400); // before the invoice
    await x.api('POST', `/documents/${id}/sign`, { password: P12_PASSWORD });
    const m = await x.api('POST', `/documents/${id}/mark-sent`, { channel: 'email_etda', reference: 'ETDA-REF-123', note: 'ส่งแล้ว' });
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ status: 'sent_manual', sent_channel: 'email_etda', sent_date: '2026-10-10', sent_reference: 'ETDA-REF-123', sent_by_name: expect.stringContaining('ผู้ทดสอบ') });

    // once recorded as sent: nothing that changes the file
    for (const [url, body] of [['generate', {}], ['sign', { password: P12_PASSWORD }], ['mark-sent', { channel: 'service_provider' }], ['cancel', { reason: 'ทดสอบยกเลิก' }]] as const) {
      expect((await x.api('POST', `/documents/${id}/${url}`, body)).status, url).toBe(409);
    }
    const eb = await x.api('PATCH', `/documents/${id}/buyer`, { buyerName: 'x' });
    expect(eb.status).toBe(409);
    expect(eb.body.error.message).toContain('ออกใบกำกับภาษีฉบับใหม่แทน');
    expect((await x.api('GET', `/documents/${id}`)).body.replace_allowed).toBe(true);

    const u = await x.api('POST', `/documents/${id}/unmark-sent`);
    expect(u.body).toMatchObject({ status: 'signed', sent_channel: null, sent_date: null });
    expect((await x.api('POST', `/documents/${id}/unmark-sent`)).status).toBe(409);
    // unsigned files can be delivered through a service provider (which may sign on the seller's behalf)
    await x.api('POST', `/documents/${id}/generate`, {});
    expect((await x.api('POST', `/documents/${id}/mark-sent`, { channel: 'service_provider', sentDate: '2026-10-02' })).body).toMatchObject({ status: 'sent_sp', sent_channel_label: 'ผู้ให้บริการ (Service Provider)' });
    expect((await x.api('GET', '/summary')).body).toMatchObject({ sent: 1, ready: 0 });
    expect((await x.api('GET', '/documents?status=sent')).body).toHaveLength(1);
    expect((await x.api('GET', '/documents?status=open')).body).toHaveLength(0);
  });
});

describe('cancel and replace', () => {
  it('cancels an unsent document (clears its files) and restores it', async () => {
    const x = await readyTenant(true);
    const id = x.doc.id;
    await x.api('POST', `/documents/${id}/generate`, {});
    expect((await x.api('POST', `/documents/${id}/cancel`, {})).status).toBe(400); // reason required
    const c = await x.api('POST', `/documents/${id}/cancel`, { reason: 'ออกใบกำกับภาษีแบบกระดาษแล้ว' });
    expect(c.body).toMatchObject({ status: 'cancelled', cancel_reason: 'ออกใบกำกับภาษีแบบกระดาษแล้ว', xml_available: false, generate_as: null });
    expect((await x.api('GET', `/_attachments?ref=document:${id}`)).body).toEqual([]);
    expect((await x.api('GET', `/documents/${id}/xml`)).status).toBe(409);
    for (const url of ['generate', 'sign', 'mark-sent', 'cancel', 'replace', 'unmark-sent']) {
      const body = url === 'mark-sent' ? { channel: 'email_etda' } : url === 'cancel' ? { reason: 'อีกครั้ง' } : url === 'replace' ? { purposeCode: 'TIVC99', reason: 'ทดสอบ' } : {};
      expect((await x.api('POST', `/documents/${id}/${url}`, body)).status, url).toBe(409);
    }
    // a re-sent fact does not revive it
    await x.deliver('sales.invoiced', x.inv);
    expect((await x.api('GET', `/documents/${id}`)).body.status).toBe('cancelled');
    const r = await x.api('POST', `/documents/${id}/restore`);
    expect(r.body).toMatchObject({ status: 'draft', cancel_reason: null });
    expect((await x.api('POST', `/documents/${id}/restore`)).status).toBe(409);

    // incomplete → cancelled → incomplete again
    const { lines: _l, ...old } = invoiceEvent({ invoiceNo: 'INV-OLD' });
    await x.deliver('sales.invoiced', old);
    const o = await x.docBySource('INV-OLD');
    expect((await x.api('POST', `/documents/${o.id}/cancel`, { reason: 'ออกผ่านผู้ให้บริการแทน' })).body.status).toBe('cancelled');
    expect((await x.api('POST', `/documents/${o.id}/restore`)).body.status).toBe('incomplete');
  });

  it('replaces a delivered tax invoice (TIVC02 ที่อยู่ผิด): same amounts, new XML referencing the original', async () => {
    const x = await readyTenant(true);
    const id = x.doc.id;
    expect((await x.api('POST', `/documents/${id}/replace`, { purposeCode: 'TIVC02', buyerAddress: 'x 10110' })).status).toBe(409); // not sent yet
    await x.api('POST', `/documents/${id}/generate`, {});
    await x.api('POST', `/documents/${id}/sign`, { password: P12_PASSWORD });
    await x.api('POST', `/documents/${id}/mark-sent`, { channel: 'service_provider', reference: 'SP-1' });

    expect((await x.api('POST', `/documents/${id}/replace`, { purposeCode: 'TIVC02', buyerAddress: ADDRESS })).status).toBe(400); // same address
    expect((await x.api('POST', `/documents/${id}/replace`, { purposeCode: 'TIVC01' })).status).toBe(400); // same name
    expect((await x.api('POST', `/documents/${id}/replace`, { purposeCode: 'TIVC99' })).status).toBe(400); // no reason
    expect((await x.api('POST', `/documents/${id}/replace`, { purposeCode: 'CDNG01', reason: 'x' })).status).toBe(400);
    expect((await x.api('POST', `/documents/${id}/replace`, { purposeCode: 'TIVC99', reason: 'ทดสอบ', issueDate: '2026-10-11' })).status).toBe(400);
    expect((await x.api('POST', `/documents/${id}/replace`, { purposeCode: 'TIVC99', reason: 'ทดสอบ', issueDate: '2026-09-01' })).status).toBe(400);
    expect((await x.api('POST', `/documents/${id}/replace`, { purposeCode: 'TIVC99', reason: 'ทดสอบ', docNo: 'INV-2569-0001' })).status).toBe(409); // duplicate number

    const newAddress = '88/9 ถ.สุขุมวิท ต.บ้านสวน อ.เมืองชลบุรี จ.ชลบุรี 20000';
    const rep = await x.api('POST', `/documents/${id}/replace`, { purposeCode: 'TIVC02', buyerAddress: newAddress });
    expect(rep.status).toBe(201);
    expect(rep.body).toMatchObject({
      doc_no: 'INV-2569-0001-R1', kind: 'invoice', status: 'draft', issue_date: '2026-10-10', purpose_code: 'TIVC02', generate_as: 'replacement',
      replaces_id: id, replaces_no: 'INV-2569-0001', replaces_date: '2026-10-01', buyer_address: newAddress, buyer_name: x.inv.customerName,
      net: 2499.99, vat: 175, gross: 2674.99, kind_label: 'ใบกำกับภาษี (ออกแทนฉบับเดิม)',
    });
    expect(rep.body.lines).toHaveLength(2);
    const orig = (await x.api('GET', `/documents/${id}`)).body;
    expect(orig).toMatchObject({ status: 'replaced', replaced_by_no: 'INV-2569-0001-R1', replace_allowed: false, sent_reference: 'SP-1' });
    expect((await x.api('POST', `/documents/${id}/replace`, { purposeCode: 'TIVC99', reason: 'อีกครั้ง' })).status).toBe(409);
    expect((await x.api('POST', `/documents/${id}/unmark-sent`)).status).toBe(409);

    const g = await x.api('POST', `/documents/${rep.body.id}/generate`, {});
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ type_code: 'T02', purpose_code: 'TIVC02' });
    const root = parseXml(await xmlOf(x, rep.body.id));
    expect(root.name).toBe('rsm:TaxInvoice_CrossIndustryInvoice');
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:ID'))).toBe('INV-2569-0001-R1');
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:PurposeCode'))).toBe('TIVC02');
    expect(textOf(find(root, 'rsm:ExchangedDocument', 'ram:Purpose'))).toBe('ที่อยู่ผิด');
    expect(textOf(find(root, ...REF, 'ram:IssuerAssignedID'))).toBe('INV-2569-0001');
    expect(textOf(find(root, ...REF, 'ram:IssueDateTime'))).toBe('2026-10-01T00:00:00');
    expect(textOf(find(root, ...REF, 'ram:ReferenceTypeCode'))).toBe('T02');
    expect(textOf(find(root, ...SUM, 'ram:GrandTotalAmount'))).toBe('2674.99');
    expect(textOf(find(root, 'rsm:SupplyChainTradeTransaction', 'ram:ApplicableHeaderTradeAgreement', 'ram:BuyerTradeParty', 'ram:PostalTradeAddress', 'ram:LineOne'))).toBe(newAddress);
    expect((await x.api('POST', `/documents/${rep.body.id}/generate`, { purposeCode: 'CDNG01' })).status).toBe(400);

    // a note issued later takes the corrected address
    await x.deliver('sales.note_issued', creditEvent(x.inv));
    expect((await x.api('GET', `/documents/${(await x.docBySource('CN-2569-0001')).id}`)).body.buyer_address).toBe(newAddress);

    // cancelling the unsent replacement re-opens the original; restoring it replaces the original again
    expect((await x.api('POST', `/documents/${rep.body.id}/cancel`, { reason: 'สร้างผิด' })).body.status).toBe('cancelled');
    expect((await x.api('GET', `/documents/${id}`)).body).toMatchObject({ status: 'sent_sp', replaced_by_id: null, replace_allowed: true });
    expect((await x.api('POST', `/documents/${rep.body.id}/restore`)).body.status).toBe('draft');
    expect((await x.api('GET', `/documents/${id}`)).body).toMatchObject({ status: 'replaced', replaced_by_no: 'INV-2569-0001-R1' });

    // the replacement, once sent, can itself be replaced (numbering continues)
    await x.api('POST', `/documents/${rep.body.id}/generate`, {});
    await x.api('POST', `/documents/${rep.body.id}/mark-sent`, { channel: 'email_etda' });
    const rep2 = await x.api('POST', `/documents/${rep.body.id}/replace`, { purposeCode: 'TIVC01', buyerName: 'บริษัท ชลบุรี พลาสติก (2020) จำกัด' });
    expect(rep2.body).toMatchObject({ doc_no: 'INV-2569-0001-R2', replaces_no: 'INV-2569-0001-R1', buyer_address: newAddress });
    expect((await x.api('GET', '/documents?status=replaced')).body.map((d: any) => d.doc_no).sort()).toEqual(['INV-2569-0001', 'INV-2569-0001-R1']);
  });

  it('notes cannot be replaced', async () => {
    const x = await readyTenant();
    await x.deliver('sales.note_issued', creditEvent(x.inv));
    const cn = await x.docBySource('CN-2569-0001');
    await x.api('POST', `/documents/${cn.id}/generate`, {});
    await x.api('POST', `/documents/${cn.id}/mark-sent`, { channel: 'email_etda' });
    const r = await x.api('POST', `/documents/${cn.id}/replace`, { purposeCode: 'TIVC99', reason: 'ทดสอบ' });
    expect(r.status).toBe(409);
    expect((await x.api('GET', `/documents/${cn.id}`)).body.replace_allowed).toBe(false);
  });

  it('every refusal above follows the transition table', () => {
    expect(TRANSITIONS.cancel.some((s) => s.startsWith('sent'))).toBe(false);
    expect(TRANSITIONS.replace).toEqual(['sent_manual', 'sent_sp']);
    expect(TRANSITIONS.editBuyer.some((s) => s.startsWith('sent'))).toBe(false);
  });
});

describe('generated files are protected', () => {
  it('a writer cannot delete the system XML; etax.attachment.delete can', async () => {
    const x = await readyTenant();
    await x.api('POST', `/documents/${x.doc.id}/generate`, {});
    const [file] = (await x.api('GET', `/_attachments?ref=document:${x.doc.id}`)).body;
    expect(file.uploaded_by).toBe('system:etax');
    expect((await x.api('DELETE', `/_attachments/${file.id}`, undefined, t.token([READ, WRITE], x.id))).status).toBe(403);
    expect((await x.api('DELETE', `/_attachments/${file.id}`, undefined, t.token([READ, 'etax.attachment.delete'], x.id))).status).toBe(200);
  });
});

describe('permissions', () => {
  it('every endpoint checks its permission', async () => {
    const x = await readyTenant();
    const id = x.doc.id;
    const none = t.token([], x.id);
    const reader = t.token([READ], x.id);
    const writer = t.token([READ, WRITE], x.id);
    const settings = t.token([SETTINGS], x.id);
    const cases: [string, string, unknown, string[], string[]][] = [
      // method, url, body, tokens that are refused (403), tokens that pass the permission check
      ['GET', '/documents', undefined, [none, settings], [reader]],
      ['GET', `/documents/${id}`, undefined, [none, settings], [reader]],
      ['GET', `/documents/${id}/xml`, undefined, [none, settings], [reader]],
      ['GET', `/documents/${id}/verification`, undefined, [none, settings], [reader]],
      ['GET', '/summary', undefined, [none, settings], [reader]],
      ['GET', '/meta', undefined, [none], [reader, settings]],
      ['GET', '/settings', undefined, [none], [reader, settings]],
      ['PUT', '/settings', SELLER, [none, reader, writer], [settings]],
      ['POST', '/settings/certificate', { dataBase64: p12b64('signer-aes'), password: P12_PASSWORD }, [none, reader, writer], [settings]],
      ['DELETE', '/settings/certificate', undefined, [none, reader, writer], [settings]],
      ['PATCH', `/documents/${id}/buyer`, { buyerName: 'x' }, [none, reader, settings], [writer]],
      ['POST', `/documents/${id}/generate`, {}, [none, reader, settings], [writer]],
      ['POST', `/documents/${id}/sign`, { password: 'x' }, [none, reader, settings], [writer]],
      ['POST', `/documents/${id}/mark-sent`, { channel: 'email_etda' }, [none, reader, settings], [writer]],
      ['POST', `/documents/${id}/unmark-sent`, undefined, [none, reader, settings], [writer]],
      ['POST', `/documents/${id}/cancel`, { reason: 'ทดสอบสิทธิ์' }, [none, reader, settings], [writer]],
      ['POST', `/documents/${id}/restore`, undefined, [none, reader, settings], [writer]],
      ['POST', `/documents/${id}/replace`, { purposeCode: 'TIVC99', reason: 'ทดสอบ' }, [none, reader, settings], [writer]],
      ['GET', `/_attachments?ref=document:${id}`, undefined, [none, settings], [reader]],
      ['POST', '/_attachments', { ref: `document:${id}`, fileName: 'proof.pdf', dataBase64: Buffer.from('%PDF-1.4 test').toString('base64') }, [none, reader], [writer]],
    ];
    for (const [method, url, body, refused, allowed] of cases) {
      for (const tok of refused) expect((await x.api(method, url, body, tok)).status, `${method} ${url} refused`).toBe(403);
      for (const tok of allowed) expect((await x.api(method, url, body, tok)).status, `${method} ${url} allowed`).not.toBe(403);
      expect((await t.raw(method, url, body, { token: null })).status, `${method} ${url} anonymous`).toBe(401);
    }
  });
});

describe('tenant isolation', () => {
  it('etax_documents, etax_settings and the XML attachments are invisible to another tenant', async () => {
    const x = await readyTenant(true);
    await x.api('POST', `/documents/${x.doc.id}/generate`, {});
    const other = tenant();
    expect((await other.api('GET', '/documents')).body).toEqual([]);
    expect((await other.api('GET', `/documents/${x.doc.id}`)).status).toBe(404);
    expect((await other.api('GET', `/documents/${x.doc.id}/xml`)).status).toBe(404);
    for (const url of ['generate', 'sign', 'mark-sent', 'cancel', 'restore', 'replace', 'unmark-sent']) {
      const body = url === 'mark-sent' ? { channel: 'email_etda' } : url === 'cancel' ? { reason: 'ข้ามบริษัท' } : url === 'replace' ? { purposeCode: 'TIVC99', reason: 'ข้าม' } : {};
      expect((await other.api('POST', `/documents/${x.doc.id}/${url}`, body)).status, url).toBe(404);
    }
    expect((await other.api('PATCH', `/documents/${x.doc.id}/buyer`, { buyerName: 'x' })).status).toBe(404);
    expect((await other.api('GET', '/summary')).body).toEqual({ incomplete: 0, draft: 0, ready: 0, sent: 0 });
    expect((await other.api('GET', '/settings')).body).toMatchObject({ sellerName: null, has_certificate: false, configured: false });
    expect((await other.api('GET', `/_attachments?ref=document:${x.doc.id}`)).status).toBe(404);
    // the same sales invoice id in another tenant is another document
    await other.deliver('sales.invoiced', x.inv);
    expect((await other.api('GET', '/documents')).body).toHaveLength(1);
    expect((await x.api('GET', '/documents')).body).toHaveLength(1);
    expect((await x.api('GET', `/documents/${x.doc.id}`)).body.status).toBe('generated');
    // each tenant has its own settings row; deleting one certificate does not touch the other
    await other.api('PUT', '/settings', { ...SELLER, sellerName: 'บริษัทอื่น จำกัด' });
    await other.api('DELETE', '/settings/certificate');
    expect((await x.api('GET', '/settings')).body).toMatchObject({ sellerName: SELLER.sellerName, has_certificate: true });
  });
});

describe('screens', () => {
  it('show the boundary and keep the code lists in step with the server', () => {
    expect(BOUNDARY_TEXT).toBe(BOUNDARY);
    const json = JSON.stringify(ui);
    expect(json).toContain('ไม่ได้ส่งให้กรมสรรพากร/ETDA');
    expect((ui.screens.document as any).fields[0].key).toBe('boundary');
    expect((ui.screens.settings as any).fields[0].key).toBe('boundary');
    expect(purposeCodes.map((p) => p.value).sort()).toEqual(PURPOSE_CODES.filter((p) => p.kind !== 'invoice').map((p) => p.code).sort());
    expect(replaceCodes.map((p) => p.value)).toEqual(PURPOSE_CODES.filter((p) => p.kind === 'invoice').map((p) => p.code));
  });
});
