/** Wave 5: contracts.visit_due → one PM ticket per visit. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

function tenant() {
  const id = randomUUID();
  const token = t.token(['*'], id, { userId: randomUUID(), userName: 'หัวหน้าช่าง' });
  const api = (m: string, url: string, body?: unknown, tok = token) => t.api(m, url, body, { token: tok });
  const deliver = (type: any, data: unknown) => { parseEvent(type, data); return t.deliver(type, data, { tenantId: id }); };
  return { id, api, deliver };
}

const visit = (over: Record<string, unknown> = {}) => ({
  visitId: randomUUID(), no: 'PMV-2569-0011', contractId: randomUUID(), contractNo: 'MA-2569-0003', customerId: randomUUID(), customerName: 'บริษัท ชลบุรี พลาสติก จำกัด',
  dueDate: '2026-11-02', scheduledDate: '2026-11-03', technicianId: randomUUID(), technicianName: 'ช่างวิทยา',
  itemsText: 'กล้อง IP 4MP x32 (อาคาร A) · NVR 32CH SN NVR-777', coverage: '8x5', ...over,
});

describe('helpdesk ← contracts.visit_due', () => {
  it('opens a PM ticket for the technician, due on the scheduled day, once per visit', async () => {
    const x = tenant();
    const v = visit();
    expect((await x.deliver('contracts.visit_due', v)).body.status).toBe('handled');
    await x.deliver('contracts.visit_due', v); // re-sent with a new event id
    const list = (await x.api('GET', '/tickets?q=PMV-2569-0011')).body;
    expect(list).toHaveLength(1);
    const tk = list[0];
    expect(tk).toMatchObject({
      title: 'PM MA-2569-0003 — บริษัท ชลบุรี พลาสติก จำกัด', category_name: 'PM ตามสัญญา', priority: 'normal', status: 'open',
      assignee_id: v.technicianId, assignee_name: 'ช่างวิทยา', customer_id: v.customerId, customer_name: v.customerName, requester_name: v.customerName,
      ref: 'PMV-2569-0011 (MA-2569-0003)', source_visit_id: v.visitId, created_by: null, sla_mode: 'clock',
    });
    expect(new Date(tk.due_at).toISOString()).toBe('2026-11-03T10:00:00.000Z'); // 17:00 Bangkok
    expect(tk.description).toContain('NVR-777');
    // the technician sees it in their queue
    expect((await x.api('GET', '/tickets/mine', undefined, t.token(['helpdesk.ticket.work'], x.id, { userId: v.technicianId }))).body.map((r: any) => r.id)).toEqual([tk.id]);
    // a second visit reuses the auto-created category; ticket_created is published for automation
    await x.deliver('contracts.visit_due', visit({ no: 'PMV-2569-0012', technicianId: null, technicianName: null }));
    const cats = (await x.api('GET', '/categories')).body.filter((c: any) => c.code === 'PM-MA');
    expect(cats).toHaveLength(1);
    const created = (await t.published('helpdesk.ticket_created')).map((e) => e.data).filter((d) => d.ticketId === tk.id);
    expect(created).toEqual([expect.objectContaining({ categoryName: 'PM ตามสัญญา', assigneeName: 'ช่างวิทยา', priority: 'normal' })]);
  });

  it('stays inside the tenant', async () => {
    const x = tenant();
    await x.deliver('contracts.visit_due', visit({ no: 'PMV-2569-0201' }));
    expect((await x.api('GET', '/tickets?q=PMV-2569-0201')).body).toHaveLength(1);
    expect((await tenant().api('GET', '/tickets?q=PMV-2569-0201')).body).toHaveLength(0);
  });
});
