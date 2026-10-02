/** Wave 9: withholding tax helpers — arithmetic in satang, ภ.ง.ด.3 vs ภ.ง.ด.53, due dates, the ใบแนบ exports. */
import { describe, expect, it } from 'vitest';
import {
  buildRdPrepText, buildWhtCsv, checkWhtLine, formatThaiMonth, isJuristicTaxId, RD_PREP_COLUMNS, splitThaiName, thaiSlashDate, toTis620,
  WHT_INCOME_TYPES, whtAmount, whtDueDates, whtFormFor, whtTotals, type WhtReturnRow,
} from '../src/index.ts';

describe('WHT arithmetic (round(base × rate) half-up to the satang)', () => {
  it.each([
    [12345.67, 0.03, 370.37], // 370.3701
    [333.33, 0.03, 10.0], // 9.9999
    [1050.5, 0.05, 52.53], // 52.525 → half-up
    [99.95, 0.01, 1.0], // 0.9995
    [1234.56, 0.02, 24.69], // 24.6912
    [10000, 0.03, 300],
    [0.01, 0.03, 0],
    [16.67, 0.03, 0.5], // 0.5001
  ])('%s × %s = %s', (base, rate, tax) => {
    expect(whtAmount(base, rate)).toBe(tax);
    expect(Number.isInteger(Math.round(whtAmount(base, rate) * 100))).toBe(true);
  });

  it('standard rates of the income types (ท.ป.4/2528)', () => {
    expect(Object.fromEntries(Object.values(WHT_INCOME_TYPES).map((t) => [t.code, t.rate]))).toEqual({
      service: 0.03, rent: 0.05, transport: 0.01, advertising: 0.02, hire_of_work: 0.03, promotion: 0.03, professional: 0.03, other: null,
    });
  });

  it('checkWhtLine: default rate, overrides, warnings and hard errors', () => {
    expect(checkWhtLine({ incomeType: 'service', base: 5000 })).toEqual({ rate: 0.03, description: 'ค่าบริการ', amount: 150, warnings: [] });
    // reduced rate (e.g. e-Withholding) is allowed with a warning
    const r = checkWhtLine({ incomeType: 'service', base: 5000, rate: 0.01 });
    expect(r.amount).toBe(50);
    expect(r.warnings[0]).toContain('ต่างจากอัตราปกติ');
    // under 1,000 baht: warn for service, not for rent
    expect(checkWhtLine({ incomeType: 'service', base: 999.99 }).warnings.join()).toContain('ต่ำกว่า 1,000 บาท');
    expect(checkWhtLine({ incomeType: 'rent', base: 800 }).warnings).toEqual([]);
    expect(checkWhtLine({ incomeType: 'rent', base: 800 }).amount).toBe(40);
    expect(() => checkWhtLine({ incomeType: 'other', base: 1000 })).toThrow('ต้องระบุอัตรา');
    expect(() => checkWhtLine({ incomeType: 'other', base: 1000, rate: 0.1 })).toThrow('คำอธิบาย');
    expect(checkWhtLine({ incomeType: 'other', base: 1000, rate: 0.1, description: 'ค่าลิขสิทธิ์' })).toMatchObject({ description: 'ค่าลิขสิทธิ์', amount: 100 });
    expect(() => checkWhtLine({ incomeType: 'service', base: 1000, rate: 0 })).toThrow();
    expect(() => checkWhtLine({ incomeType: 'service', base: 1000, rate: 1 })).toThrow();
    expect(() => checkWhtLine({ incomeType: 'nope', base: 1000 })).toThrow('ไม่รู้จัก');
  });
});

describe('ภ.ง.ด.3 vs ภ.ง.ด.53', () => {
  it('defaults from the 13-digit tax ID (juristic IDs start with 0), else from the name', () => {
    expect(whtFormFor('0105537000015')).toBe('PND53');
    expect(whtFormFor('0-1055-37000-01-5')).toBe('PND53');
    expect(whtFormFor('1101700203450')).toBe('PND3');
    expect(whtFormFor('3100600123450', 'บริษัท ชื่อแปลก จำกัด')).toBe('PND3'); // the ID wins
    expect(whtFormFor(null, 'บริษัท เอบีซี จำกัด')).toBe('PND53');
    expect(whtFormFor(null, 'หจก. ช่างดี')).toBe('PND53');
    expect(whtFormFor(null, 'นายสมชาย ใจดี')).toBe('PND3');
    expect(whtFormFor(undefined, undefined)).toBe('PND3');
    expect(isJuristicTaxId('0105537000015')).toBe(true);
    expect(isJuristicTaxId('1101700203450')).toBe(false);
  });

  it('splits names into คำนำหน้า / ชื่อ / ชื่อสกุล', () => {
    expect(splitThaiName('นาย สมชาย  ใจดี', 'PND3')).toEqual({ title: 'นาย', firstName: 'สมชาย', lastName: 'ใจดี' });
    expect(splitThaiName('นางสาวสมศรี มีสุข', 'PND3')).toEqual({ title: 'นางสาว', firstName: 'สมศรี', lastName: 'มีสุข' });
    expect(splitThaiName('บริษัท เอบีซี จำกัด', 'PND53')).toEqual({ title: 'บริษัท', firstName: 'เอบีซี จำกัด', lastName: '' });
    expect(splitThaiName('ห้างหุ้นส่วนจำกัด ช่างดี', 'PND53')).toEqual({ title: 'ห้างหุ้นส่วนจำกัด', firstName: 'ช่างดี', lastName: '' });
  });
});

