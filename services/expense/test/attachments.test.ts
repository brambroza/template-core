import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

/** Receipt photos on claims (kernel `/_attachments`, opted in by expense with the claim's own visibility rule) + the audit trail. */
let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const STAFF = ['expense.claim.read', 'expense.claim.write'];
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const today = new Date().toISOString().slice(0, 10);

describe('expense attachments', () => {
  it('lets the claimant attach a receipt that only people who can see the claim can open', async () => {
    const somchai = t.token(STAFF, t.tenantId, { userId: randomUUID(), userName: 'สมชาย' });
    const malee = t.token(STAFF, t.tenantId, { userId: randomUUID(), userName: 'มาลี' });
    const manager = t.token([...STAFF, 'expense.claim.approve'], t.tenantId, { userId: randomUUID(), userName: 'หัวหน้า' });
    const cat = (await t.api('POST', '/categories', { code: 'FUEL', name: 'ค่าน้ำมัน' })).body;
    const claim = (await t.api('POST', '/claims', { purpose: 'ไประยอง', lines: [{ expenseDate: today, categoryId: cat.id, amount: 500 }] }, { token: somchai })).body;
    const ref = `claim:${claim.id}`;

    const up = await t.api('POST', '/_attachments', { ref, fileName: 'ใบเสร็จน้ำมัน.jpg', contentType: 'image/jpeg', dataBase64: JPG.toString('base64') }, { token: somchai });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ file_name: 'ใบเสร็จน้ำมัน.jpg', content_type: 'image/jpeg', uploaded_by_name: 'สมชาย', can_delete: true });

    // staff only see their own claims -> another employee cannot list, open, attach or delete
    expect((await t.api('GET', `/_attachments?ref=${ref}`, undefined, { token: malee })).status).toBe(404);
    expect((await t.raw('GET', `/_attachments/${up.body.id}/content`, undefined, { token: malee })).status).toBe(404);
    expect((await t.api('POST', '/_attachments', { ref, fileName: 'x.jpg', dataBase64: JPG.toString('base64') }, { token: malee })).status).toBe(404);
    expect((await t.api('DELETE', `/_attachments/${up.body.id}`, undefined, { token: malee })).status).toBe(403);

    // the approver sees it (but may not delete someone else's receipt without expense.attachment.delete)
    const list = await t.api('GET', `/_attachments?ref=${ref}`, undefined, { token: manager });
    expect(list.body).toHaveLength(1);
    expect(list.body[0].can_delete).toBe(false);
    const file = await t.raw('GET', `/_attachments/${up.body.id}/content`, undefined, { token: manager });
    expect(file.status).toBe(200);
    expect(file.body.equals(JPG)).toBe(true);
    expect((await t.api('DELETE', `/_attachments/${up.body.id}`, undefined, { token: manager })).status).toBe(403);

    // read-only users (no write perm) cannot upload
    expect((await t.api('POST', '/_attachments', { ref, fileName: 'y.jpg', dataBase64: JPG.toString('base64') }, { token: t.token(['expense.claim.read', 'expense.claim.approve']) })).status).toBe(403);
    // other tenant: nothing
    expect((await t.api('GET', `/_attachments?ref=${ref}`, undefined, { token: t.token(['*'], t.otherTenantId) })).status).toBe(404);

    // the audit trail of the claim shows its creation and the upload, with names from the token
    const history = (await t.api('GET', `/_audit?ref=${claim.id}`)).body;
    expect(history.map((h: any) => [h.route, h.user_name])).toEqual([['/_attachments', 'สมชาย'], ['/claims', 'สมชาย']]);
    expect((await t.api('GET', `/_audit?ref=${claim.id}`, undefined, { token: manager })).status).toBe(403);
    expect((await t.api('GET', `/_audit?ref=${claim.id}`, undefined, { token: t.token(['expense.audit.read']) })).status).toBe(200);

    // the claimant removes their own receipt
    expect((await t.api('DELETE', `/_attachments/${up.body.id}`, undefined, { token: somchai })).status).toBe(200);
    expect((await t.api('GET', `/_attachments?ref=${ref}`, undefined, { token: somchai })).body).toEqual([]);
  });

  it('accepts advances and rejects entities the module did not declare', async () => {
    const adv = (await t.api('POST', '/advances', { purpose: 'เดินทาง', amount: 2000 })).body;
    expect((await t.api('POST', '/_attachments', { ref: `advance:${adv.id}`, fileName: 'plan.pdf', dataBase64: Buffer.from('%PDF-1.4\n').toString('base64') })).status).toBe(201);
    expect((await t.api('POST', '/_attachments', { ref: `category:${adv.id}`, fileName: 'plan.pdf', dataBase64: Buffer.from('%PDF-1.4\n').toString('base64') })).status).toBe(400);
  });
});

describe('expense attachments — QA regressions (bugs-0.4)', () => {
  it('EXP-06: once a claim is approved the claimant can no longer remove or swap its receipts; finance still can add the transfer slip', async () => {
    const owner = t.token(STAFF, t.tenantId, { userId: randomUUID(), userName: 'สมศรี' });
    const finance = t.token([...STAFF, 'expense.claim.approve', 'expense.claim.pay'], t.tenantId, { userId: randomUUID(), userName: 'การเงิน' });
    const admin = t.token(['*'], t.tenantId, { userId: randomUUID(), userName: 'ผู้ดูแล' });
    const cat = (await t.api('GET', '/categories')).body[0] ?? (await t.api('POST', '/categories', { code: 'TAXI', name: 'ค่าแท็กซี่' })).body;
    const claim = (await t.api('POST', '/claims', { purpose: 'แท็กซี่ไปลูกค้า', submit: true, lines: [{ expenseDate: today, categoryId: cat.id, amount: 300 }] }, { token: owner })).body;
    const ref = `claim:${claim.id}`;
    const up = (await t.api('POST', '/_attachments', { ref, fileName: 'ใบเสร็จ.jpg', dataBase64: JPG.toString('base64') }, { token: owner })).body;
    // still open (submitted): the owner may fix the evidence
    const extra = (await t.api('POST', '/_attachments', { ref, fileName: 'ผิดไฟล์.jpg', dataBase64: JPG.toString('base64') }, { token: owner })).body;
    expect((await t.api('DELETE', `/_attachments/${extra.id}`, undefined, { token: owner })).status).toBe(200);

    await t.api('POST', `/claims/${claim.id}/approve`, {}, { token: finance });
    await t.api('POST', `/claims/${claim.id}/pay`, { method: 'transfer' }, { token: finance });
    const del = await t.api('DELETE', `/_attachments/${up.id}`, undefined, { token: owner });
    expect(del.status).toBe(409);
    expect(del.body.error.message).toContain('จ่ายแล้ว');
    expect((await t.api('POST', '/_attachments', { ref, fileName: 'ใบใหม่.jpg', dataBase64: JPG.toString('base64') }, { token: owner })).status).toBe(409);
    const list = (await t.api('GET', `/_attachments?ref=${ref}`, undefined, { token: owner })).body;
    expect(list).toMatchObject([{ id: up.id, can_delete: false }]); // still readable, no delete button
    expect((await t.api('POST', '/_attachments', { ref, fileName: 'สลิปโอน.jpg', dataBase64: JPG.toString('base64') }, { token: finance })).status).toBe(201);
    expect((await t.api('DELETE', `/_attachments/${up.id}`, undefined, { token: admin })).status).toBe(200); // expense.attachment.delete
  });
});
