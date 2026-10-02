/**
 * Standard chart of accounts for a Thai SME (TFRS for NPAEs layout) and the default auto-posting rules.
 * Seeded per tenant on first use (`POST /accounts/setup`, or lazily); users may rename, add, deactivate.
 */

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type AccountCategory =
  | 'current_asset' | 'non_current_asset' | 'current_liability' | 'non_current_liability' | 'equity'
  | 'revenue' | 'other_income' | 'cost_of_sales' | 'expense' | 'income_tax';

export const TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
export const CATEGORIES: AccountCategory[] = [
  'current_asset', 'non_current_asset', 'current_liability', 'non_current_liability', 'equity',
  'revenue', 'other_income', 'cost_of_sales', 'expense', 'income_tax',
];
/** which categories a type may use; the first one is the default */
export const TYPE_CATEGORIES: Record<AccountType, AccountCategory[]> = {
  asset: ['current_asset', 'non_current_asset'],
  liability: ['current_liability', 'non_current_liability'],
  equity: ['equity'],
  revenue: ['revenue', 'other_income'],
  expense: ['expense', 'cost_of_sales', 'income_tax'],
};

/** roles the system reads (reports, summary, default rules) */
export const ROLES = [
  'cash', 'bank', 'ar', 'inventory', 'vat_input', 'vat_input_pending', 'wht_receivable', 'advance',
  'ap', 'vat_output', 'vat_output_pending', 'vat_payable', 'wht_payable', 'sso_payable', 'salary_payable', 'deposit_received',
  'retained_earnings', 'sales_revenue', 'cogs', 'expense_default',
] as const;
export type Role = (typeof ROLES)[number];

export const TYPE_TH: Record<AccountType, string> = { asset: 'สินทรัพย์', liability: 'หนี้สิน', equity: 'ส่วนของผู้ถือหุ้น', revenue: 'รายได้', expense: 'ค่าใช้จ่าย' };
export const CATEGORY_TH: Record<AccountCategory, string> = {
  current_asset: 'สินทรัพย์หมุนเวียน', non_current_asset: 'สินทรัพย์ไม่หมุนเวียน',
  current_liability: 'หนี้สินหมุนเวียน', non_current_liability: 'หนี้สินไม่หมุนเวียน', equity: 'ส่วนของผู้ถือหุ้น',
  revenue: 'รายได้จากการขาย/บริการ', other_income: 'รายได้อื่น', cost_of_sales: 'ต้นทุนขาย/ต้นทุนบริการ',
  expense: 'ค่าใช้จ่ายในการขายและบริหาร', income_tax: 'ภาษีเงินได้นิติบุคคล',
};
export const ROLE_TH: Record<Role, string> = {
  cash: 'เงินสด', bank: 'เงินฝากธนาคาร', ar: 'ลูกหนี้การค้า', inventory: 'สินค้าคงเหลือ', vat_input: 'ภาษีซื้อ',
  vat_input_pending: 'ภาษีซื้อยังไม่ถึงกำหนด', wht_receivable: 'ภาษีถูกหัก ณ ที่จ่าย', advance: 'เงินทดรองจ่าย',
  ap: 'เจ้าหนี้การค้า', vat_output: 'ภาษีขาย', vat_output_pending: 'ภาษีขายยังไม่ถึงกำหนด', vat_payable: 'ภาษีมูลค่าเพิ่มค้างจ่าย (ภ.พ.30)',
  wht_payable: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', sso_payable: 'ประกันสังคมค้างจ่าย', salary_payable: 'เงินเดือนค้างจ่าย',
  deposit_received: 'เงินมัดจำรับ', retained_earnings: 'กำไรสะสม', sales_revenue: 'รายได้จากการขาย', cogs: 'ต้นทุนขาย',
  expense_default: 'ค่าใช้จ่ายทั่วไป (ค่าเริ่มต้น)',
};

export interface SeedAccount {
  code: string;
  name: string;
  nameEn: string;
  type: AccountType;
  category: AccountCategory;
  parent?: string;
  group?: boolean;
  role?: Role;
}

const A = (code: string, name: string, nameEn: string, category: AccountCategory, parent: string | undefined, extra: Partial<SeedAccount> = {}): SeedAccount => {
  const type: AccountType = category.endsWith('asset') ? 'asset' : category.endsWith('liability') ? 'liability' : category === 'equity' ? 'equity'
    : category === 'revenue' || category === 'other_income' ? 'revenue' : 'expense';
  return { code, name, nameEn, type, category, parent, ...extra };
};
const G = { group: true };

