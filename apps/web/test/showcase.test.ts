import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daysSinceCapture, lookup, NOT_RECORDED, shiftDates, READ_ONLY, resetSnapshotCache, showcaseResponse, snapshotKey, SHOWCASE_TOKEN_PREFIX, type Snapshot } from '../src/lib/showcase-server.ts';
import { aiEnv, aiOfflineText, AI_OFFLINE } from '../src/lib/assist-server.ts';
import { GET, POST } from '../src/app/api/[...path]/route.ts';

const session = (id: string, name: string, permissions: string[]) => ({
  token: `${SHOWCASE_TOKEN_PREFIX}${id}`, tenant: { id: 't1', code: 'demo', name: 'บริษัท ตัวอย่าง จำกัด' }, user: { id: `u-${id}`, email: `${id}@demo.co.th`, name }, permissions,
});

const SNAP: Snapshot = {
  version: 1,
  capturedAt: '2026-10-03',
  personas: [
    { id: 'admin', label: 'ผู้ดูแลระบบ', email: 'admin@demo.co.th', session: session('admin', 'แอดมิน', ['*']) },
    { id: 'sales', label: 'ฝ่ายขาย', email: 'sales@demo.co.th', session: session('sales', 'ปิยะพงษ์ ขายเก่ง', ['sales.order.read']) },
  ],
  responses: {
    _catalog: { s: 200, b: { modules: [{ id: 'sales' }] } },
    'master-data/items': { s: 200, b: [
      { id: 'i1', code: 'RM-STEEL', name: 'เหล็กแผ่น', type: 'raw', group: { name: 'วัตถุดิบ' } },
      { id: 'i2', code: 'FG-BOX', name: 'กล่องสำเร็จรูป', type: 'finished' },
      { id: 'i3', code: 'SP-BELT', name: 'สายพาน', type: 'spare' },
    ] },
    'master-data/items?type=spare': { s: 200, b: [{ id: 'i3', code: 'SP-BELT', name: 'สายพาน (recorded)', type: 'spare' }] },
    'sales/orders/o 1': { s: 200, b: { id: 'o 1', no: 'SO-2569-0001' } },
    'automation/notifications': { s: 200, b: { unread: 3, items: [] } },
  },
  overlays: { sales: { 'automation/notifications': { s: 200, b: { unread: 1, items: [] } } } },
};

