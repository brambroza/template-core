import { describe, expect, it } from 'vitest';
import { defineUi } from '@erp/ui-schema';
import expenseUi from '../../../services/expense/src/ui.ts';
import { AiFillError, checkFile, isThaiTaxId, runAiFill } from '../src/lib/ai-fill.ts';
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
