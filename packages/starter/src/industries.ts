/**
 * Sample data a trial company starts with, per type of business. Small on purpose: enough that every screen of the plan has
 * something real to look at, and that the owner's first clicks (approve a PO, receive goods, ship an order) work at once.
 *
 * Every company and tax ID is made up. The tax IDs pass the mod-11 check digit but belong to no real company.
 * Item codes are short and readable, because the owner will type them in searches.
 */

export type IndustryId = 'trading' | 'food' | 'metal';

/** [code, name, type, unit, standard price] */
export type ItemRow = readonly [string, string, 'raw' | 'semi' | 'finished' | 'spare' | 'service', string, number];
/** [code, name, kind, tax ID, address, credit days] */
export type PartnerRow = readonly [string, string, 'customer' | 'supplier', string, string, number];
/** [item code, qty, unit price] */
export type Line = readonly [string, number, number];

export interface Industry {
  id: IndustryId;
  nameTh: string;
  /** one line under the choice on the sign-up page */
  blurb: string;
  items: ItemRow[];
  partners: PartnerRow[];
  /** [code, name]: the first one is where purchases, sales and production run */
  warehouses: readonly (readonly [string, string])[];
  /** stock counted on the first day (refType "opening"): [item code, qty, unit cost] */
  opening: Line[];
  /** [item code, min qty]: reorder alerts on the dashboard */
  reorder: readonly (readonly [string, number])[];
  /** purchase orders: received, approved and waiting to be received, waiting for the owner's approval */
  purchases: { daysAgo: number; supplier: string; lines: Line[]; stage: 'received' | 'approved' | 'submitted' }[];
  /** sales orders, oldest first. Stock items only: a delivered service line would be issued from stock (inventory has no service type) */
  sales: { daysAgo: number; customer: string; lines: Line[]; stage: 'invoiced' | 'delivered' | 'confirmed' | 'draft' }[];
  /** bills of materials: product → [component, qty per unit, scrap %] */
  boms?: { item: string; lines: readonly (readonly [string, number, number?])[] }[];
  /** production orders */
  production?: { item: string; qty: number; dueInDays: number; stage: 'completed' | 'released' | 'planned' }[];
  /** machines [code, name, location] with one open repair and PM plans [machine, title, every N days] */
  machines?: readonly (readonly [string, string, string])[];
  repair?: { machine: string; title: string };
  pm?: readonly (readonly [string, string, number])[];
  /** incoming / final QC plans */
  qc?: { item: string; stage: 'incoming' | 'final'; name: string; checkpoints: Record<string, unknown>[] }[];
}

const BKK = 'กรุงเทพมหานคร';

