/**
 * Credit / debit note reasons and arithmetic (wave 9). Pure and dependency-free: imported by the service and by src/ui.ts (browser).
 *
 * Legal basis (ประมวลรัษฎากร):
 * - มาตรา 82/10 — events that reduce output tax after a tax invoice was issued; มาตรา 86/10 — the seller must then issue a
 *   ใบลดหนี้ showing: the word "ใบลดหนี้", seller name/address/tax ID, buyer name/address (+ tax ID and branch, ประกาศอธิบดีฯ
 *   เกี่ยวกับภาษีเงินได้และภาษีมูลค่าเพิ่ม ฉบับที่ 199), note no. and date, the original tax invoice no. and date, the value per the
 *   original invoice, the correct value, the difference, the VAT on the difference, and the reason (a brief explanation).
 * - มาตรา 82/9 — events that increase output tax; มาตรา 86/9 — the seller issues a ใบเพิ่มหนี้ with the same content
 *   (word "ใบเพิ่มหนี้").
 * The reduction / increase belongs to the VAT month in which the note is issued (มาตรา 82/10 วรรคสอง, 82/9 วรรคสอง).
 */

export type NoteKind = 'credit' | 'debit';

/** มาตรา 82/10 (1)–(5): when a ใบลดหนี้ may be issued. `other` = เหตุอื่นตามที่อธิบดีกำหนด — needs a free-text explanation. */
export const CREDIT_REASONS: Record<string, string> = {
  spec: 'ลดราคาสินค้าเนื่องจากสินค้าผิดข้อกำหนดที่ตกลงกัน',
  damaged: 'ลดราคาสินค้าเนื่องจากสินค้าชำรุดเสียหาย',
  short: 'ลดราคาสินค้าเนื่องจากสินค้าขาดจำนวน',
  sample: 'ลดราคาสินค้าเนื่องจากสินค้าไม่ตรงตามตัวอย่างหรือคำพรรณนา',
  overcharged: 'คำนวณราคาสินค้าหรือค่าบริการผิดพลาดสูงกว่าที่เป็นจริง',
  service: 'ลดราคาค่าบริการเนื่องจากการให้บริการไม่ตรงตามข้อกำหนดที่ตกลงกัน',
  returned: 'ได้รับคืนสินค้าที่ขาย (ชำรุด ขาดจำนวน ไม่ตรงตามตัวอย่าง คำพรรณนา หรือที่ตกลงกัน)',
  cancelled: 'บอกเลิกสัญญาบริการ / คืนเงินค่าบริการที่ได้รับล่วงหน้า',
  other: 'เหตุอื่นตามที่อธิบดีกำหนด',
};

/** มาตรา 82/9 (1)–(5): when a ใบเพิ่มหนี้ must be issued. */
export const DEBIT_REASONS: Record<string, string> = {
  excess: 'เพิ่มราคาสินค้าเนื่องจากสินค้าเกินกว่าจำนวนที่ตกลงกัน',
  undercharged: 'คำนวณราคาสินค้าหรือค่าบริการผิดพลาดต่ำกว่าที่เป็นจริง',
  service: 'เพิ่มราคาค่าบริการเนื่องจากให้บริการเกินกว่าข้อกำหนดที่ตกลงกัน',
  price: 'เพิ่มราคาสินค้าหรือค่าบริการตามที่ตกลงกันภายหลัง (ราคาสูงขึ้น)',
  other: 'เหตุอื่นตามที่อธิบดีกำหนด',
};

export const reasonsOf = (kind: NoteKind) => (kind === 'credit' ? CREDIT_REASONS : DEBIT_REASONS);
export const reasonOptions = (kind: NoteKind) => Object.entries(reasonsOf(kind)).map(([value, label]) => ({ value, label }));

/** The reason printed on the note: the legal reason, then the user's explanation. */
export function reasonSentence(kind: NoteKind, code: string, text?: string | null): string {
  const base = reasonsOf(kind)[code] ?? code;
  const t = (text ?? '').trim();
  return t ? `${base} — ${t}` : base;
}

export const NOTE_TITLE: Record<NoteKind, string> = { credit: 'ใบลดหนี้', debit: 'ใบเพิ่มหนี้' };
export const NOTE_SECTION: Record<NoteKind, string> = { credit: '86/10', debit: '86/9' };
