import { describe, expect, it } from 'vitest';
import { branchText, buyerInfo, signatureBoxes, companyContactLine, companyProblems, formatTaxId, isPrintable, printSpec, type DetailScreen } from '../src/index.ts';

const base: DetailScreen = { kind: 'detail', title: 'ใบสั่งซื้อ', endpoint: '/purchase-orders/:id', heading: 'no', fields: [] };

describe('print spec', () => {
  it('is null for screens that do not print', () => {
    expect(isPrintable(base)).toBe(false);
    expect(printSpec(base)).toBeNull();
    expect(isPrintable({ kind: 'list', printable: true })).toBe(false);
  });

  it('keeps `printable: true` working with defaults (title = screen title, company signatures)', () => {
    expect(printSpec({ ...base, printable: true })).toEqual({ title: 'ใบสั่งซื้อ', signatures: [], copyLabel: false, legal: 'none' });
    expect(printSpec({ ...base, printable: true }, ['ผู้จัดทำ', ' '])).toMatchObject({ signatures: [{ label: 'ผู้จัดทำ' }] });
  });

  it('uses the screen print options over the defaults', () => {
    const s = { ...base, print: { title: 'ใบกำกับภาษี / ใบเสร็จรับเงิน', signatures: ['ผู้รับเงิน', 'ผู้มีอำนาจลงนาม'], copyLabel: true, legal: 'tax-invoice' as const } };
    expect(printSpec(s, ['ไม่ใช้'])).toEqual({ title: 'ใบกำกับภาษี / ใบเสร็จรับเงิน', signatures: [{ label: 'ผู้รับเงิน' }, { label: 'ผู้มีอำนาจลงนาม' }], copyLabel: true, legal: 'tax-invoice' });
    expect(printSpec({ ...base, print: {} })).toEqual({ title: 'ใบสั่งซื้อ', signatures: [], copyLabel: false, legal: 'none' });
    // an explicit empty list means "no signature boxes", not "use the company default"
    expect(printSpec({ ...base, print: { signatures: [] } }, ['ผู้จัดทำ'])!.signatures).toEqual([]);
  });

  it('fills signer names from the record and adds one box per signer row', () => {
    const spec = printSpec({ ...base, print: { signatures: [{ label: 'ผู้ขออนุมัติ', name: 'requester_name' }], signers: { path: 'steps', label: 'ผู้อนุมัติ', name: 'approver_name' } } }, ['ไม่ใช้'])!;
    const rec = { requester_name: 'สมชาย', steps: [{ approver_name: 'หัวหน้า' }, { approver_name: null }] };
    expect(signatureBoxes(spec, rec)).toEqual([
      { label: 'ผู้ขออนุมัติ', name: 'สมชาย' }, { label: 'ผู้อนุมัติ ขั้นที่ 1', name: 'หัวหน้า' }, { label: 'ผู้อนุมัติ ขั้นที่ 2', name: undefined },
    ]);
    expect(signatureBoxes(spec, { steps: [{ approver_name: 'ก' }] })).toEqual([{ label: 'ผู้ขออนุมัติ', name: undefined }, { label: 'ผู้อนุมัติ', name: 'ก' }]);
    // signers alone do not pull in the company default labels
    expect(printSpec({ ...base, print: { signers: { path: 'steps', label: 'ผู้อนุมัติ' } } }, ['ผู้จัดทำ'])!.signatures).toEqual([]);
  });
});

describe('Thai document helpers', () => {
  it('words branches and formats tax ids', () => {
    expect(branchText('00000')).toBe('สำนักงานใหญ่');
    expect(branchText('00012')).toBe('สาขาที่ 00012');
    expect(branchText('สาขาบางนา')).toBe('สาขาบางนา');
    expect(branchText(null)).toBe('');
    expect(formatTaxId('0105559123456')).toBe('0-1055-59123-45-6');
    expect(formatTaxId('123')).toBe('123');
    expect(formatTaxId(undefined)).toBe('');
  });

  it('finds the buyer under nested or flat record paths', () => {
    expect(buyerInfo({ customer: { name: 'ลูกค้า ก', taxId: '0105559123456', branch: '00000', address: 'กทม.' } }))
      .toEqual({ name: 'ลูกค้า ก', taxId: '0105559123456', branch: '00000', address: 'กทม.', keys: ['customer.name', 'customer.address', 'customer.taxId', 'customer.branch'] });
    expect(buyerInfo({ customer_name: 'ลูกค้า ข', customer_tax_id: '', customer_branch: '00001' }))
      .toEqual({ name: 'ลูกค้า ข', branch: '00001', keys: ['customer_name', 'customer_branch'] });
    expect(buyerInfo({ no: 'X' })).toBeNull();
  });

  it('lists what the company profile lacks for a document', () => {
    expect(companyProblems({ configured: true, legal_name: 'A', address: 'x', tax_id: '0105559123456' }, 'tax-invoice')).toEqual([]);
    expect(companyProblems({ configured: true, legal_name: 'A', address: 'x' }, 'none')).toEqual([]);
    const p = companyProblems({ configured: true, legal_name: 'A', address: 'x', tax_id: null }, 'tax-invoice');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/เลขประจำตัวผู้เสียภาษี/);
    expect(companyProblems({ configured: false, legal_name: 'A' }, 'none')[0]).toMatch(/ยังไม่ได้ตั้งค่าข้อมูลบริษัท/);
    expect(companyProblems(null, 'tax-invoice')).toHaveLength(3);
    expect(companyContactLine({ phone: '02-1', email: 'a@b.co', website: null })).toBe('โทร 02-1 · อีเมล a@b.co');
  });
});
