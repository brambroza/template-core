import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadManifests, REPO_ROOT, resolveSelection } from '../src/catalog.ts';
import { pack } from '../src/pack.ts';
import { syncUi, uiOutOfSync } from '../src/ui-sync.ts';
import { doctor, readVendorLock, upgrade, VENDOR_LOCK, vendorDrift, writeVendorLock } from '../src/vendor.ts';
import { verify } from '../src/verify.ts';

/**
 * The product lifecycle: GO Along packs a correct base → the customer's AI extends it in ext/ → doctor proves the base is intact
 * → GO Along ships a release → `upgrade` replaces vendor files and keeps every customer change.
 */
const manifests = loadManifests();
const tmp = mkdtempSync(join(tmpdir(), 'erp-vendor-'));
const site = join(tmp, 'acme');
const selection = resolveSelection(['purchasing', 'sales'], manifests);
const EXAMPLE = join(REPO_ROOT, 'docs', 'examples', 'purchasing-budget', 'ext');

beforeAll(() => { pack(REPO_ROOT, selection, manifests, site, { customer: 'ACME' }); });
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('pack for one installation', () => {
  it('fingerprints exactly the vendor files it shipped', () => {
    const lock = readVendorLock(site)!;
    expect(lock.customer).toBe('ACME');
    expect(lock.modules).toEqual([...selection].sort());
    expect(lock.files['packages/kernel/src/service.ts']).toMatch(/^[0-9a-f]{64}$/);
    expect(lock.files['services/purchasing/src/service.ts']).toBeDefined();
    // customer-owned / regenerated files are not part of the base
    for (const p of ['README.md', 'CUSTOM.md', 'package.json', 'INSTALLED_MODULES.json', 'apps/web/src/modules.generated.ts']) expect(lock.files[p]).toBeUndefined();
    expect(Object.keys(lock.files).some((p) => p.startsWith('deploy/'))).toBe(false);
    expect(doctor(site).ok).toBe(true);
  });

  it('writes a CLAUDE.md for this installation only and keeps GO Along-internal documents out', () => {
    const md = readFileSync(join(site, 'CLAUDE.md'), 'utf8');
    expect(md).toContain('Modules in THIS installation: `identity`, `master-data` (core) · `purchasing`, `sales` (features)');
    expect(md).not.toMatch(/erp:(internal|modules)/);
    expect(md).not.toContain('catalog/catalog.json');
    expect(md).not.toContain('uat:pack');
    expect(md).toContain('Where a change goes');
    expect(existsSync(join(site, 'CUSTOM.md'))).toBe(true);
    for (const internal of ['docs/roadmap', 'docs/uat', 'docs/ux', 'docs/selling-and-licensing.md', 'docs/license-keys.md']) expect(existsSync(join(site, internal))).toBe(false);
    for (const shipped of ['docs/extending-with-ai.md', 'docs/security', 'docs/examples/purchasing-budget/ext/index.ts', '.claude/commands/extend.md']) expect(existsSync(join(site, shipped))).toBe(true);
  });
});

describe('customer extends with AI', () => {
  it('ext/ code is the customer’s: the base stays intact and verify passes', () => {
    cpSync(EXAMPLE, join(site, 'services', 'purchasing', 'ext'), { recursive: true });
    expect(uiOutOfSync(site, selection)).toEqual(['apps/web', 'apps/mobile']);
    syncUi(site, selection);
    const registry = readFileSync(join(site, 'apps', 'web', 'src', 'modules.generated.ts'), 'utf8');
    expect(registry).toContain("import purchasingUiExt from '@erp/svc-purchasing/ext/ui';");
    expect(registry).toContain('extendUi(purchasingUi, purchasingUiExt)');
    const r = verify(site);
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => w.includes('vendor base') || w.includes('ext '))).toEqual([]);
    const d = doctor(site);
    expect(d.ok).toBe(true);
    expect(d.text).toContain('Vendor base intact');
    expect(d.text).toContain('services/purchasing/ext — ext.json, routes/handlers/guards (index.ts), 1 migration(s), screens (ui.ts), 1 test file(s)');
  });

  it('flags ext names that could clash with a future update, and bad ext.json', () => {
    const ext = join(site, 'services', 'sales', 'ext');
    cpSync(EXAMPLE, ext, { recursive: true });
    appendFileSync(join(ext, 'migrations', '001_x_budgets.sql'), '\ncreate table promos (id uuid primary key, tenant_id uuid not null);\n-- @tenant promos\nalter table purchase_orders add column budget text;\n');
    appendFileSync(join(ext, 'index.ts'), "\nexport const extra = (app: any) => app.get('/promos', async () => []);\n");
    const w = verify(site).warnings.join('\n');
    expect(w).toContain('ext table promos should be named x_');
    expect(w).toContain('ext column budget should be named x_');
    expect(w).toContain('ext route GET /promos should start with /x/');
    // the example's permission is purchasing.*, which is not a sales permission
    expect(verify(site).errors.join('\n')).toContain('must be prefixed with "sales."');
    rmSync(ext, { recursive: true });
  });

  it('editing vendor code is visible: doctor fails, verify warns (and fails with --strict)', () => {
    appendFileSync(join(site, 'services', 'purchasing', 'src', 'service.ts'), '\n// quick fix by the customer\n');
    appendFileSync(join(site, 'packages', 'thai', 'src', 'index.ts'), '\n// local tweak\n');
    const drift = vendorDrift(site, readVendorLock(site)!);
    expect(drift.modified.sort()).toEqual(['packages/thai/src/index.ts', 'services/purchasing/src/service.ts']);
    const d = doctor(site);
    expect(d.ok).toBe(false);
    expect(d.text).toContain('edited                     services/purchasing/src/service.ts');
    expect(verify(site).errors).toEqual([]);
    expect(verify(site).warnings.some((x) => x.includes('vendor base: edited services/purchasing/src/service.ts'))).toBe(true);
    expect(verify(site, { strict: true }).errors.some((x) => x.includes('vendor base: edited packages/thai/src/index.ts'))).toBe(true);
  });
});

