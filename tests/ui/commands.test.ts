import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { matchCommand, type CommandSpec, type ModuleUi } from '@erp/ui-schema';

/**
 * ⌘K commands of every module share one palette. `matchCommand` picks the LONGEST keyword that
 * prefixes the typed text, so two commands with the same keyword (case-insensitive) are ambiguous:
 * whichever module loads first wins ("ลงเวลา" used to open the project timesheet instead of HR check-in).
 */
const SERVICES = fileURLToPath(new URL('../../services', import.meta.url));
const ids = readdirSync(SERVICES).filter((d) => existsSync(`${SERVICES}/${d}/src/ui.ts`)).sort();
const uis: ModuleUi[] = [];

beforeAll(async () => {
  for (const id of ids) uis.push((await import(`${SERVICES}/${id}/src/ui.ts`)).default as ModuleUi);
});

type Owned = CommandSpec & { owner: string };
const all = (): Owned[] => uis.flatMap((u) => (u.commands ?? []).map((c) => ({ ...c, owner: `${u.module}.${c.id}` })));

describe('⌘K command keywords', () => {
  it('no two commands (in any modules) declare the same keyword', () => {
    const seen = new Map<string, string[]>();
    for (const c of all()) for (const kw of new Set(c.keywords.map((k) => k.trim().toLowerCase()))) {
      seen.set(kw, [...(seen.get(kw) ?? []), c.owner]);
    }
    const clashes = [...seen].filter(([, owners]) => owners.length > 1).map(([kw, owners]) => `"${kw}": ${owners.join(', ')}`);
    expect(clashes).toEqual([]);
  });

  it('every example opens its own command when all modules are installed', () => {
    const cmds = all();
    const wrong = cmds
      .map((c) => ({ c, got: matchCommand(cmds, c.example)?.command as Owned | undefined }))
      .filter(({ c, got }) => got?.owner !== c.owner)
      .map(({ c, got }) => `${c.owner} "${c.example}" -> ${got?.owner ?? 'nothing'}`);
    expect(wrong).toEqual([]);
  });

  it.each([
    ['ลงเวลา', 'hr.checkin'],
    ['เข้างาน', 'hr.checkin'],
    ['ออกงาน', 'hr.checkout'],
    ['ลงชั่วโมง PJ-2569-0001 ประชุม', 'projects.log'],
    ['timesheet', 'projects.log'],
    ['เบิก ค่าน้ำมัน', 'expense.claim'],
    ['เบิกของ', 'inventory.issue'],
    ['รออนุมัติ', 'approvals.inbox'],
  ])('"%s" opens %s', (text, owner) => {
    expect((matchCommand(all(), text)?.command as Owned | undefined)?.owner).toBe(owner);
  });
});
