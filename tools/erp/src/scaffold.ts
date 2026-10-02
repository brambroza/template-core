import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Create a new, working, independently sellable module from the house pattern. */
export function scaffoldModule(root: string, id: string, name: string, nameTh: string): string[] {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('module id must be lowercase letters, digits and dashes');
  const dir = join(root, 'services', id);
  if (existsSync(dir)) throw new Error(`services/${id} already exists`);
  for (const d of ['src', 'migrations', 'test']) mkdirSync(join(dir, d), { recursive: true });
  const files: Record<string, string> = {
    'module.json': JSON.stringify({
      id, name, nameTh, version: '0.1.0', tier: 'feature', description: `${name} module`,
      requires: ['identity', 'master-data'], enhancedBy: [], publishes: [], subscribes: [],
      permissions: [{ key: `${id}.record.read`, label: `ดู${nameTh}` }, { key: `${id}.record.write`, label: `จัดการ${nameTh}` }],
    }, null, 2) + '\n',
    'package.json': JSON.stringify({
      name: `@erp/svc-${id}`, version: '0.1.0', private: true, type: 'module', exports: { '.': './src/service.ts', './ui': './src/ui.ts' },
      scripts: { start: 'node --import tsx src/main.ts', dev: 'node --watch --import tsx src/main.ts', test: `vitest run --root ../.. services/${id}` },
      dependencies: { '@erp/contracts': 'workspace:*', '@erp/kernel': 'workspace:*', '@erp/thai': 'workspace:*', '@erp/ui-schema': 'workspace:*', tsx: '^4.19.2' },
    }, null, 2) + '\n',
    'migrations/001_init.sql': `create table records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant records
`,
    'src/ui.ts': `import { defineUi } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */
export default defineUi({
  module: '${id}',
  label: '${nameTh}',
  glyph: '${[...nameTh][0] ?? id[0]}',
  menu: [{ label: '${nameTh}', screen: 'records' }],
  screens: {
    records: {
      kind: 'list', title: '${nameTh}', endpoint: '/records', perm: '${id}.record.read', mobile: true,
      columns: [{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }, { key: 'created_at', label: 'สร้างเมื่อ', format: 'datetime' }],
      create: 'recordNew', createLabel: 'เพิ่ม', rowLink: { screen: 'record' }, empty: 'ยังไม่มีรายการ',
    },
    recordNew: {
      kind: 'form', title: 'เพิ่ม${nameTh}', method: 'POST', endpoint: '/records', perm: '${id}.record.write', mobile: true,
      fields: [{ name: 'code', label: 'รหัส', type: 'text', required: true }, { name: 'name', label: 'ชื่อ', type: 'text', required: true }],
      submitLabel: 'บันทึก', after: { screen: 'record', idFrom: 'id' },
    },
    record: {
      kind: 'detail', title: '${nameTh}', endpoint: '/records/:id', perm: '${id}.record.read', heading: 'code', mobile: true,
      fields: [{ key: 'name', label: 'ชื่อ' }, { key: 'created_at', label: 'สร้างเมื่อ', format: 'datetime' }],
    },
  },
});
`,
    'src/main.ts': `import { runService } from '@erp/kernel';\nimport { definition } from './service.ts';\n\nawait runService(definition);\n`,
    'src/service.ts': `import { auth, loadManifest, one, parse, requirePerm, s, z, type ServiceDefinition } from '@erp/kernel';
import { fileURLToPath } from 'node:url';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const RecordInput = z.object({ code: s.code, name: s.name });

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    app.get('/records', async (req) => {
      const a = auth(req);
      requirePerm(a, '${id}.record.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from records order by code')).rows);
    });

    app.get('/records/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, '${id}.record.read');
      const { id } = parse(z.object({ id: s.uuid }), req.params);
      return k.db.tx(a.tenantId, (c) => one(c, 'select * from records where id = $1', [id], 'Record'));
    });

    app.post('/records', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, '${id}.record.write');
      const b = parse(RecordInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query('insert into records (code, name, created_by) values ($1, $2, $3) returning *', [b.code, b.name, a.userId])).rows[0]);
    });
  },
};
`,
    'test/service.test.ts': `import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

describe('${id}', () => {
  it('creates and lists records per tenant', async () => {
    expect((await t.api('POST', '/records', { code: 'R-1', name: 'First' })).status).toBe(201);
    expect((await t.api('GET', '/records')).body).toHaveLength(1);
    expect((await t.api('GET', '/records', undefined, { token: t.token(['*'], t.otherTenantId) })).body).toHaveLength(0);
  });

  it('requires permissions', async () => {
    const reader = t.token(['${id}.record.read']);
    expect((await t.api('POST', '/records', { code: 'R-2', name: 'x' }, { token: reader })).status).toBe(403);
  });
});
`,
    'CLAUDE.md': `# ${id} — ${name} (${nameTh})

Read the root CLAUDE.md first. This file is the module-level brief.

## What this module does
TODO: describe the business process in 3–5 lines (who uses it, which documents, which statuses).

## Data
- \`records\` — placeholder table from the scaffold. Rename/replace it in a NEW migration file.

## API
- GET /records, GET /records/:id, POST /records

## Screens (src/ui.ts)
- records (list) → recordNew (form) → record (detail); all marked mobile

## Events
- publishes: (none yet) — add to module.json + @erp/contracts first
- subscribes: (none yet)
`,
  };
  for (const [f, content] of Object.entries(files)) writeFileSync(join(dir, f), content);
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.devDependencies = Object.fromEntries(Object.entries({ ...pkg.devDependencies, [`@erp/svc-${id}`]: 'workspace:*' }).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }
  return Object.keys(files).map((f) => join(dir, f));
}
