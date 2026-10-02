import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditSummary, auth, cleanFileName, contentDisposition, createService, decodeBase64, detectFileType, forbidden, one, parse, redact, requirePerm, z, type ServiceDefinition } from '../src/index.ts';
import { bootTestService, type TestService } from '../src/testing.ts';

/** Kernel platform features every module gets: attachments (opt-in) and the audit log (always). */
const manifest = {
  id: 'notes', name: 'Notes', nameTh: 'โน้ต', version: '0.0.1', tier: 'feature' as const, description: 'fixture',
  requires: [], enhancedBy: [], publishes: [], subscribes: [],
  permissions: [
    { key: 'notes.note.read', label: 'read' }, { key: 'notes.note.write', label: 'write' },
    { key: 'notes.secret.read', label: 'secret read' }, { key: 'notes.attachment.delete', label: 'delete files' },
  ],
};

const def: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('./fixture/migrations', import.meta.url)),
  attachments: {
    read: 'notes.note.read',
    write: 'notes.note.write',
    entities: {
      note: 'notes',
      // row-level rule: only notes whose body starts with the caller's user id prefix "own:" are visible to non-admins
      private: { table: 'notes', read: 'notes.secret.read', access: async (c, a, id) => {
        const n = await one(c, 'select * from notes where id = $1', [id], 'Note');
        if (!String(n.body).startsWith(`own:${a.userId}`) && !a.perms.includes('*')) throw forbidden('Not your note');
      } },
    },
  },
  routes(app, k) {
    app.post('/notes', async (req) => {
      const a = auth(req);
      requirePerm(a, 'notes.note.write');
      const b = parse(z.object({ body: z.string(), password: z.string().optional(), logoBase64: z.string().optional() }).passthrough(), req.body);
      return k.db.tx(a.tenantId, async (c) => (await c.query('insert into notes(body) values ($1) returning *', [b.body])).rows[0]);
    });
    app.put('/notes/:id', async (req) => {
      const a = auth(req);
      const { id } = req.params as { id: string };
      return k.db.tx(a.tenantId, async (c) => one(c, 'update notes set body = $2 where id = $1 returning *', [id, (req.body as { body: string }).body], 'Note'));
    });
    app.post('/fail', async () => { throw forbidden(); });
  },
};

