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

  it('keep company money away from the self-service template', () => {
    const staff = ROLE_TEMPLATES.find((t) => t.id === 'staff')!;
    for (const p of ['assets.finance.read', 'expense.claim.approve', 'expense.claim.pay', 'hr.employee.read', 'helpdesk.ticket.read', 'projects.timesheet.approve']) {
      expect(staff.permissions).not.toContain(p);
    }
  });
});