export const STANDARD_CHART: SeedAccount[] = [
  A('10000', 'สินทรัพย์', 'Assets', 'current_asset', undefined, G),
  A('11000', 'สินทรัพย์หมุนเวียน', 'Current assets', 'current_asset', '10000', G),
  A('11100', 'เงินสด', 'Cash on hand', 'current_asset', '11000', { role: 'cash' }),
  A('11110', 'เงินสดย่อย', 'Petty cash', 'current_asset', '11000'),
  A('11200', 'เงินฝากธนาคาร - กระแสรายวัน/ออมทรัพย์', 'Cash at bank', 'current_asset', '11000', { role: 'bank' }),
  A('11300', 'ลูกหนี้การค้า', 'Trade accounts receivable', 'current_asset', '11000', { role: 'ar' }),
  A('11310', 'เช็ครับลงวันที่ล่วงหน้า', 'Post-dated cheques received', 'current_asset', '11000'),
  A('11400', 'สินค้าคงเหลือ', 'Inventories', 'current_asset', '11000', { role: 'inventory' }),
  A('11500', 'ภาษีซื้อ', 'Input VAT', 'current_asset', '11000', { role: 'vat_input' }),
  A('11510', 'ภาษีซื้อยังไม่ถึงกำหนด', 'Input VAT - not yet due', 'current_asset', '11000', { role: 'vat_input_pending' }),
  A('11600', 'ภาษีเงินได้ถูกหัก ณ ที่จ่าย', 'Withholding tax receivable', 'current_asset', '11000', { role: 'wht_receivable' }),
  A('11700', 'เงินทดรองจ่าย', 'Cash advances to employees', 'current_asset', '11000', { role: 'advance' }),
  A('11800', 'ค่าใช้จ่ายจ่ายล่วงหน้า', 'Prepaid expenses', 'current_asset', '11000'),
  A('11900', 'เงินมัดจำจ่าย', 'Deposits paid', 'current_asset', '11000'),
  A('12000', 'สินทรัพย์ไม่หมุนเวียน', 'Non-current assets', 'non_current_asset', '10000', G),
  A('12100', 'ที่ดิน', 'Land', 'non_current_asset', '12000'),
  A('12200', 'อาคารและส่วนปรับปรุงอาคาร', 'Buildings', 'non_current_asset', '12000'),
  A('12300', 'เครื่องจักรและอุปกรณ์', 'Machinery and equipment', 'non_current_asset', '12000'),
  A('12400', 'ยานพาหนะ', 'Vehicles', 'non_current_asset', '12000'),
  A('12500', 'เครื่องตกแต่งและเครื่องใช้สำนักงาน', 'Furniture and office equipment', 'non_current_asset', '12000'),
  A('12900', 'ค่าเสื่อมราคาสะสม', 'Accumulated depreciation', 'non_current_asset', '12000'),

  A('20000', 'หนี้สิน', 'Liabilities', 'current_liability', undefined, G),
  A('21000', 'หนี้สินหมุนเวียน', 'Current liabilities', 'current_liability', '20000', G),
  A('21100', 'เจ้าหนี้การค้า', 'Trade accounts payable', 'current_liability', '21000', { role: 'ap' }),
  A('21200', 'ภาษีขาย', 'Output VAT', 'current_liability', '21000', { role: 'vat_output' }),
  A('21210', 'ภาษีขายยังไม่ถึงกำหนด', 'Output VAT - not yet due', 'current_liability', '21000', { role: 'vat_output_pending' }),
  A('21220', 'ภาษีมูลค่าเพิ่มค้างจ่าย (ภ.พ.30)', 'VAT payable', 'current_liability', '21000', { role: 'vat_payable' }),
  A('21300', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย ภ.ง.ด.1', 'WHT payable - PND1 (salaries)', 'current_liability', '21000'),
  A('21310', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย ภ.ง.ด.3', 'WHT payable - PND3 (individuals)', 'current_liability', '21000', { role: 'wht_payable' }),
  A('21320', 'ภาษีหัก ณ ที่จ่ายค้างจ่าย ภ.ง.ด.53', 'WHT payable - PND53 (companies)', 'current_liability', '21000', { role: 'wht_payable' }),
  A('21400', 'เงินประกันสังคมค้างจ่าย', 'Social security payable', 'current_liability', '21000', { role: 'sso_payable' }),
  A('21500', 'เงินเดือนค้างจ่าย', 'Salaries payable', 'current_liability', '21000', { role: 'salary_payable' }),
  A('21600', 'ค่าใช้จ่ายค้างจ่าย', 'Accrued expenses', 'current_liability', '21000'),
  A('21700', 'เงินมัดจำรับ / รับล่วงหน้าจากลูกค้า', 'Customer deposits', 'current_liability', '21000', { role: 'deposit_received' }),
  A('21800', 'ภาษีเงินได้นิติบุคคลค้างจ่าย', 'Corporate income tax payable', 'current_liability', '21000'),
  A('21900', 'เงินกู้ยืมระยะสั้นจากกรรมการ', 'Short-term loans from directors', 'current_liability', '21000'),
  A('22000', 'หนี้สินไม่หมุนเวียน', 'Non-current liabilities', 'non_current_liability', '20000', G),
  A('22100', 'เงินกู้ยืมระยะยาวจากสถาบันการเงิน', 'Long-term bank loans', 'non_current_liability', '22000'),
  A('22200', 'หนี้สินตามสัญญาเช่า', 'Lease liabilities', 'non_current_liability', '22000'),

  A('30000', 'ส่วนของผู้ถือหุ้น', 'Equity', 'equity', undefined, G),
  A('31000', 'ทุนจดทะเบียนที่ชำระแล้ว', 'Paid-up share capital', 'equity', '30000'),
  A('32000', 'กำไร (ขาดทุน) สะสม', 'Retained earnings', 'equity', '30000', { role: 'retained_earnings' }),

  A('40000', 'รายได้', 'Revenue', 'revenue', undefined, G),
  A('41000', 'รายได้จากการขาย', 'Sales', 'revenue', '40000', { role: 'sales_revenue' }),
  A('41100', 'รายได้จากการให้บริการ', 'Service income', 'revenue', '40000'),
  A('41900', 'รับคืนและส่วนลดจ่าย', 'Sales returns and discounts', 'revenue', '40000'),
  A('42000', 'รายได้อื่น', 'Other income', 'other_income', '40000', G),
  A('42100', 'ดอกเบี้ยรับ', 'Interest income', 'other_income', '42000'),
  A('42200', 'กำไรจากอัตราแลกเปลี่ยน', 'Foreign exchange gain', 'other_income', '42000'),
  A('42900', 'รายได้เบ็ดเตล็ด', 'Miscellaneous income', 'other_income', '42000'),

  A('50000', 'ค่าใช้จ่าย', 'Expenses', 'expense', undefined, G),
  A('51000', 'ต้นทุนขายและต้นทุนการผลิต', 'Cost of sales', 'cost_of_sales', '50000', G),
  A('51100', 'ต้นทุนขาย', 'Cost of goods sold', 'cost_of_sales', '51000', { role: 'cogs' }),
  A('51200', 'ซื้อวัตถุดิบ/สินค้า', 'Purchases', 'cost_of_sales', '51000'),
  A('51300', 'ค่าแรงทางตรง', 'Direct labour', 'cost_of_sales', '51000'),
  A('51400', 'ค่าใช้จ่ายการผลิต', 'Manufacturing overhead', 'cost_of_sales', '51000'),
  A('52000', 'ค่าใช้จ่ายในการขายและบริหาร', 'Selling and administrative expenses', 'expense', '50000', G),
  A('52100', 'เงินเดือนและค่าจ้าง', 'Salaries and wages', 'expense', '52000'),
  A('52110', 'เงินสมทบกองทุนประกันสังคม', 'Social security contributions', 'expense', '52000'),
  A('52200', 'ค่าเช่า', 'Rent', 'expense', '52000'),
  A('52300', 'ค่าน้ำประปาและค่าไฟฟ้า', 'Utilities', 'expense', '52000'),
  A('52400', 'ค่าโทรศัพท์และอินเทอร์เน็ต', 'Telephone and internet', 'expense', '52000'),
  A('52500', 'ค่าน้ำมันและค่าเดินทาง', 'Fuel and travel', 'expense', '52000'),
  A('52600', 'ค่ารับรอง', 'Entertainment', 'expense', '52000'),
  A('52700', 'ค่าซ่อมแซมและบำรุงรักษา', 'Repairs and maintenance', 'expense', '52000'),
  A('52800', 'ค่าขนส่ง', 'Freight and delivery', 'expense', '52000'),
  A('52900', 'ค่าเสื่อมราคา', 'Depreciation', 'expense', '52000'),
  A('53000', 'ค่าธรรมเนียมธนาคาร', 'Bank charges', 'expense', '52000'),
  A('53100', 'ค่าทำบัญชีและค่าสอบบัญชี', 'Accounting and audit fees', 'expense', '52000'),
  A('53200', 'ค่าวัสดุสิ้นเปลืองและเครื่องเขียน', 'Supplies and stationery', 'expense', '52000'),
  A('53300', 'ค่าโฆษณาและส่งเสริมการขาย', 'Advertising', 'expense', '52000'),
  A('53900', 'ค่าใช้จ่ายเบ็ดเตล็ด', 'Miscellaneous expenses', 'expense', '52000', { role: 'expense_default' }),
  A('54000', 'ดอกเบี้ยจ่าย', 'Interest expense', 'expense', '50000'),
  A('55000', 'ภาษีเงินได้นิติบุคคล', 'Corporate income tax', 'income_tax', '50000'),
];

/* ---------------- auto-posting rules ---------------- */

export const POSTED_EVENTS = ['sales.invoiced', 'sales.payment_received', 'purchasing.goods_received', 'purchasing.goods_returned', 'expense.claim_paid'] as const;
export type PostedEvent = (typeof POSTED_EVENTS)[number];

export const EVENT_TH: Record<string, string> = {
  manual: 'บันทึกเอง',
  reversal: 'กลับรายการ',
  'sales.invoiced': 'ขาย — ออกใบกำกับภาษี',
  'sales.payment_received': 'ขาย — รับชำระ / รับมัดจำ',
  'purchasing.goods_received': 'จัดซื้อ — รับสินค้า',
  'purchasing.goods_returned': 'จัดซื้อ — ส่งคืนสินค้า',
  'expense.claim_paid': 'เบิกค่าใช้จ่าย — จ่ายเงิน',
};

export interface RuleSeed {
  eventType: PostedEvent;
  leg: string;
  label: string;
  side: 'debit' | 'credit' | 'both';
  /** default account code */
  code: string;
}

export const DEFAULT_RULES: RuleSeed[] = [
  { eventType: 'sales.invoiced', leg: 'ar', label: 'ลูกหนี้การค้า (ยอดรวม VAT)', side: 'debit', code: '11300' },
  { eventType: 'sales.invoiced', leg: 'revenue', label: 'รายได้จากการขาย (ก่อน VAT)', side: 'credit', code: '41000' },
  { eventType: 'sales.invoiced', leg: 'vat', label: 'ภาษีขาย', side: 'credit', code: '21200' },

  { eventType: 'sales.payment_received', leg: 'cash', label: 'รับเป็นเงินสด', side: 'debit', code: '11100' },
  { eventType: 'sales.payment_received', leg: 'bank', label: 'รับโอน / เช็ค / บัตร', side: 'debit', code: '11200' },
  { eventType: 'sales.payment_received', leg: 'wht', label: 'ภาษีถูกหัก ณ ที่จ่าย (ลูกค้าหักไว้)', side: 'debit', code: '11600' },
  { eventType: 'sales.payment_received', leg: 'deposit', label: 'เงินมัดจำรับ (รับมัดจำ = Cr, หักมัดจำ = Dr)', side: 'both', code: '21700' },
  { eventType: 'sales.payment_received', leg: 'ar', label: 'ลูกหนี้การค้า (ตัดหนี้)', side: 'credit', code: '11300' },

  { eventType: 'purchasing.goods_received', leg: 'inventory', label: 'สินค้าคงเหลือ / วัตถุดิบ', side: 'debit', code: '11400' },
  { eventType: 'purchasing.goods_received', leg: 'ap', label: 'เจ้าหนี้การค้า', side: 'credit', code: '21100' },

  { eventType: 'purchasing.goods_returned', leg: 'ap', label: 'เจ้าหนี้การค้า (ลดหนี้)', side: 'debit', code: '21100' },
  { eventType: 'purchasing.goods_returned', leg: 'inventory', label: 'สินค้าคงเหลือ (ส่งคืน)', side: 'credit', code: '11400' },

  { eventType: 'expense.claim_paid', leg: 'expense', label: 'ค่าใช้จ่าย (ยอดเบิกรวม)', side: 'debit', code: '53900' },
  { eventType: 'expense.claim_paid', leg: 'bank', label: 'จ่ายจากเงินฝากธนาคาร', side: 'credit', code: '11200' },
];