const TRADING: Industry = {
  id: 'trading',
  nameTh: 'ซื้อมาขายไป / ค้าส่ง',
  blurb: 'ร้านวัสดุก่อสร้างตัวอย่าง: ซื้อจากผู้ผลิต เก็บในคลัง ขายให้ผู้รับเหมา',
  items: [
    ['CEM-50', 'ปูนซีเมนต์ปอร์ตแลนด์ 50 กก.', 'finished', 'ถุง', 165],
    ['SAND-Q', 'ทรายหยาบ', 'finished', 'คิว', 650],
    ['RB-12', 'เหล็กเส้นข้ออ้อย DB12', 'finished', 'เส้น', 189],
    ['RB-16', 'เหล็กเส้นข้ออ้อย DB16', 'finished', 'เส้น', 335],
    ['TILE-60', 'กระเบื้องแกรนิตโต้ 60x60', 'finished', 'กล่อง', 420],
    ['PVC-4', 'ท่อ PVC 4 นิ้ว ชั้น 8.5', 'finished', 'เส้น', 395],
    ['PAINT-W', 'สีน้ำอะครีลิกขาว 18 ลิตร', 'finished', 'ถัง', 1650],
    ['DELIVERY', 'ค่าขนส่ง', 'service', 'เที่ยว', 500],
  ],
  partners: [
    ['S-001', 'บริษัท ปูนไทยอุตสาหกรรม จำกัด (ตัวอย่าง)', 'supplier', '0105536000313', `1 ถนนพหลโยธิน แขวงจตุจักร เขตจตุจักร ${BKK} 10900`, 30],
    ['S-002', 'บริษัท เหล็กสยามค้าส่ง จำกัด (ตัวอย่าง)', 'supplier', '0105547023450', '9 หมู่ 3 ตำบลบางเสาธง อำเภอบางเสาธง จังหวัดสมุทรปราการ 10570', 30],
    ['S-003', 'บริษัท เซรามิกไทย จำกัด (ตัวอย่าง)', 'supplier', '0103546007891', '77 หมู่ 5 ตำบลหน้าพระลาน อำเภอเฉลิมพระเกียรติ จังหวัดสระบุรี 18240', 45],
    ['C-001', 'หจก. ช่างดีก่อสร้าง (ตัวอย่าง)', 'customer', '0205555011227', '12/3 หมู่ 2 ตำบลบางพูด อำเภอปากเกร็ด จังหวัดนนทบุรี 11120', 30],
    ['C-002', 'บริษัท บ้านสวยรับเหมา จำกัด (ตัวอย่าง)', 'customer', '0215558024681', `88 ถนนรามอินทรา แขวงคันนายาว เขตคันนายาว ${BKK} 10230`, 30],
    ['C-003', 'บริษัท ไทยโฮมดีเวลลอปเม้นท์ จำกัด (ตัวอย่าง)', 'customer', '0105558034563', '5/9 หมู่ 1 ตำบลคลองหนึ่ง อำเภอคลองหลวง จังหวัดปทุมธานี 12120', 60],
  ],
  warehouses: [['MAIN', 'คลังสินค้าหลัก'], ['YARD', 'ลานเก็บทรายและเหล็ก']],
  opening: [['CEM-50', 400, 138], ['SAND-Q', 20, 520], ['RB-12', 300, 158], ['RB-16', 120, 285], ['TILE-60', 150, 340], ['PVC-4', 80, 318], ['PAINT-W', 24, 1320]],
  reorder: [['CEM-50', 200], ['RB-12', 150], ['PAINT-W', 10]],
  purchases: [
    { daysAgo: 12, supplier: 'S-001', lines: [['CEM-50', 600, 136]], stage: 'received' },
    { daysAgo: 6, supplier: 'S-002', lines: [['RB-12', 200, 156], ['RB-16', 100, 282]], stage: 'received' },
    { daysAgo: 2, supplier: 'S-003', lines: [['TILE-60', 100, 338]], stage: 'approved' },
    { daysAgo: 0, supplier: 'S-001', lines: [['CEM-50', 400, 137]], stage: 'submitted' },
  ],
  sales: [
    { daysAgo: 10, customer: 'C-001', lines: [['CEM-50', 250, 165], ['SAND-Q', 6, 650]], stage: 'invoiced' },
    { daysAgo: 7, customer: 'C-003', lines: [['RB-12', 180, 189], ['RB-16', 60, 335]], stage: 'invoiced' },
    { daysAgo: 3, customer: 'C-002', lines: [['TILE-60', 80, 420], ['PAINT-W', 6, 1650]], stage: 'delivered' },
    { daysAgo: 1, customer: 'C-001', lines: [['CEM-50', 150, 165], ['PVC-4', 20, 395]], stage: 'confirmed' },
    { daysAgo: 0, customer: 'C-003', lines: [['RB-12', 100, 185]], stage: 'draft' },
  ],
};

