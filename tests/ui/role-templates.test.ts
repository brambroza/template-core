import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyTemplate, permInstalled, ROLE_TEMPLATES } from '../../services/identity/src/role-templates.ts';

/**
 * Identity's role templates are a static list (identity cannot read other modules). This keeps the list honest
 * against the real module.json files of this repo: a renamed or removed permission fails here, not at a customer.
 */
const SERVICES = fileURLToPath(new URL('../../services', import.meta.url));
const manifests = readdirSync(SERVICES).filter((d) => existsSync(`${SERVICES}/${d}/module.json`))
  .map((d) => JSON.parse(readFileSync(`${SERVICES}/${d}/module.json`, 'utf8')) as { id: string; permissions: { key: string }[] });
const declared = new Set(manifests.flatMap((m) => m.permissions.map((p) => p.key)));
const ids = manifests.map((m) => m.id);

describe('role templates', () => {
  it('use only permissions some module declares', () => {
    const unknown = ROLE_TEMPLATES.flatMap((t) => t.permissions.filter((p) => !declared.has(p)).map((p) => `${t.id}: ${p}`));
    expect(unknown).toEqual([]);
  });

  it('map every permission to the module that declares it', () => {
    for (const m of manifests) for (const p of m.permissions) {
      expect(permInstalled(p.key, [m.id]), `${p.key} -> ${m.id}`).toBe(true);
      expect(permInstalled(p.key, ids.filter((x) => x !== m.id)), `${p.key} without ${m.id}`).toBe(false);
    }
  });

  it('have unique ids and names, and every template grants something on a full installation', () => {
    expect(new Set(ROLE_TEMPLATES.map((t) => t.id)).size).toBe(ROLE_TEMPLATES.length);
    expect(new Set(ROLE_TEMPLATES.map((t) => t.name)).size).toBe(ROLE_TEMPLATES.length);
    for (const t of ROLE_TEMPLATES) expect(applyTemplate(t, ids).permissions.length, t.id).toBeGreaterThan(0);
  });

  const tpl = (id: string) => ROLE_TEMPLATES.find((t) => t.id === id)!.permissions;

  it('give each round-2 demo role what its job needs (wave 8, N3)', () => {
    expect(tpl('warehouse')).toEqual(expect.arrayContaining(['purchasing.po.read', 'purchasing.po.receive', 'inventory.move.write']));
    expect(tpl('qc')).toEqual(expect.arrayContaining(['inventory.hold.release', 'quality.inspection.record']));
    for (const id of ['it', 'pm', 'technician', 'sales']) expect(tpl(id), id).toContain('master.partner.read');
    expect(tpl('technician')).toEqual(expect.arrayContaining(['contracts.visit.read', 'contracts.visit.work']));
  });

  it('keep segregation of duties: approval limits at the top, nobody both raises and approves POs or approves and pays claims', () => {
    expect(tpl('executive')).toEqual(expect.arrayContaining(['purchasing.po.approve', 'purchasing.po.approve-high', 'expense.claim.approve-over-limit']));
    for (const t of ROLE_TEMPLATES) {
      if (t.id !== 'executive') {
        expect(t.permissions, t.id).not.toContain('purchasing.po.approve-high');
        expect(t.permissions, t.id).not.toContain('expense.claim.approve-over-limit');
      }
      // raising a PO and approving it stay in different roles
      expect(t.permissions.includes('purchasing.po.write') && t.permissions.includes('purchasing.po.approve'), t.id).toBe(false);
      // control settings and the quarantine override are for the administrator only
      for (const p of ['purchasing.settings.write', 'expense.settings.write', 'inventory.hold.override']) expect(t.permissions, t.id).not.toContain(p);
    }
    // the store clerk moves stock but cannot release quarantined material; QC releases it through the hold flow
    expect(tpl('warehouse')).not.toContain('inventory.hold.release');
  });

  it('keep company money away from the self-service template', () => {
    const staff = ROLE_TEMPLATES.find((t) => t.id === 'staff')!;
    for (const p of ['assets.finance.read', 'expense.claim.approve', 'expense.claim.pay', 'hr.employee.read', 'helpdesk.ticket.read', 'projects.timesheet.approve']) {
      expect(staff.permissions).not.toContain(p);
    }
  });
});
