import { describe, expect, it } from 'vitest';
import { defineUi } from '@erp/ui-schema';
import expenseUi from '../../../services/expense/src/ui.ts';
import purchasingUi from '../../../services/purchasing/src/ui.ts';
import salesUi from '../../../services/sales/src/ui.ts';
import { AiFillError, checkFile, isThaiTaxId, pickMatch, runAiFill } from '../src/lib/ai-fill.ts';
import { BriefingCache, BRIEFING_PROMPT, briefingBullets, findScreen, runBriefing, type Briefing } from '../src/lib/assistant.ts';

/* A fake Anthropic API + gateway: no network. Each model call returns the next scripted message. */
function fakes(script: any[], gateway: Record<string, unknown> = {}) {
  const calls: { url: string; init: any }[] = [];
  let i = 0;
  const fetch = (async (url: string, init: any = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/v1/messages')) return new Response(JSON.stringify(script[i++]), { status: 200 });
    const hit = Object.keys(gateway).find((p) => url.startsWith(`http://gw/api${p}`));
    if (hit) return new Response(JSON.stringify(gateway[hit]), { status: 200 });
    return new Response('{"error":"nope"}', { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  const ai = () => calls.filter((c) => c.url === 'http://ai/v1/messages').map((c) => ({ ...c, body: JSON.parse(c.init.body) }));
  return { fetch, calls, ai };
}

const env = { authorization: 'Bearer user-token', apiKey: 'sk-test', gatewayUrl: 'http://gw', baseUrl: 'http://ai', today: '2026-10-03' };
const categories = [
  { id: 'c-fuel', code: 'FUEL', name: 'ค่าน้ำมัน' },
  { id: 'c-meal', code: 'MEAL', name: 'ค่าอาหาร' },
];
const PHOTO = { mediaType: 'image/jpeg', dataBase64: 'AAAA', name: 'receipt.jpg' };

describe('สแกนใบเสร็จ (aiFill on the expense claim form)', () => {
  it('is declared on the claim form only, as data', () => {
    const claimNew = expenseUi.screens.claimNew;
    expect(claimNew.kind === 'form' && claimNew.aiFill).toEqual({ kind: 'receipt', label: 'สแกนใบเสร็จ' });
  });

  it('reads the photo with categories from the gateway and returns cleaned values for review', async () => {
    const { fetch, calls, ai } = fakes([{
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't', name: 'fill_form', input: {
        values: { purpose: 'ค่าน้ำมันไปหาลูกค้า', submit: false, claimDate: '2569-10-02' },
        lines: [
          { expenseDate: '02/10/2569', categoryId: 'c-fuel', description: 'ปตท. บางนา น้ำมันดีเซล', amount: '1,000.00', vat: 70, receiptNo: 'RC-778' },
          { categoryId: 'c-invented', amount: 5 },
        ],
        facts: { vendor: 'ปตท. สาขาบางนา', taxId: '0105555123450', total: 1070, vat: 70 },
        notes: ['เลขที่ใบเสร็จเลือนเล็กน้อย'],
      } }],
    }], { '/expense/categories': categories });

    const r = await runAiFill({ ...env, ui: expenseUi, screenId: 'claimNew', file: PHOTO, permissions: ['expense.claim.write'], fetch });

    // categories were read through the gateway with the user's token, from the path the form declares
    const gw = calls.find((c) => c.url.startsWith('http://gw/api/expense/categories'))!;
    expect(gw.url).toContain('active=true');
    expect(gw.init.headers.authorization).toBe('Bearer user-token');

    // one model call: the image, a forced tool with enums, never the ERP token
    const [call] = ai();
    expect(call.init.headers['x-api-key']).toBe('sk-test');
    expect(call.init.body).not.toContain('user-token');
    expect(call.body.model).toBe('claude-sonnet-5-5');
    expect(call.body.tool_choice).toEqual({ type: 'tool', name: 'fill_form' });
    expect(call.body.messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
    const schema = call.body.tools[0].input_schema.properties;
    expect(schema.lines.items.properties.categoryId.enum).toEqual(['c-fuel', 'c-meal']);
    expect(schema.values.properties.submit).toBeUndefined(); // "ส่งขออนุมัติทันที" stays with the person
    expect(call.body.system).toMatch(/ก่อน VAT/);

    expect(r.values).toEqual({ purpose: 'ค่าน้ำมันไปหาลูกค้า', claimDate: '2026-10-02' });
    expect(r.lines).toEqual([
      { expenseDate: '2026-10-02', categoryId: 'c-fuel', '__label.categoryId': 'FUEL ค่าน้ำมัน', description: 'ปตท. บางนา น้ำมันดีเซล', amount: 1000, vat: 70, receiptNo: 'RC-778' },
      { amount: 5 }, // invented category dropped, the person picks one
    ]);
    expect(r.facts).toContainEqual({ label: 'ผู้ขาย', value: 'ปตท. สาขาบางนา' });
    expect(r.facts).toContainEqual({ label: 'ยอดรวม', value: '1,070.00' });
    expect(r.warnings.some((w) => w.includes('ไม่ตรงกับรายการ'))).toBe(true); // 1,075 on the lines vs 1,070 on paper
    expect(r.warnings).toContain('เลขที่ใบเสร็จเลือนเล็กน้อย');
    expect(r.warnings.some((w) => w.includes('เลขผู้เสียภาษี'))).toBe(false);
  });

  it('flags a tax ID that fails the check digit and sends PDFs as documents', async () => {
    const { fetch, ai } = fakes([{ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'fill_form', input: { values: {}, facts: { taxId: '0105555123451' } } }] }], { '/expense/categories': categories });
    const r = await runAiFill({ ...env, ui: expenseUi, screenId: 'claimNew', file: { mediaType: 'application/pdf', dataBase64: 'JVBERi0=' }, permissions: [], fetch });
    expect(ai()[0].body.messages[0].content[0].type).toBe('document');
    expect(r.warnings[0]).toMatch(/เลขผู้เสียภาษี 0105555123451/);
    expect(isThaiTaxId('0105555123450')).toBe(true);
    expect(isThaiTaxId('0-1055-55123-45-0')).toBe(true);
    expect(isThaiTaxId('123')).toBe(false);
  });

  it('works without categories (lookup unavailable) and refuses forms without aiFill or bad files', async () => {
    const { fetch, ai } = fakes([{ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'fill_form', input: { values: {}, lines: [{ categoryId: 'x', amount: 10 }], facts: {} } }] }]);
    const r = await runAiFill({ ...env, ui: expenseUi, screenId: 'claimNew', file: PHOTO, permissions: [], fetch });
    expect(ai()[0].body.tools[0].input_schema.properties.lines.items.properties.categoryId).toBeUndefined();
    expect(r.lines).toEqual([{ amount: 10 }]);

    await expect(runAiFill({ ...env, ui: expenseUi, screenId: 'claimEdit', file: PHOTO, permissions: [], fetch })).rejects.toBeInstanceOf(AiFillError);
    expect(checkFile({ mediaType: 'image/heic', dataBase64: 'AAAA' }, 'receipt')).toMatch(/HEIC/);
    expect(checkFile({ mediaType: 'image/png', dataBase64: 'A'.repeat(7_100_000) }, 'receipt')).toMatch(/5 MB/);
    expect(checkFile({ mediaType: 'image/png', dataBase64: 'not base64!' }, 'receipt')).toMatch(/อ่านไม่ได้/);
    expect(checkFile(undefined, 'receipt')).toMatch(/แนบ/);
  });

  it('reports an unreadable document in Thai when the model does not use the tool', async () => {
    const { fetch } = fakes([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'อ่านไม่ออก' }] }]);
    await expect(runAiFill({ ...env, ui: expenseUi, screenId: 'claimNew', file: PHOTO, permissions: [], fetch })).rejects.toMatchObject({ status: 422 });
  });
});