const FOOD: Industry = {
  id: 'food',
  nameTh: 'อาหาร / แปรรูป',
  blurb: 'โรงงานน้ำพริกและซอสตัวอย่าง: รับวัตถุดิบพร้อมตรวจคุณภาพ ผลิตตามสูตร ส่งร้านค้าส่ง',
  items: [
    ['RM-CHILI', 'พริกแห้ง', 'raw', 'กก.', 145],
    ['RM-GARLIC', 'กระเทียมไทย', 'raw', 'กก.', 95],
    ['RM-SUGAR', 'น้ำตาลทราย', 'raw', 'กก.', 24],
    ['RM-OIL', 'น้ำมันถั่วเหลือง', 'raw', 'ลิตร', 52],
    ['RM-FISHS', 'น้ำปลาแท้', 'raw', 'ลิตร', 38],
    ['PK-JAR200', 'ขวดแก้ว 200 ก. พร้อมฝา', 'raw', 'ใบ', 6.5],
    ['PK-LABEL', 'ฉลากสินค้า', 'raw', 'ดวง', 0.8],
    ['SA-PASTE', 'น้ำพริกเผาพร้อมบรรจุ', 'semi', 'กก.', 0],
    ['FG-NPP200', 'น้ำพริกเผา 200 ก.', 'finished', 'ขวด', 45],
    ['FG-SAUCE300', 'ซอสพริก 300 มล.', 'finished', 'ขวด', 32],
    ['SP-GASKET', 'ยางซีลเครื่องบรรจุ', 'spare', 'ชิ้น', 350],
  ],
  partners: [
    ['S-001', 'บริษัท เกษตรรวมใจ จำกัด (ตัวอย่าง)', 'supplier', '0105536000313', '45 หมู่ 7 ตำบลท่าข้าม อำเภอสามพราน จังหวัดนครปฐม 73110', 15],
    ['S-002', 'บริษัท ไทยบรรจุภัณฑ์แก้ว จำกัด (ตัวอย่าง)', 'supplier', '0105547023450', `300 ถนนพระราม 2 แขวงแสมดำ เขตบางขุนเทียน ${BKK} 10150`, 30],
    ['S-003', 'บริษัท น้ำตาลและน้ำมันพืช จำกัด (ตัวอย่าง)', 'supplier', '0103546007891', '18 หมู่ 2 ตำบลบ้านโป่ง อำเภอบ้านโป่ง จังหวัดราชบุรี 70110', 30],
    ['C-001', 'บริษัท ค้าส่งอาหารไทย จำกัด (ตัวอย่าง)', 'customer', '0205555011227', `99 ถนนเพชรเกษม แขวงหนองค้างพลู เขตหนองแขม ${BKK} 10160`, 30],
    ['C-002', 'ห้างหุ้นส่วนจำกัด ตลาดสดเจริญ (ตัวอย่าง)', 'customer', '0215558024681', '7 ถนนมิตรภาพ ตำบลในเมือง อำเภอเมืองนครราชสีมา จังหวัดนครราชสีมา 30000', 15],
    ['C-003', 'บริษัท มินิมาร์ทชุมชน จำกัด (ตัวอย่าง)', 'customer', '0105558034563', '120 ถนนนิมมานเหมินท์ ตำบลสุเทพ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200', 30],
  ],
  warehouses: [['MAIN', 'คลังวัตถุดิบและสินค้า'], ['COLD', 'ห้องเย็นวัตถุดิบสด']],
  opening: [['RM-CHILI', 120, 140], ['RM-GARLIC', 80, 90], ['RM-SUGAR', 300, 23], ['RM-OIL', 200, 50], ['RM-FISHS', 100, 36], ['PK-JAR200', 3000, 6.2], ['PK-LABEL', 5000, 0.75], ['FG-NPP200', 900, 26], ['FG-SAUCE300', 600, 18], ['SP-GASKET', 4, 340]],
  reorder: [['RM-CHILI', 60], ['PK-JAR200', 1500], ['FG-NPP200', 300]],
  purchases: [
    { daysAgo: 9, supplier: 'S-001', lines: [['RM-CHILI', 100, 142], ['RM-GARLIC', 60, 92]], stage: 'received' },
    { daysAgo: 5, supplier: 'S-002', lines: [['PK-JAR200', 2000, 6.3]], stage: 'received' },
    { daysAgo: 2, supplier: 'S-003', lines: [['RM-SUGAR', 500, 23.5], ['RM-OIL', 200, 51]], stage: 'approved' },
    { daysAgo: 0, supplier: 'S-001', lines: [['RM-CHILI', 80, 145]], stage: 'submitted' },
  ],
  sales: [
    { daysAgo: 8, customer: 'C-001', lines: [['FG-NPP200', 400, 45], ['FG-SAUCE300', 300, 32]], stage: 'invoiced' },
    { daysAgo: 4, customer: 'C-003', lines: [['FG-NPP200', 150, 46]], stage: 'delivered' },
    { daysAgo: 1, customer: 'C-002', lines: [['FG-NPP200', 120, 45], ['FG-SAUCE300', 100, 32]], stage: 'confirmed' },
  ],
  boms: [
    { item: 'SA-PASTE', lines: [['RM-CHILI', 0.35, 3], ['RM-GARLIC', 0.2, 5], ['RM-SUGAR', 0.25], ['RM-OIL', 0.3], ['RM-FISHS', 0.05]] },
    { item: 'FG-NPP200', lines: [['SA-PASTE', 0.2, 2], ['PK-JAR200', 1], ['PK-LABEL', 1]] },
  ],
  production: [
    { item: 'SA-PASTE', qty: 100, dueInDays: -3, stage: 'completed' },
    { item: 'FG-NPP200', qty: 400, dueInDays: -2, stage: 'completed' },
    { item: 'FG-NPP200', qty: 300, dueInDays: 2, stage: 'released' },
  ],
  machines: [['MIX-01', 'หม้อกวนน้ำพริก 200 ลิตร', 'ไลน์ผลิต'], ['FILL-01', 'เครื่องบรรจุขวดอัตโนมัติ', 'ไลน์บรรจุ'], ['CAP-01', 'เครื่องปิดฝาขวด', 'ไลน์บรรจุ']],
  repair: { machine: 'FILL-01', title: 'หัวบรรจุหยด ปริมาณไม่คงที่' },
  pm: [['MIX-01', 'ล้างและตรวจใบกวน', 7], ['FILL-01', 'เปลี่ยนยางซีลหัวบรรจุ', 30]],
  qc: [
    { item: 'RM-CHILI', stage: 'incoming', name: 'ตรวจรับพริกแห้ง', checkpoints: [
      { name: 'ความชื้น', method: 'เครื่องวัดความชื้น', type: 'measure', unit: '%', target: 10, min: 0, max: 13, critical: true },
      { name: 'ไม่มีเชื้อรา สิ่งแปลกปลอม', method: 'ตรวจด้วยสายตา', type: 'visual', critical: true },
    ] },
    { item: 'FG-NPP200', stage: 'final', name: 'ตรวจก่อนส่ง น้ำพริกเผา 200 ก.', checkpoints: [
      { name: 'น้ำหนักสุทธิ', method: 'ชั่งตัวอย่าง', type: 'measure', unit: 'ก.', target: 200, min: 198, max: 206, critical: true },
      { name: 'ฝาปิดสนิท ฉลากและวันหมดอายุครบ', type: 'pass_fail', critical: true },
    ] },
  ],
};

