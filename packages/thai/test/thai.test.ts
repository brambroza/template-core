import { describe, expect, it } from 'vitest';
import { documentTotals, bahtText, calcVat, formatThaiDate, isValidThaiTaxId, promptPayPayload, round, toBuddhistYear } from '../src/index.ts';

describe('thai pack', () => {
  it('rounds money half-up', () => {
    expect(round(1.005)).toBe(1.01);
    expect(round(2.675)).toBe(2.68);
    expect(round(-1.005)).toBe(-1.01);
    expect(round(100.005)).toBe(100.01);
  });

  it('calculates VAT both ways', () => {
    expect(calcVat(1000)).toEqual({ net: 1000, vat: 70, gross: 1070 });
    expect(calcVat(1070, 'inclusive')).toEqual({ net: 1000, vat: 70, gross: 1070 });
  });

  it('totals documents', () => {
    expect(documentTotals([{ qty: 3, unitPrice: 33.335 }, { qty: 1, unitPrice: 100 }])).toEqual({ amounts: [100.01, 100], net: 200.01, vat: 14, gross: 214.01 });
  });

  it('formats Buddhist-era dates', () => {
    expect(toBuddhistYear('2026-10-02')).toBe(2569);
    expect(formatThaiDate('2026-10-02')).toBe('2 ตุลาคม 2569');
    expect(formatThaiDate('2026-10-02', 'short')).toBe('2 ต.ค. 69');
  });

  it('reads baht amounts', () => {
    expect(bahtText(0)).toBe('ศูนย์บาทถ้วน');
    expect(bahtText(11)).toBe('สิบเอ็ดบาทถ้วน');
    expect(bahtText(21)).toBe('ยี่สิบเอ็ดบาทถ้วน');
    expect(bahtText(101)).toBe('หนึ่งร้อยเอ็ดบาทถ้วน');
    expect(bahtText(1070)).toBe('หนึ่งพันเจ็ดสิบบาทถ้วน');
    expect(bahtText(1234.5)).toBe('หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์');
    expect(bahtText(0.25)).toBe('ยี่สิบห้าสตางค์');
    expect(bahtText(1_000_000)).toBe('หนึ่งล้านบาทถ้วน');
    expect(bahtText(21_000_001)).toBe('ยี่สิบเอ็ดล้านเอ็ดบาทถ้วน');
  });

  it('validates tax IDs', () => {
    expect(isValidThaiTaxId('0105536000313')).toBe(true);
    expect(isValidThaiTaxId('0105536000315')).toBe(false);
    expect(isValidThaiTaxId('123')).toBe(false);
  });

  it('builds PromptPay payloads with a valid CRC', () => {
    const p = promptPayPayload('0812345678', 100);
    expect(p).toContain('0066812345678');
    expect(p).toContain('5406100.00');
    expect(p).toMatch(/6304[0-9A-F]{4}$/);
    expect(promptPayPayload('0812345678')).toMatch(/^000201010211/);
    expect(promptPayPayload('0105536000315')).toContain('02130105536000315');
  });
});
