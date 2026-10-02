import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadCatalog, loadManifests, quote, REPO_ROOT, resolveSelection } from '../src/catalog.ts';
import { compose } from '../src/compose.ts';
import { pack } from '../src/pack.ts';
import { scaffoldModule } from '../src/scaffold.ts';
import { verify } from '../src/verify.ts';
import { syncUi } from '../src/ui-sync.ts';

const manifests = loadManifests();
const catalog = loadCatalog();
const tmp = mkdtempSync(join(tmpdir(), 'erp-tools-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('selection & pricing', () => {
  it('always adds core modules and requirements', () => {
    expect(resolveSelection(['costing'], manifests)).toEqual(['identity', 'master-data', 'costing']);
    expect(() => resolveSelection(['nope'], manifests)).toThrow(/Unknown module/);
  });

  it('every feature module requires only core modules (so each can be sold alone)', () => {
    const core = manifests.filter((m) => m.tier === 'core').map((m) => m.id);
    for (const m of manifests.filter((x) => x.tier === 'feature')) expect(m.requires.every((r) => core.includes(r))).toBe(true);
  });

  it('quotes the cheapest bundle combination', () => {
    const single = quote(['sales'], manifests, catalog);
    expect(single.total).toBe(catalog.platform.price + catalog.modules.sales.price);
    const trading = quote(['sales', 'purchasing', 'inventory'], manifests, catalog);
    expect(trading.total).toBe(catalog.platform.price + 49000);
    const mixed = quote(['sales', 'purchasing', 'inventory', 'costing'], manifests, catalog);
    expect(mixed.total).toBe(catalog.platform.price + 49000 + catalog.modules.costing.price);
    expect(mixed.yearlyUpdates).toBe(Math.round((mixed.total * catalog.updatePlanPct) / 100));
  });
});

describe('compose', () => {
  it('writes a compose file with one database and container per module, plus the gateway', () => {
    const out = join(tmp, 'compose');
    compose(resolveSelection(['maintenance'], manifests), manifests, out, REPO_ROOT);
    const yml = readFileSync(join(out, 'docker-compose.yml'), 'utf8');
    expect(yml).toContain('MODULES: identity=http://identity:3000,master-data=http://master-data:3000,maintenance=http://maintenance:3000');
    expect(yml).not.toContain('inventory');
    expect(yml).toContain('APP_DIR: apps/web');
    expect(yml).toContain('GATEWAY_URL: http://gateway:8080');
    expect(readFileSync(join(out, 'init-db.sh'), 'utf8')).toContain('create database erp_master_data owner erp_app;');
  });
});

describe('pack', () => {
  it('ships only purchased modules and no pricing data', () => {
    const out = join(tmp, 'pack');
    pack(REPO_ROOT, resolveSelection(['sales', 'inventory'], manifests), manifests, out, { customer: 'ACME', license: 'tok' });
    expect(readdirSync(join(out, 'services')).sort()).toEqual(['identity', 'inventory', 'master-data', 'sales']);
    expect(existsSync(join(out, 'catalog'))).toBe(false);
    expect(existsSync(join(out, 'packages', 'kernel', 'src', 'service.ts'))).toBe(true);
    const pkg = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.devDependencies).filter((d) => d.startsWith('@erp/svc-')).sort()).toEqual(['@erp/svc-identity', '@erp/svc-inventory', '@erp/svc-master-data', '@erp/svc-sales']);
    expect(readFileSync(join(out, 'tests', 'e2e', 'installation.test.ts'), 'utf8')).toContain("from '@erp/svc-inventory'");
    expect(readFileSync(join(out, 'deploy', 'erp-license.txt'), 'utf8').trim()).toBe('tok');
    expect(JSON.parse(readFileSync(join(out, 'INSTALLED_MODULES.json'), 'utf8')).customer).toBe('ACME');
    // web + mobile include only the purchased modules' screens
    for (const app of ['apps/web', 'apps/mobile']) {
      const registry = readFileSync(join(out, app, 'src', 'modules.generated.ts'), 'utf8');
      expect(registry).toContain("from '@erp/svc-inventory/ui'");
      expect(registry).not.toContain('svc-production');
      const appPkg = JSON.parse(readFileSync(join(out, app, 'package.json'), 'utf8'));
      expect(Object.keys(appPkg.dependencies).filter((d) => d.startsWith('@erp/svc-')).sort()).toEqual(['@erp/svc-identity', '@erp/svc-inventory', '@erp/svc-master-data', '@erp/svc-sales']);
    }
    expect(existsSync(join(out, 'tests', 'ui', 'descriptors.test.ts'))).toBe(true);
    const toolsPkg = JSON.parse(readFileSync(join(out, 'tools', 'erp', 'package.json'), 'utf8'));
    expect(Object.keys(toolsPkg.dependencies).filter((d) => d.startsWith('@erp/svc-')).sort()).toEqual(['@erp/svc-identity', '@erp/svc-inventory', '@erp/svc-master-data', '@erp/svc-sales']);
    // the packed repo passes the same architecture rules on its own
    expect(verify(out).errors).toEqual([]);
  });
});

describe('scaffold + verify', () => {
  it('creates a new module that follows the rules', () => {
    const root = join(tmp, 'scaffold');
    cpSync(REPO_ROOT, root, { recursive: true, filter: (s) => !/node_modules|\.git$|\.next|[\\/]dist[\\/]/.test(s) });
    scaffoldModule(root, 'quality', 'Quality Control', 'ควบคุมคุณภาพ');
    expect(existsSync(join(root, 'services', 'quality', 'src', 'ui.ts'))).toBe(true);
    expect(verify(root).errors).toContain('apps/web: module registry is out of date — run `pnpm erp ui-sync`');
    syncUi(root, loadManifests(root).map((m) => m.id));
    const r = verify(root);
    expect(r.errors).toEqual(['quality: no price in catalog/catalog.json']);
    expect(() => scaffoldModule(root, 'quality', 'x', 'x')).toThrow(/already exists/);
  });

  it('flags modules that import each other', () => {
    expect(verify(REPO_ROOT).errors.filter((e) => e.includes('imports module'))).toEqual([]);
  });
});