describe('สร้างเอกสารจากใบเสนอราคา / PO ลูกค้า (big lookups matched by search)', () => {
  // 400 items: too many for a closed list, so the model writes what the paper says and the server searches
  const items = Array.from({ length: 400 }, (_, i) => ({ id: `i-${i}`, code: `RM-${String(i).padStart(3, '0')}`, name: `วัตถุดิบ ${i}` }))
    .concat([{ id: 'i-steel', code: 'RM-SPCC12', name: 'เหล็กแผ่น SPCC 1.2 มม.' }, { id: 'i-bolt', code: 'SP-BOLT-M8', name: 'สลักเกลียว M8' }]);
  const suppliers = [{ id: 's-1', code: 'SUP-001', name: 'บริษัท สยามสตีล จำกัด' }, { id: 's-2', code: 'SUP-002', name: 'หจก. น็อตไทย' }];
  const searches: string[] = [];
  const gateway = (async (url: string, init: any = {}) => {
    if (url.endsWith('/v1/messages')) return new Response(JSON.stringify(gateway.next.shift()), { status: 200 });
    const u = new URL(url);
    expect(init.headers.authorization).toBe('Bearer user-token'); // every lookup read uses the person's own token
    if (u.pathname === '/api/master-data/partners') return new Response(JSON.stringify(suppliers), { status: 200 });
    if (u.pathname === '/api/master-data/items') {
      const q = (u.searchParams.get('q') ?? '').toLowerCase();
      if (q) searches.push(q);
      const rows = q ? items.filter((x) => x.code.toLowerCase().includes(q) || x.name.toLowerCase().includes(q)) : items;
      return new Response(JSON.stringify(rows.slice(0, Number(u.searchParams.get('limit') ?? 100))), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as any;
  const reply = (input: unknown) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'fill_form', input }] });

  it('declares document reading on the forms where paper arrives first', () => {
    const fill = (ui: any, id: string) => ui.screens[id].aiFill;
    expect(fill(purchasingUi, 'poNew')).toMatchObject({ kind: 'document', label: 'สร้างจากใบเสนอราคา' });
    expect(fill(purchasingUi, 'billNew')).toMatchObject({ kind: 'receipt' });
    expect(fill(salesUi, 'soNew')).toMatchObject({ kind: 'document', label: 'สร้างจาก PO ลูกค้า' });
  });

  it('offers small lists as choices, finds items in a big list by code or name, and leaves unknown items for the person', async () => {
    searches.length = 0;
    gateway.next = [reply({
      values: { supplierId: 's-1', expectedDate: '15/11/2569', vatMode: 'ยังไม่รวม VAT' },
      lines: [
        { itemId: 'RM-SPCC12 เหล็กแผ่น SPCC 1.2mm', qty: '1,200', unitPrice: 32.5 },
        { itemId: 'สลักเกลียว M8', qty: 500, unitPrice: '1.20 บาท' },
        { itemId: 'XX-999 สีกันสนิม', qty: 4, unitPrice: 850 },
      ],
      facts: { vendor: 'บริษัท สยามสตีล จำกัด', total: 44_032.9 },
    })];
    const r = await runAiFill({ ...env, ui: purchasingUi, screenId: 'poNew', file: { mediaType: 'application/pdf', dataBase64: 'JVBERi0=' }, permissions: [], fetch: gateway });
    expect(r.values).toMatchObject({ supplierId: 's-1', supplierName: 'บริษัท สยามสตีล จำกัด', expectedDate: '2026-11-15', vatMode: 'exclusive' });
    expect(r.lines).toEqual([
      { itemId: 'i-steel', itemCode: 'RM-SPCC12', itemName: 'เหล็กแผ่น SPCC 1.2 มม.', 'qty': 1200, unitPrice: 32.5, '__label.itemId': 'RM-SPCC12 เหล็กแผ่น SPCC 1.2 มม.' },
      { itemId: 'i-bolt', itemCode: 'SP-BOLT-M8', itemName: 'สลักเกลียว M8', qty: 500, unitPrice: 1.2, '__label.itemId': 'SP-BOLT-M8 สลักเกลียว M8' },
      { qty: 4, unitPrice: 850 },
    ]);
    expect(r.warnings[0]).toBe('บรรทัด 3: ไม่พบสินค้า "XX-999 สีกันสนิม" ในระบบ — เลือกเอง หรือเพิ่มในข้อมูลหลักก่อน');
    expect(r.facts).toContainEqual({ label: 'ผู้ออกเอกสาร', value: 'บริษัท สยามสตีล จำกัด' });
    expect(searches).toContain('xx-999'); // retried with the first word (the code) after the full text found nothing
  });

  it('tells the model which lookups are a closed list and which are free text', async () => {
    const seen: any[] = [];
    const spy = (async (url: string, init: any) => { if (url.endsWith('/v1/messages')) seen.push(JSON.parse(init.body)); return gateway(url, init); }) as any;
    gateway.next = [reply({ values: {}, lines: [], facts: {} })];
    await runAiFill({ ...env, ui: purchasingUi, screenId: 'poNew', file: PHOTO, permissions: [], fetch: spy });
    const props = seen[0].tools[0].input_schema.properties;
    expect(props.values.properties.supplierId.enum).toEqual(['s-1', 's-2']);
    expect(props.lines.items.properties.itemId.enum).toBeUndefined();
    expect(props.lines.items.properties.itemId.description).toMatch(/ระบบจะค้นหา/);
    expect(seen[0].system).toMatch(/ใบเสนอราคา/); // the form's hint
    expect(seen[0].max_tokens).toBeGreaterThanOrEqual(4000);
  });

  it('a SO line the system cannot find keeps the text as its description', async () => {
    gateway.next = [reply({ values: {}, lines: [{ itemId: 'ค่าติดตั้งหน้างาน', qty: 1, unitPrice: 3500 }], facts: {} })];
    const r = await runAiFill({ ...env, ui: salesUi, screenId: 'soNew', file: PHOTO, permissions: [], fetch: gateway });
    expect(r.lines).toEqual([{ description: 'ค่าติดตั้งหน้างาน', qty: 1, unitPrice: 3500 }]);
  });

  it('only takes a certain match', () => {
    const f = (purchasingUi.screens.poNew as any).lines.fields[0];
    const two = [{ id: 'a', code: 'BOLT-M8', name: 'สลัก M8' }, { id: 'b', code: 'BOLT-M10', name: 'สลัก M10' }];
    expect(pickMatch(f, 'BOLT-M10 สลัก', two)?.id).toBe('b');
    expect(pickMatch(f, 'สลัก', two)).toBeNull(); // two candidates, neither exact
    expect(pickMatch(f, 'สลัก m8', two)?.id).toBe('a'); // exact name, any case/spacing
    expect(pickMatch(f, 'anything', [two[0]])?.id).toBe('a'); // the only search hit
  });
});