// tiny but real file headers
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.alloc(32, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');
const b64 = (b: Buffer) => b.toString('base64');

let t: TestService;
let noteId: string;
const READER = ['notes.note.read'];
const WRITER = ['notes.note.read', 'notes.note.write'];

beforeAll(async () => {
  t = await bootTestService(def);
  noteId = (await t.api('POST', '/notes', { body: 'hello' })).body.id;
});
afterAll(async () => { await t?.close(); });

describe('attachments', () => {
  it('uploads, lists and streams a file with a safe content-disposition', async () => {
    const up = await t.api('POST', '/_attachments', { ref: `note:${noteId}`, fileName: 'ใบเสร็จ ปตท.png', contentType: 'image/png', dataBase64: b64(PNG) },
      { token: t.token(WRITER, t.tenantId, { userId: 'u-1', userName: 'สมชาย' }) });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ ref: `note:${noteId}`, file_name: 'ใบเสร็จ ปตท.png', content_type: 'image/png', size: PNG.length, uploaded_by: 'u-1', uploaded_by_name: 'สมชาย', can_delete: true });
    expect(up.body.data).toBeUndefined();

    const list = await t.api('GET', `/_attachments?ref=note:${noteId}`, undefined, { token: t.token(READER) });
    expect(list.status).toBe(200);
    expect(list.body.map((x: any) => x.id)).toEqual([up.body.id]);
    expect(list.body[0].can_delete).toBe(false); // someone else, no delete perm

    const file = await t.raw('GET', `/_attachments/${up.body.id}/content`, undefined, { token: t.token(READER) });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(String(file.headers['content-disposition'])).toContain(`filename*=UTF-8''${encodeURIComponent('ใบเสร็จ ปตท.png')}`);
    expect(String(file.headers['content-disposition'])).toMatch(/^inline;/);
    expect(file.body.equals(PNG)).toBe(true);
  });

  it('serves a signed short-lived link without a token, and rejects a tampered one', async () => {
    const up = await t.api('POST', '/_attachments', { ref: `note:${noteId}`, fileName: 'spec.pdf', dataBase64: b64(PDF) });
    const link = await t.api('GET', `/_attachments/${up.body.id}/link`, undefined, { token: t.token(READER) });
    expect(link.status).toBe(200);
    expect(link.body.url).toMatch(new RegExp(`^/_attachments/${up.body.id}/content\\?`));
    const ok = await t.raw('GET', link.body.url, undefined, { token: null });
    expect(ok.status).toBe(200);
    expect(ok.body.equals(PDF)).toBe(true);
    expect((await t.raw('GET', link.body.url.replace(/sig=[^&]+/, 'sig=AAAA'), undefined, { token: null })).status).toBe(401);
    expect((await t.raw('GET', link.body.url.replace(/t=[^&]+/, `t=${t.otherTenantId}`), undefined, { token: null })).status).toBe(401);
    expect((await t.raw('GET', `/_attachments/${up.body.id}/content`, undefined, { token: null })).status).toBe(401);
  });

  it('validates size, type and magic bytes', async () => {
    const post = (fileName: string, data: Buffer | string) => t.api('POST', '/_attachments', { ref: `note:${noteId}`, fileName, dataBase64: typeof data === 'string' ? data : b64(data) });
    expect((await post('evil.exe', Buffer.from('MZ\x90\x00'))).status).toBe(400);
    expect((await post('evil.svg', Buffer.from('<svg onload=alert(1)>'))).status).toBe(400);
    const fake = await post('photo.jpg', Buffer.from('<html><script>alert(1)</script>'));
    expect(fake.status).toBe(400);
    expect(fake.body.error.message).toContain('.jpg');
    expect((await post('scan.pdf', PNG)).status).toBe(400);
    expect((await post('data.csv', Buffer.from([0x41, 0x00, 0x42]))).status).toBe(400);
    expect((await post('bad.png', 'not base64!!')).status).toBe(400);
    expect((await post('empty.txt', '')).status).toBe(400);
    expect((await post('ok.jpeg', JPG)).status).toBe(201);
    expect((await post('ok.csv', Buffer.from('รหัส,ชื่อ\nA,บี\n'))).status).toBe(201);
    expect((await post('ok.xlsx', Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(20)]))).status).toBe(201);
    // 5 MB + 1 byte after decoding -> 413 before anything is stored
    const big = await post('big.png', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 - PNG.length + 1)]));
    expect(big.status).toBe(413);
    const exact = await post('max.png', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 - PNG.length)]));
    expect(exact.status).toBe(201);
  });

  it('checks the record and the entity', async () => {
    const post = (ref: string) => t.api('POST', '/_attachments', { ref, fileName: 'a.png', dataBase64: b64(PNG) });
    expect((await post(`note:${randomUUID()}`)).status).toBe(404);
    expect((await post('note:not-a-uuid')).status).toBe(404);
    expect((await post(`invoice:${noteId}`)).status).toBe(400);
    expect((await post(`note:${noteId}; drop table notes`)).status).toBe(400);
    expect((await t.api('GET', '/_attachments')).status).toBe(400);
  });

  it('requires the module permissions and the entity access rule', async () => {
    const ref = `note:${noteId}`;
    expect((await t.api('GET', `/_attachments?ref=${ref}`, undefined, { token: t.token(['notes.note.write']) })).status).toBe(403);
    expect((await t.api('POST', '/_attachments', { ref, fileName: 'a.png', dataBase64: b64(PNG) }, { token: t.token(READER) })).status).toBe(403);

    const mine = (await t.api('POST', '/notes', { body: 'own:u-9 diary' })).body.id;
    const other = (await t.api('POST', '/notes', { body: 'own:u-8 diary' })).body.id;
    const u9 = t.token(['notes.secret.read', 'notes.note.write'], t.tenantId, { userId: 'u-9' });
    expect((await t.api('POST', '/_attachments', { ref: `private:${mine}`, fileName: 'a.png', dataBase64: b64(PNG) }, { token: u9 })).status).toBe(201);
    expect((await t.api('GET', `/_attachments?ref=private:${mine}`, undefined, { token: u9 })).body).toHaveLength(1);
    expect((await t.api('GET', `/_attachments?ref=private:${other}`, undefined, { token: u9 })).status).toBe(403);
    // the entity's own read perm replaces the module default
    expect((await t.api('GET', `/_attachments?ref=private:${mine}`, undefined, { token: t.token(READER, t.tenantId, { userId: 'u-9' }) })).status).toBe(403);
    // a direct content fetch is checked the same way
    const theirs = (await t.api('POST', '/_attachments', { ref: `private:${other}`, fileName: 'b.png', dataBase64: b64(PNG) })).body.id;
    expect((await t.raw('GET', `/_attachments/${theirs}/content`, undefined, { token: u9 })).status).toBe(403);
    expect((await t.api('GET', `/_attachments/${theirs}/link`, undefined, { token: u9 })).status).toBe(403);
  });

  it('lets the uploader or a delete permission remove a file', async () => {
    const owner = t.token(WRITER, t.tenantId, { userId: 'u-up' });
    const up = (await t.api('POST', '/_attachments', { ref: `note:${noteId}`, fileName: 'x.png', dataBase64: b64(PNG) }, { token: owner })).body;
    expect((await t.api('DELETE', `/_attachments/${up.id}`, undefined, { token: t.token(WRITER) })).status).toBe(403);
    expect((await t.api('DELETE', `/_attachments/${up.id}`, undefined, { token: owner })).status).toBe(200);
    expect((await t.api('DELETE', `/_attachments/${up.id}`, undefined, { token: owner })).status).toBe(404);
    const again = (await t.api('POST', '/_attachments', { ref: `note:${noteId}`, fileName: 'y.png', dataBase64: b64(PNG) }, { token: owner })).body;
    expect((await t.api('DELETE', `/_attachments/${again.id}`, undefined, { token: t.token(['notes.attachment.delete']) })).status).toBe(200);
  });

  it('isolates tenants with row-level security', async () => {
    const up = (await t.api('POST', '/_attachments', { ref: `note:${noteId}`, fileName: 'tenant.png', dataBase64: b64(PNG) })).body;
    const other = t.token(['*'], t.otherTenantId);
    // the record does not exist for the other tenant, nor does the file
    expect((await t.api('GET', `/_attachments?ref=note:${noteId}`, undefined, { token: other })).status).toBe(404);
    expect((await t.raw('GET', `/_attachments/${up.id}/content`, undefined, { token: other })).status).toBe(404);
    expect((await t.api('DELETE', `/_attachments/${up.id}`, undefined, { token: other })).status).toBe(404);
    const otherNote = (await t.api('POST', '/notes', { body: 'theirs' }, { token: other })).body.id;
    expect((await t.api('POST', '/_attachments', { ref: `note:${otherNote}`, fileName: 'o.png', dataBase64: b64(PNG) }, { token: other })).status).toBe(201);
    expect((await t.api('GET', `/_attachments?ref=note:${otherNote}`)).status).toBe(404);
    // without a tenant context the table shows nothing at all
    expect((await t.svc.db.pool.query('select * from _attachments')).rowCount).toBe(0);
  });

  it('is not mounted for modules that do not opt in, and refuses undeclared permissions', async () => {
    const plain = createService({ ...def, attachments: undefined }, { DATABASE_URL: 'postgres://unused@127.0.0.1:1/x', JWT_SECRET: 'x', INTERNAL_TOKEN: 'x' });
    await plain.app.ready();
    expect(plain.app.hasRoute({ method: 'GET', url: '/_attachments' })).toBe(false);
    expect(plain.app.hasRoute({ method: 'GET', url: '/_audit' })).toBe(true);
    await plain.close();
    expect(() => createService({ ...def, attachments: { read: 'notes.nope.read', write: 'notes.note.write', entities: { note: 'notes' } } },
      { DATABASE_URL: 'postgres://unused@127.0.0.1:1/x', JWT_SECRET: 'x', INTERNAL_TOKEN: 'x' })).toThrow(/notes.nope.read/);
  });

  it('cleans file names and builds headers', () => {
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('C:\\Users\\a\\ใบ:เสร็จ?.pdf')).toBe('ใบ_เสร็จ_.pdf');
    expect(cleanFileName('...hidden.txt')).toBe('hidden.txt');
    expect(contentDisposition('attachment', 'ใบ "a".pdf')).toBe(`attachment; filename="__ _a_.pdf"; filename*=UTF-8''${encodeURIComponent('ใบ "a".pdf')}`);
    expect(detectFileType('IMG_1.HEIC', Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(8)])).type).toBe('image/heic');
    expect(decodeBase64(`data:image/png;base64,${b64(PNG)}`).equals(PNG)).toBe(true);
  });
});