const req = (method: string, url: string, init: { token?: string; body?: unknown } = {}) => {
  const r = new Request(`http://showcase.test${url}`, {
    method,
    headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return Object.assign(r, { nextUrl: new URL(r.url) }) as unknown as import('next/server').NextRequest;
};
const segs = (url: string) => url.split('?')[0].replace(/^\/api\//, '').split('/').map(decodeURIComponent);
const call = (method: string, url: string, init?: { token?: string; body?: unknown }) => showcaseResponse(SNAP, req(method, url, init), segs(url));
const ADMIN = `${SHOWCASE_TOKEN_PREFIX}admin`;

describe('showcase snapshot lookup', () => {
  it('keys sort the query and drop empty values', () => {
    expect(snapshotKey('/sales/orders/', '?status=open&q=&limit=5')).toBe('sales/orders?limit=5&status=open');
    expect(snapshotKey('master-data/items')).toBe('master-data/items');
  });

  it('answers an exact path+query first', () => {
    expect((lookup(SNAP, 'admin', 'master-data/items', '?type=spare')!.b as { name: string }[])[0].name).toBe('สายพาน (recorded)');
  });

  it('falls back to the unfiltered list, filtering by q (any text field, one level deep), equality params and limit', () => {
    const rows = (search: string) => (lookup(SNAP, 'admin', 'master-data/items', search)!.b as { id: string }[]).map((r) => r.id);
    expect(rows('?q=steel')).toEqual(['i1']);
    expect(rows('?q=วัตถุดิบ')).toEqual(['i1']);
    expect(rows('?type=finished&limit=50')).toEqual(['i2']);
    expect(rows('?limit=2')).toEqual(['i1', 'i2']);
    expect(rows('?unknownParam=x')).toEqual(['i1', 'i2', 'i3']);
    expect(rows('?q=ไม่มีแน่นอน')).toEqual([]);
  });

  it('returns null (→ Thai 404) for what was never recorded', async () => {
    expect(lookup(SNAP, 'admin', 'sales/orders/missing', '')).toBeNull();
    const res = await call('GET', '/api/sales/orders/missing', { token: ADMIN });
    expect(res.status).toBe(404);
    expect((await res.json()).error.message).toBe(NOT_RECORDED);
  });

  it('serves decoded path segments and the persona overlay before the admin base', async () => {
    expect((await (await call('GET', '/api/sales/orders/o%201', { token: ADMIN })).json()).no).toBe('SO-2569-0001');
    expect((await (await call('GET', '/api/automation/notifications', { token: ADMIN })).json()).unread).toBe(3);
    expect((await (await call('GET', '/api/automation/notifications', { token: `${SHOWCASE_TOKEN_PREFIX}sales` })).json()).unread).toBe(1);
  });

  it('asks for a login without a showcase token (a real JWT means nothing here)', async () => {
    expect((await call('GET', '/api/_catalog')).status).toBe(401);
    expect((await call('GET', '/api/_catalog', { token: 'eyJhbGciOi.real.jwt' })).status).toBe(401);
  });
});

describe('showcase dates stay current', () => {
  it('moves dates and timestamps by whole days, leaves months, numbers and text alone', () => {
    const out = shiftDates({ due: '2026-10-03', at: '2026-10-03T08:15:00.000Z', at2: '2026-10-03T08:15:00+07:00', month: '2026-10', no: 'SO-2569-0001', note: 'ส่ง 2026-10-03', n: 5, rows: [{ d: '2026-12-31' }] }, 2);
    expect(out).toEqual({ due: '2026-10-05', at: '2026-10-05T08:15:00.000Z', at2: '2026-10-05T01:15:00.000Z', month: '2026-10', no: 'SO-2569-0001', note: 'ส่ง 2026-10-03', n: 5, rows: [{ d: '2027-01-02' }] });
  });
  it('counts days since the capture (never negative; SHOWCASE_SHIFT_DATES=0 turns it off)', () => {
    const now = Date.parse('2026-10-10T23:00:00Z');
    expect(daysSinceCapture('2026-10-03', now)).toBe(7);
    expect(daysSinceCapture('2026-10-12', now)).toBe(0);
    expect(daysSinceCapture(undefined, now)).toBe(0);
    process.env.SHOWCASE_SHIFT_DATES = '0';
    expect(daysSinceCapture('2026-10-03', now)).toBe(0);
    delete process.env.SHOWCASE_SHIFT_DATES;
  });
});

describe('showcase login personas', () => {
  it('lists personas without tokens', async () => {
    const body = await (await call('GET', '/api/_showcase')).json();
    expect(body.personas.map((p: { id: string }) => p.id)).toEqual(['admin', 'sales']);
    expect(JSON.stringify(body)).not.toContain(SHOWCASE_TOKEN_PREFIX);
  });

  it('logs in by persona id or e-mail, with the recorded (fake-token) session', async () => {
    const byId = await (await call('POST', '/api/identity/auth/login', { body: { persona: 'sales' } })).json();
    expect(byId.token).toBe(`${SHOWCASE_TOKEN_PREFIX}sales`);
    expect(byId.permissions).toEqual(['sales.order.read']);
    const byEmail = await (await call('POST', '/api/identity/auth/login', { body: { tenant: 'demo', email: 'ADMIN@demo.co.th', password: 'x' } })).json();
    expect(byEmail.user.name).toBe('แอดมิน');
    expect((await call('POST', '/api/identity/auth/login', { body: { email: 'nobody@x.co' } })).status).toBe(401);
  });

  it('logout just says OK (the browser forgets the session)', async () => {
    expect((await call('POST', '/api/identity/logout', { token: ADMIN })).status).toBe(200);
  });
});

describe('showcase writes', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s is refused as read-only (403 showcase_read_only)', async (method) => {
    const res = await call(method, '/api/sales/orders', { token: ADMIN, body: method === 'DELETE' ? undefined : { x: 1 } });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toEqual(READ_ONLY);
  });
});

describe('the /api route', () => {
  const env = { ...process.env };
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ via: 'gateway' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    resetSnapshotCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...env };
    resetSnapshotCache();
  });
  const ctx = (url: string) => ({ params: Promise.resolve({ path: segs(url) }) });

  it('normal mode (SHOWCASE unset) still proxies to the gateway, writes included', async () => {
    delete process.env.SHOWCASE;
    delete process.env.NEXT_PUBLIC_SHOWCASE;
    process.env.GATEWAY_URL = 'http://gw.internal:8080/';
    const res = await GET(req('GET', '/api/sales/orders?status=open', { token: 'real' }), ctx('/api/sales/orders'));
    expect(await res.json()).toEqual({ via: 'gateway' });
    expect(fetchMock.mock.calls[0][0]).toBe('http://gw.internal:8080/api/sales/orders?status=open');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('authorization')).toBe('Bearer real');
    await POST(req('POST', '/api/sales/orders', { token: 'real', body: { a: 1 } }), ctx('/api/sales/orders'));
    expect(fetchMock.mock.calls[1][1].method).toBe('POST');
  });

  it('SHOWCASE=1 answers from the snapshot file and never calls the gateway', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'showcase-'));
    writeFileSync(join(dir, 'snapshot.json'), JSON.stringify(SNAP));
    process.env.SHOWCASE = '1';
    process.env.SHOWCASE_SNAPSHOT = join(dir, 'snapshot.json');
    const res = await GET(req('GET', '/api/master-data/items?q=belt', { token: ADMIN }), ctx('/api/master-data/items'));
    expect((await res.json()).map((r: { id: string }) => r.id)).toEqual(['i3']);
    expect((await POST(req('POST', '/api/sales/orders', { token: ADMIN, body: {} }), ctx('/api/sales/orders'))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('AI is off in the showcase even when the host has a key', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    delete process.env.SHOWCASE;
    expect(aiEnv()).not.toBeNull();
    expect(aiOfflineText()).toBe(AI_OFFLINE);
    process.env.SHOWCASE = '1';
    expect(aiEnv()).toBeNull();
    expect(aiOfflineText()).toContain('โหมดตัวอย่าง');
  });
});