const purchasing = defineUi({
  module: 'purchasing', label: 'จัดซื้อ', glyph: 'ซ', menu: [],
  screens: {
    poList: { kind: 'list', title: 'ใบสั่งซื้อ', endpoint: '/purchase-orders', perm: 'purchasing.po.read', columns: [{ key: 'no', label: 'เลขที่' }],
      filters: [
        { name: 'q', label: 'ค้นหา', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: [{ value: 'draft', label: 'ร่าง' }, { value: 'approved', label: 'อนุมัติแล้ว' }] },
        { name: 'from', label: 'ตั้งแต่', type: 'date' },
      ] },
    poDetail: { kind: 'detail', title: 'ใบสั่งซื้อ', endpoint: '/purchase-orders/:id', perm: 'purchasing.po.read', heading: 'no', fields: [] },
    secret: { kind: 'list', title: 'ราคาทุนลับ', endpoint: '/secret', perm: 'purchasing.secret.read', columns: [] },
  },
  widgets: [{ id: 'po', kind: 'kpi', title: 'จัดซื้อ', endpoint: '/summary', items: [] }],
});
const perms = ['purchasing.po.read'];

describe('ค้นหาด้วย AI (⌘K)', () => {
  it('shows the model only list screens with their filter values, and opens one list with valid filters', async () => {
    const { fetch, ai } = fakes([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'o', name: 'open_screen', input: {
        module: 'purchasing', screen: 'poList', label: 'ใบสั่งซื้อร่าง', values: { status: 'ร่าง', from: '2569-10-01', q: 'เหล็ก', hack: '1' },
      } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'กรองใบสั่งซื้อร่างตั้งแต่ 1 ต.ค. ให้แล้ว' }] },
    ]);
    const r = await findScreen({ ...env, modules: [purchasing], permissions: perms, fetch, text: 'PO เหล็กที่ยังเป็นร่างตั้งแต่ต้นเดือน' });
    const system = ai()[0].body.system as string;
    expect(system).toContain('status(สถานะ: draft=ร่าง|approved=อนุมัติแล้ว)');
    expect(system).not.toContain('poDetail');
    expect(system).not.toContain('ราคาทุนลับ'); // no permission, not offered
    expect(ai()[0].body.max_tokens).toBe(600);
    expect(r.actions).toEqual([{ label: 'ใบสั่งซื้อร่าง', href: '/m/purchasing/poList?q=%E0%B9%80%E0%B8%AB%E0%B8%A5%E0%B9%87%E0%B8%81&status=draft&from=2026-10-01' }]);
    expect(r.reply).toMatch(/กรอง/);
  });

  it('returns at most one screen and nothing the user may not open', async () => {
    const { fetch } = fakes([
      { stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 'a', name: 'open_screen', input: { module: 'purchasing', screen: 'secret', label: 'ลับ' } },
        { type: 'tool_use', id: 'b', name: 'open_screen', input: { module: 'purchasing', screen: 'poList', label: 'ทั้งหมด' } },
        { type: 'tool_use', id: 'c', name: 'open_screen', input: { module: 'purchasing', screen: 'poList', label: 'อีกอัน', values: { status: 'approved' } } },
      ] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] },
    ]);
    const r = await findScreen({ ...env, modules: [purchasing], permissions: perms, fetch, text: 'ทั้งหมด' });
    expect(r.actions).toEqual([{ label: 'ทั้งหมด', href: '/m/purchasing/poList' }]);
  });
});