describe('audit log', () => {
  it('records successful writes with the user, route, record id and a redacted body', async () => {
    const tok = t.token(['*'], t.tenantId, { userId: 'u-audit', userName: 'วิชัย' });
    const created = (await t.api('POST', '/notes', { body: 'audited', password: 'hunter2', logoBase64: 'AAAA', lineToken: 'x', items: [1, 2] }, { token: tok })).body;
    await t.api('PUT', `/notes/${created.id}`, { body: 'changed' }, { token: tok });
    await t.api('POST', '/fail', {}, { token: tok }); // 403: not recorded
    await t.api('GET', '/_attachments?ref=note:' + created.id, undefined, { token: tok }); // GET: not recorded

    const rows = (await t.api('GET', `/_audit?ref=${created.id}`)).body;
    expect(rows.map((r: any) => `${r.method} ${r.route}`)).toEqual([`PUT /notes/:id`, 'POST /notes']);
    expect(rows[1]).toMatchObject({ user_id: 'u-audit', user_name: 'วิชัย', entity_id: created.id, status: 200, summary: { body: 'audited', items: [1, 2] } });
    expect(JSON.stringify(rows)).not.toMatch(/hunter2|logoBase64|lineToken|password/);
    expect((await t.api('GET', '/_audit?q=fail')).body).toEqual([]);

    // attachment uploads are filed under the record they belong to, without the file contents
    await t.api('POST', '/_attachments', { ref: `note:${created.id}`, fileName: 'r.png', dataBase64: b64(PNG) }, { token: tok });
    const after = (await t.api('GET', `/_audit?ref=note:${created.id}`)).body;
    expect(after[0]).toMatchObject({ route: '/_attachments', entity_id: created.id, summary: { ref: `note:${created.id}`, fileName: 'r.png' } });
    expect(JSON.stringify(after[0].summary)).not.toContain(b64(PNG));
  });

  it('filters by user, text and date, and needs <module>.audit.read', async () => {
    const tok = t.token(['*'], t.tenantId, { userId: 'u-filter', userName: 'มานี' });
    await t.api('POST', '/notes', { body: 'filter-me' }, { token: tok });
    expect((await t.api('GET', '/_audit?userId=u-filter')).body).toHaveLength(1);
    expect((await t.api('GET', '/_audit?q=มานี')).body).toHaveLength(1);
    expect((await t.api('GET', '/_audit?q=filter-me')).body).toHaveLength(1);
    expect((await t.api('GET', '/_audit?userId=u-filter&from=2000-01-01&to=2000-01-02')).body).toHaveLength(0);
    const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); // Bangkok day
    expect((await t.api('GET', `/_audit?userId=u-filter&from=${today}&to=${today}`)).body).toHaveLength(1);
    expect((await t.api('GET', '/_audit', undefined, { token: t.token(['notes.note.read']) })).status).toBe(403);
    expect((await t.api('GET', '/_audit', undefined, { token: t.token(['notes.audit.read']) })).status).toBe(200);
    expect((await t.api('GET', '/_audit', undefined, { token: t.token(['notes.*']) })).status).toBe(200);
    expect((await t.api('GET', '/_audit?limit=9999')).status).toBe(400);
  });

  it('isolates tenants with row-level security', async () => {
    const other = t.token(['*'], t.otherTenantId, { userId: 'u-other' });
    await t.api('POST', '/notes', { body: 'other tenant' }, { token: other });
    const theirs = (await t.api('GET', '/_audit', undefined, { token: other })).body;
    expect(theirs.length).toBeGreaterThan(0);
    expect(theirs.filter((r: any) => ['u-audit', 'u-filter'].includes(r.user_id))).toEqual([]);
    expect((await t.api('GET', '/_audit?userId=u-other')).body).toEqual([]);
    expect((await t.svc.db.pool.query('select * from _audit')).rowCount).toBe(0);
  });

  it('declares <module>.audit.read in the served manifest', async () => {
    const m = (await t.svc.app.inject({ method: 'GET', url: '/_manifest' })).json();
    expect(m.permissions.map((p: any) => p.key)).toContain('notes.audit.read');
  });

  it('redacts and caps summaries', () => {
    expect(redact({ a: 1, newPassword: 'x', apiToken: 'y', client_secret: 'z', fileBase64: 'q', logo: 'l', nested: { password: 'p', ok: true } }))
      .toEqual({ a: 1, nested: { ok: true } });
    const big = auditSummary({ text: 'x'.repeat(5000), lines: Array.from({ length: 500 }, (_, i) => ({ i, note: 'บันทึกยาว'.repeat(30) })) }) as any;
    expect(Buffer.byteLength(JSON.stringify(big))).toBeLessThanOrEqual(2048);
    expect(big._truncated).toBe(true);
    expect(auditSummary({})).toBeNull();
  });

  it('SEC-10 (security review 0.3): drops API keys, OTPs, PINs and auth headers; masks passports', () => {
    expect(redact({ apiKey: 'k', api_key: 'k', privateKey: 'k', otp: '123456', otpCode: '1', pin: '1234', credentials: 'c', authorization: 'Bearer x', passportNo: 'AA1234567', name: 'ok', signatureLabels: ['ผู้อนุมัติ'] }))
      .toEqual({ passportNo: '••••4567', name: 'ok', signatureLabels: ['ผู้อนุมัติ'] });
  });

  it('keeps only the last 4 digits of bank account / ID numbers (bugs-0.4 PAY-01)', () => {
    expect(redact({ bankAccount: '123-4-56789-0', bank_account: '1234567890', accountNo: '9876543210', idCard: '1-1037-02345-67-8', bankName: 'กสิกร', empty: null }))
      .toEqual({ bankAccount: '••••7890', bank_account: '••••7890', accountNo: '••••3210', idCard: '••••5678', bankName: 'กสิกร', empty: null });
    // inside imported rows too
    expect(redact({ rows: [{ employeeCode: 'E1', bankAccount: '111-2-33333-4' }] })).toEqual({ rows: [{ employeeCode: 'E1', bankAccount: '••••3334' }] });
  });
});