describe('upgrade to a GO Along release', () => {
  const release = join(tmp, 'release');
  beforeAll(() => {
    pack(REPO_ROOT, selection, manifests, release, { customer: 'ACME' });
    // what GO Along changed in this release
    appendFileSync(join(release, 'services', 'sales', 'CLAUDE.md'), '\nRelease note: new sales feature.\n');
    appendFileSync(join(release, 'packages', 'thai', 'src', 'index.ts'), '\n// vendor fix in the release\n');
    appendFileSync(join(release, 'services', 'sales', 'migrations', '099_release.sql'), 'select 1;\n');
    rmSync(join(release, 'services', 'sales', 'test', 'notes.test.ts'));
    const lock = readVendorLock(release)!;
    writeVendorLock(release, { customer: lock.customer, modules: lock.modules, versions: lock.versions, packedAt: '2027-01-15T00:00:00.000Z' });
  });

  it('plans: updates untouched files, keeps local edits, reports real conflicts', () => {
    const plan = upgrade(site, release);
    expect(plan.update).toEqual(['services/sales/CLAUDE.md', 'services/sales/migrations/099_release.sql']);
    expect(plan.remove).toEqual(['services/sales/test/notes.test.ts']);
    expect(plan.keptLocal).toEqual(['services/purchasing/src/service.ts']);
    expect(plan.conflicts).toEqual(['packages/thai/src/index.ts']);
    // dry run changed nothing
    expect(readFileSync(join(site, 'services', 'sales', 'CLAUDE.md'), 'utf8')).not.toContain('Release note');
  });

  it('applies: vendor files replaced, ext/ untouched, conflict copy for the AI to merge, new reference lock', () => {
    const extBefore = readFileSync(join(site, 'services', 'purchasing', 'ext', 'index.ts'), 'utf8');
    upgrade(site, release, { apply: true });
    expect(readFileSync(join(site, 'services', 'sales', 'CLAUDE.md'), 'utf8')).toContain('Release note');
    expect(existsSync(join(site, 'services', 'sales', 'migrations', '099_release.sql'))).toBe(true);
    expect(existsSync(join(site, 'services', 'sales', 'test', 'notes.test.ts'))).toBe(false);
    expect(readFileSync(join(site, 'services', 'purchasing', 'ext', 'index.ts'), 'utf8')).toBe(extBefore);
    expect(readFileSync(join(site, 'packages', 'thai', 'src', 'index.ts'), 'utf8')).toContain('// local tweak');
    expect(readFileSync(join(site, '.erp', 'upgrade', 'packages', 'thai', 'src', 'index.ts'), 'utf8')).toContain('// vendor fix in the release');
    expect(readVendorLock(site)!.packedAt).toBe('2027-01-15T00:00:00.000Z');
    expect(readFileSync(join(site, VENDOR_LOCK), 'utf8')).toBe(readFileSync(join(release, VENDOR_LOCK), 'utf8'));
    // still-edited vendor files keep showing until they are resolved
    expect(vendorDrift(site, readVendorLock(site)!).modified.sort()).toEqual(['packages/thai/src/index.ts', 'services/purchasing/src/service.ts']);
  });
});