describe('สรุปให้หน่อย (dashboard briefing)', () => {
  it('asks the existing assistant with a fixed prompt and returns at most 5 bullets with links', async () => {
    const { fetch, ai, calls } = fakes([
      { stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 'r', name: 'read_data', input: { module: 'purchasing', path: '/summary' } },
        { type: 'tool_use', id: 'o', name: 'open_screen', input: { module: 'purchasing', screen: 'poList', label: 'ดู PO ร่าง', values: { status: 'draft' } } },
      ] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: '- **PO รออนุมัติ 3 ใบ** อนุมัติก่อนเที่ยง\n- ไม่มีของขาดสต็อก\n2) ข้อสาม\n- 4\n- 5\n- 6' }] },
    ], { '/purchasing/summary': { toApprove: 3 } });
    const b = await runBriefing({ ...env, modules: [purchasing], permissions: perms, fetch });
    expect(ai()[0].body.messages[0].content).toBe(BRIEFING_PROMPT);
    expect(calls.some((c) => c.url === 'http://gw/api/purchasing/summary')).toBe(true);
    expect(b.bullets).toEqual(['PO รออนุมัติ 3 ใบ อนุมัติก่อนเที่ยง', 'ไม่มีของขาดสต็อก', 'ข้อสาม', '4', '5']);
    expect(b.actions).toEqual([{ label: 'ดู PO ร่าง', href: '/m/purchasing/poList?status=draft' }]);
    expect(b.generatedAt).toMatch(/^\d{4}-/);
  });

  it('keeps a reply without bullets as one item', () => {
    expect(briefingBullets('วันนี้ไม่มีเรื่องด่วน')).toEqual(['วันนี้ไม่มีเรื่องด่วน']);
  });

  it('caches per user for 10 minutes, shares a run in flight and does not cache failures', async () => {
    let now = 0;
    const cache = new BriefingCache(10 * 60_000, () => now);
    let runs = 0;
    const make = async (): Promise<Briefing> => { runs++; return { reply: 'r', bullets: ['r'], actions: [], reads: [], generatedAt: 'x' }; };
    const [a, b] = await Promise.all([cache.get('u1', make), cache.get('u1', make)]);
    expect(runs).toBe(1);
    expect(a.cached).toBeUndefined();
    expect(b.cached).toBe(true);
    await cache.get('u2', make);
    expect(runs).toBe(2);
    now = 9 * 60_000;
    expect((await cache.get('u1', make)).cached).toBe(true);
    now = 10 * 60_000 + 1;
    await cache.get('u1', make);
    expect(runs).toBe(3);

    await expect(cache.get('u3', async () => { throw new Error('down'); })).rejects.toThrow('down');
    await cache.get('u3', make);
    expect(runs).toBe(4);
  });
});