describe('due dates & dates', () => {
  it('7th (paper) and 15th (e-filing) of the next month', () => {
    expect(whtDueDates('2026-09')).toEqual({ paper: '2026-10-07', efiling: '2026-10-15' });
    expect(whtDueDates('2026-12')).toEqual({ paper: '2027-01-07', efiling: '2027-01-15' });
    expect(() => whtDueDates('2026-13')).toThrow();
  });
  it('Thai formats', () => {
    expect(thaiSlashDate('2026-09-05')).toBe('05/09/2569');
    expect(formatThaiMonth('2026-09')).toBe('กันยายน 2569');
  });
});

describe('ใบแนบ exports', () => {
  const rows: WhtReturnRow[] = [
    { seq: 1, taxId: '0105537000015', branch: '00000', name: 'บริษัท เอบีซี จำกัด', address: '1 ถ.สุขุมวิท|กรุงเทพฯ', paidDate: '2026-09-05', incomeType: 'ค่าบริการ', rate: 0.03, amount: 12345.67, tax: 370.37, condition: '1' },
    { seq: 1, taxId: '0105537000015', branch: '00000', name: 'บริษัท เอบีซี จำกัด', address: '1 ถ.สุขุมวิท|กรุงเทพฯ', paidDate: '2026-09-05', incomeType: 'ค่าขนส่ง', rate: 0.01, amount: 1000, tax: 10, condition: '1' },
    { seq: 2, taxId: '0994000161239', branch: '1', name: 'ห้างหุ้นส่วนจำกัด ช่างดี', address: null, paidDate: '2026-09-30', incomeType: 'ค่าเช่า', rate: 0.05, amount: 20000, tax: 1000, condition: '1' },
  ];

  it('totals', () => {
    expect(whtTotals(rows)).toEqual({ payees: 2, lines: 3, amount: 33345.67, tax: 1380.37 });
  });

  it('RD Prep text (ภ.ง.ด.53) — pipe-delimited, CRLF, BE dates, no thousands separators', () => {
    expect(buildRdPrepText(rows, 'PND53')).toBe(
      '1|0105537000015|00000|บริษัท|เอบีซี จำกัด|1 ถ.สุขุมวิท กรุงเทพฯ|05/09/2569|ค่าบริการ|3.00|12345.67|370.37|1\r\n' +
      '1|0105537000015|00000|บริษัท|เอบีซี จำกัด|1 ถ.สุขุมวิท กรุงเทพฯ|05/09/2569|ค่าขนส่ง|1.00|1000.00|10.00|1\r\n' +
      '2|0994000161239|00001|ห้างหุ้นส่วนจำกัด|ช่างดี||30/09/2569|ค่าเช่า|5.00|20000.00|1000.00|1\r\n');
    expect(buildRdPrepText([], 'PND53')).toBe('');
  });

  it('RD Prep text (ภ.ง.ด.3) has ชื่อสกุล', () => {
    const p3: WhtReturnRow[] = [{ seq: 1, taxId: '1101700203450', branch: null, name: 'นาย สมชาย ใจดี', address: '9 ม.2 ต.บางพลี', paidDate: '2026-09-10', incomeType: 'ค่าจ้างทำของ', rate: 0.03, amount: 1500, tax: 45, condition: '1' }];
    expect(buildRdPrepText(p3, 'PND3')).toBe('1|1101700203450|00000|นาย|สมชาย|ใจดี|9 ม.2 ต.บางพลี|10/09/2569|ค่าจ้างทำของ|3.00|1500.00|45.00|1\r\n');
    expect(RD_PREP_COLUMNS.PND3).toHaveLength(13);
    expect(RD_PREP_COLUMNS.PND53).toHaveLength(12);
  });

  it('CSV with BOM, Thai headers and a total row', () => {
    const csv = buildWhtCsv(rows, 'PND53');
    expect(csv.startsWith('﻿ลำดับที่,เลขประจำตัวผู้เสียภาษีอากร,สาขาที่,คำนำหน้าชื่อ,ชื่อ,ที่อยู่,วันเดือนปีที่จ่าย,ประเภทเงินได้,อัตราภาษีร้อยละ,จำนวนเงินที่จ่าย,จำนวนเงินภาษีที่หักและนำส่ง,เงื่อนไขการหักภาษี\r\n')).toBe(true);
    expect(csv).toContain('\r\n2,0994000161239,00001,ห้างหุ้นส่วนจำกัด,ช่างดี,,30/09/2569,ค่าเช่า,5.00,20000.00,1000.00,1\r\n');
    expect(csv.endsWith('\r\nรวม,,,,,,,,,33345.67,1380.37,\r\n')).toBe(true);
  });

  it('TIS-620 encoding', () => {
    expect([...toTis620('ก1|ฮ')]).toEqual([0xa1, 0x31, 0x7c, 0xce]);
    expect([...toTis620('ภ.ง.ด.')]).toEqual([0xc0, 0x2e, 0xa7, 0x2e, 0xb4, 0x2e]);
    expect([...toTis620('€')]).toEqual([0x3f]);
  });
});