const METAL: Industry = {
  id: 'metal',
  nameTh: 'โรงงานชิ้นส่วนโลหะ / งานกลึง',
  blurb: 'โรงกลึงตัวอย่าง: ซื้อเหล็กเพลา กลึงตามแบบลูกค้า ดูแลเครื่อง CNC',
  items: [
    ['RM-S45C-25', 'เหล็กเพลา S45C Ø25 มม.', 'raw', 'กก.', 42],
    ['RM-S45C-50', 'เหล็กเพลา S45C Ø50 มม.', 'raw', 'กก.', 41],
    ['RM-AL6061', 'อะลูมิเนียม 6061 แท่ง Ø40', 'raw', 'กก.', 135],
    ['RM-SUS304R', 'สแตนเลส SUS304 แท่ง Ø30', 'raw', 'กก.', 125],
    ['SP-INSERT', 'เม็ดมีดกลึง CNMG', 'spare', 'เม็ด', 180],
    ['SP-COOLANT', 'น้ำมันหล่อเย็น', 'spare', 'ลิตร', 120],
    ['FG-SHAFT-A', 'เพลาส่งกำลัง SH-A (ตามแบบ)', 'finished', 'ชิ้น', 380],
    ['FG-BUSH-B', 'บูชทองเหลือง BU-B', 'finished', 'ชิ้น', 95],
    ['FG-FLANGE', 'หน้าแปลนอะลูมิเนียม FL-40', 'finished', 'ชิ้น', 520],
    ['MACHINING', 'ค่าแรงกลึงตามแบบ', 'service', 'ชั่วโมง', 650],
  ],
  partners: [
    ['S-001', 'บริษัท เหล็กเพลาไทย จำกัด (ตัวอย่าง)', 'supplier', '0105536000313', '222 หมู่ 4 ตำบลบางปลา อำเภอบางพลี จังหวัดสมุทรปราการ 10540', 30],
    ['S-002', 'บริษัท อะลูมิเนียมสยาม จำกัด (ตัวอย่าง)', 'supplier', '0105547023450', `50 ถนนกาญจนาภิเษก แขวงบางแค เขตบางแค ${BKK} 10160`, 30],
    ['S-003', 'ร้านเครื่องมือช่างเจริญ (ตัวอย่าง)', 'supplier', '0103546007891', '3/1 ถนนสุขุมวิท ตำบลปากน้ำ อำเภอเมืองสมุทรปราการ จังหวัดสมุทรปราการ 10270', 0],
    ['C-001', 'บริษัท ไทยออโต้พาร์ท จำกัด (ตัวอย่าง)', 'customer', '0205555011227', '700 หมู่ 6 นิคมอุตสาหกรรมอมตะซิตี้ ตำบลมาบยางพร อำเภอปลวกแดง จังหวัดระยอง 21140', 60],
    ['C-002', 'บริษัท อีสเทิร์นแมชชีนเนอรี่ จำกัด (ตัวอย่าง)', 'customer', '0215558024681', '19 หมู่ 1 ตำบลบ้านเก่า อำเภอพานทอง จังหวัดชลบุรี 20160', 30],
    ['C-003', 'บริษัท โรงงานน้ำตาลเกษตร จำกัด (ตัวอย่าง)', 'customer', '0105558034563', '8 หมู่ 9 ตำบลบ้านโป่ง อำเภอบ้านโป่ง จังหวัดราชบุรี 70110', 30],
  ],
  warehouses: [['MAIN', 'คลังวัตถุดิบและชิ้นงาน'], ['TOOL', 'ห้องเครื่องมือและอะไหล่']],
  opening: [['RM-S45C-25', 600, 40], ['RM-S45C-50', 800, 39.5], ['RM-AL6061', 150, 130], ['RM-SUS304R', 120, 121], ['SP-INSERT', 60, 175], ['SP-COOLANT', 80, 115], ['FG-SHAFT-A', 40, 210], ['FG-BUSH-B', 300, 48]],
  reorder: [['RM-S45C-25', 300], ['SP-INSERT', 30]],
  purchases: [
    { daysAgo: 11, supplier: 'S-001', lines: [['RM-S45C-25', 500, 41.5], ['RM-S45C-50', 400, 40.5]], stage: 'received' },
    { daysAgo: 6, supplier: 'S-003', lines: [['SP-INSERT', 40, 178], ['SP-COOLANT', 40, 118]], stage: 'received' },
    { daysAgo: 2, supplier: 'S-002', lines: [['RM-AL6061', 200, 133]], stage: 'approved' },
    { daysAgo: 0, supplier: 'S-001', lines: [['RM-SUS304R', 150, 124]], stage: 'submitted' },
  ],
  sales: [
    { daysAgo: 9, customer: 'C-001', lines: [['FG-SHAFT-A', 60, 380]], stage: 'invoiced' },
    { daysAgo: 5, customer: 'C-002', lines: [['FG-BUSH-B', 200, 95]], stage: 'invoiced' },
    { daysAgo: 2, customer: 'C-003', lines: [['FG-SHAFT-A', 20, 395]], stage: 'delivered' },
    { daysAgo: 1, customer: 'C-001', lines: [['FG-FLANGE', 30, 520]], stage: 'confirmed' },
  ],
  boms: [
    { item: 'FG-SHAFT-A', lines: [['RM-S45C-50', 3.2, 8]] },
    { item: 'FG-FLANGE', lines: [['RM-AL6061', 0.9, 10]] },
  ],
  production: [
    { item: 'FG-SHAFT-A', qty: 60, dueInDays: -4, stage: 'completed' },
    { item: 'FG-FLANGE', qty: 40, dueInDays: 3, stage: 'released' },
    { item: 'FG-SHAFT-A', qty: 50, dueInDays: 10, stage: 'planned' },
  ],
  machines: [['CNC-01', 'เครื่องกลึง CNC 2 แกน', 'ไลน์กลึง'], ['CNC-02', 'เครื่องกัด CNC 3 แกน', 'ไลน์กัด'], ['LATHE-01', 'เครื่องกลึงธรรมดา', 'ไลน์กลึง']],
  repair: { machine: 'CNC-02', title: 'สปินเดิลมีเสียงดังที่รอบสูง' },
  pm: [['CNC-01', 'เปลี่ยนน้ำมันหล่อลื่นรางเลื่อน', 30], ['CNC-02', 'ตรวจความเที่ยงตรงแกน (Backlash)', 90]],
  qc: [
    { item: 'FG-SHAFT-A', stage: 'final', name: 'ตรวจขนาดเพลา SH-A ก่อนส่ง', checkpoints: [
      { name: 'เส้นผ่านศูนย์กลาง', method: 'ไมโครมิเตอร์', type: 'measure', unit: 'มม.', target: 45, min: 44.98, max: 45.02, critical: true },
      { name: 'ความยาวรวม', method: 'เวอร์เนียร์', type: 'measure', unit: 'มม.', target: 250, min: 249.8, max: 250.2 },
      { name: 'ผิวไม่มีรอยกระแทก', type: 'visual' },
    ] },
  ],
};

export const INDUSTRIES: Record<IndustryId, Industry> = { trading: TRADING, food: FOOD, metal: METAL };
export const INDUSTRY_IDS = Object.keys(INDUSTRIES) as IndustryId[];
export const isIndustry = (v: unknown): v is IndustryId => typeof v === 'string' && v in INDUSTRIES;
