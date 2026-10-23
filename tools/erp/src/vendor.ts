import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

/**
 * The vendor lock: a fingerprint of every file GO Along shipped to a customer (`pnpm erp pack` writes it).
 *
 * The product promise is "a correct base that your AI extends". The lock is what makes that checkable:
 *   - `pnpm erp doctor` says whether the base is still exactly what GO Along tested, and lists what the customer added
 *   - `pnpm erp verify` (part of `pnpm check`) warns — or with `--strict` fails — when vendor files were edited
 *   - `pnpm erp upgrade <release>` replaces untouched vendor files wholesale and never touches customer files
 *
 * Customer-owned paths are never fingerprinted: every module's `ext/` folder, modules the customer created
 * (`services/<id>` not in the lock), deployment config and files that tools regenerate (registries, package.json, lockfile).
 */
export const VENDOR_LOCK = '.erp/vendor-lock.json';

export interface VendorLock {
  customer: string;
  /** module ids GO Along shipped (the customer's own modules are everything else under services/) */
  modules: string[];
  versions: Record<string, string>;
  packedAt: string;
  /** relative path (forward slashes) → sha256 */
  files: Record<string, string>;
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.next-showcase', '.expo', '.turbo', 'dist', 'coverage', '.erp']);

/** Files the customer owns or tools rewrite; never part of the vendor fingerprint. */
export function isCustomerPath(rel: string, vendorModules?: string[]): boolean {
  const p = rel.split(sep).join('/');
  if (/^services\/[^/]+\/ext(\/|$)/.test(p)) return true;
  const mod = p.match(/^services\/([^/]+)\//)?.[1];
  if (mod && vendorModules && !vendorModules.includes(mod)) return true;
  if (/^(deploy|keys)\//.test(p)) return true;
  if (['README.md', 'CUSTOM.md', 'INSTALLED_MODULES.json', 'package.json', 'pnpm-lock.yaml'].includes(p)) return true;
  if (/^apps\/[^/]+\/(package\.json|src\/modules\.generated\.ts|src\/modules\.json)$/.test(p)) return true;
  if (/(^|\/)\.env(\..*)?$/.test(p) || /\.tsbuildinfo$/.test(p) || /(^|\/)\.DS_Store$/.test(p)) return true;
  return false;
}

function walk(root: string, dir = root): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return SKIP_DIRS.has(f) ? [] : walk(root, p);
    return [relative(root, p).split(sep).join('/')];
  });
}

export const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Fingerprint of the vendor files currently in `root`. */
export function vendorFiles(root: string, vendorModules: string[]): Record<string, string> {
  return Object.fromEntries(walk(root).filter((p) => !isCustomerPath(p, vendorModules)).sort().map((p) => [p, sha256(join(root, p))]));
}

export function writeVendorLock(root: string, meta: Omit<VendorLock, 'files'>): VendorLock {
  const lock: VendorLock = { ...meta, files: vendorFiles(root, meta.modules) };
  mkdirSync(join(root, '.erp'), { recursive: true });
  writeFileSync(join(root, VENDOR_LOCK), JSON.stringify(lock, null, 2) + '\n');
  return lock;
}

export function readVendorLock(root: string): VendorLock | null {
  const p = join(root, VENDOR_LOCK);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as VendorLock) : null;
}

export interface Drift {
  /** vendor files whose content changed */
  modified: string[];
  /** vendor files that were deleted */
  missing: string[];
  /** new files inside vendor areas (should have gone into ext/ or a new module) */
  added: string[];
}

export function vendorDrift(root: string, lock: VendorLock): Drift {
  const now = vendorFiles(root, lock.modules);
  return {
    modified: Object.keys(lock.files).filter((p) => p in now && now[p] !== lock.files[p]),
    missing: Object.keys(lock.files).filter((p) => !(p in now)),
    added: Object.keys(now).filter((p) => !(p in lock.files)),
  };
}

export interface Customization {
  /** modules with an ext/ folder → what it contains */
  extensions: { module: string; parts: string[]; description?: string }[];
  /** services/<id> created by the customer */
  ownModules: string[];
}

export function customizations(root: string, lock: VendorLock | null): Customization {
  const dir = join(root, 'services');
  const ids = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, 'module.json'))).sort() : [];
  const extensions = ids.filter((id) => existsSync(join(dir, id, 'ext'))).map((id) => {
    const ext = join(dir, id, 'ext');
    const parts = [
      existsSync(join(ext, 'ext.json')) && 'ext.json',
      existsSync(join(ext, 'index.ts')) && 'routes/handlers/guards (index.ts)',
      existsSync(join(ext, 'migrations')) && `${readdirSync(join(ext, 'migrations')).filter((f) => f.endsWith('.sql')).length} migration(s)`,
      existsSync(join(ext, 'ui.ts')) && 'screens (ui.ts)',
      existsSync(join(ext, 'test')) && `${walk(join(ext, 'test')).filter((f) => f.endsWith('.test.ts')).length} test file(s)`,
    ].filter(Boolean) as string[];
    let description: string | undefined;
    try { description = JSON.parse(readFileSync(join(ext, 'ext.json'), 'utf8')).description; } catch { /* no ext.json */ }
    return { module: id, parts, description };
  });
  return { extensions, ownModules: lock ? ids.filter((id) => !lock.modules.includes(id)) : [] };
}

/** `pnpm erp doctor`: is the GO Along base intact, and what did this installation add on top? */
export function doctor(root: string): { ok: boolean; text: string } {
  const lock = readVendorLock(root);
  const lines: string[] = [];
  let ok = true;
  if (!lock) {
    lines.push('No .erp/vendor-lock.json — this is not a packed installation (GO Along source repo), so there is no vendor base to compare.');
  } else {
    const d = vendorDrift(root, lock);
    const total = d.modified.length + d.missing.length + d.added.length;
    lines.push(`Installation: ${lock.customer} · packed ${lock.packedAt.slice(0, 10)} · modules ${lock.modules.join(', ')}`);
    if (!total) lines.push(`✔ Vendor base intact: all ${Object.keys(lock.files).length} GO Along files are exactly as shipped.`);
    else {
      ok = false;
      lines.push(`✘ Vendor base changed in ${total} file(s). These changes are overwritten or block \`pnpm erp upgrade\`, and are outside GO Along support.`);
      lines.push('  Move them into services/<module>/ext/ (routes, guards, handlers, migrations, ui.ts) or a new module — see docs/extending-with-ai.md.');
      for (const [k, label] of [['modified', 'edited'], ['missing', 'deleted'], ['added', 'added in a vendor folder']] as const) for (const p of d[k]) lines.push(`  ${label.padEnd(26)} ${p}`);
    }
  }
  const c = customizations(root, lock);
  if (c.extensions.length || c.ownModules.length) {
    lines.push('', 'Customer additions (kept by every upgrade):');
    for (const e of c.extensions) lines.push(`  services/${e.module}/ext — ${e.parts.join(', ') || 'empty'}${e.description ? ` — ${e.description}` : ''}`);
    for (const m of c.ownModules) lines.push(`  services/${m} — customer module`);
  } else lines.push('', 'No customer extensions yet.');
  return { ok, text: lines.join('\n') };
}

export interface UpgradePlan {
  from: string;
  to: string;
  /** vendor files replaced or added (untouched locally) */
  update: string[];
  /** vendor files the release removed (untouched locally) */
  remove: string[];
  /** files the customer edited that the release also changed: local kept, release copy put in .erp/upgrade/<path> */
  conflicts: string[];
  /** files the customer edited that the release did not change: kept as they are */
  keptLocal: string[];
  /** modules in the release that this installation does not have yet (their files are part of `update`) */
  newModules: string[];
}

/**
 * Plan (and with `apply`, perform) an upgrade from the vendor base in `root` to a newer pack of the same installation
 * (`pnpm erp pack … --out <release>` by GO Along). Customer paths are never read for the plan and never written.
 */
export function upgrade(root: string, releaseDir: string, opts: { apply?: boolean } = {}): UpgradePlan {
  const oldLock = readVendorLock(root);
  const relLock = readVendorLock(releaseDir);
  if (!oldLock) throw new Error(`${root}: no ${VENDOR_LOCK} — only packed installations can be upgraded this way`);
  if (!relLock) throw new Error(`${releaseDir}: no ${VENDOR_LOCK} — give the folder of a newer \`pnpm erp pack\``);
  const hashOf = (p: string) => (existsSync(join(root, p)) ? sha256(join(root, p)) : null);
  const plan: UpgradePlan = {
    from: oldLock.packedAt, to: relLock.packedAt, update: [], remove: [], conflicts: [], keptLocal: [],
    newModules: relLock.modules.filter((m) => !oldLock.modules.includes(m)),
  };
  for (const p of new Set([...Object.keys(oldLock.files), ...Object.keys(relLock.files)])) {
    const was = oldLock.files[p];
    const next = relLock.files[p];
    const local = hashOf(p);
    const untouched = was !== undefined ? local === was : local === null || local === next;
    if (next === undefined) {
      // removed by the release
      if (local === null) continue;
      if (untouched) plan.remove.push(p);
      else plan.conflicts.push(p);
    } else if (untouched) {
      if (local !== next) plan.update.push(p);
    } else if (was === next) {
      plan.keptLocal.push(p);
    } else {
      plan.conflicts.push(p);
    }
  }
  for (const k of ['update', 'remove', 'conflicts', 'keptLocal'] as const) plan[k].sort();
  if (!opts.apply) return plan;

  const copy = (from: string, to: string) => { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); };
  for (const p of plan.update) copy(join(releaseDir, p), join(root, p));
  for (const p of plan.remove) rmSync(join(root, p));
  rmSync(join(root, '.erp', 'upgrade'), { recursive: true, force: true });
  for (const p of plan.conflicts) if (existsSync(join(releaseDir, p))) copy(join(releaseDir, p), join(root, '.erp', 'upgrade', p));
  // root package.json: the release's, keeping the customer's own modules as workspace dev-dependencies
  const mine = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const theirs = JSON.parse(readFileSync(join(releaseDir, 'package.json'), 'utf8'));
  for (const [dep, v] of Object.entries<string>(mine.devDependencies ?? {})) {
    const id = dep.match(/^@erp\/svc-(.+)$/)?.[1];
    if (id && !relLock.modules.includes(id) && existsSync(join(root, 'services', id))) (theirs.devDependencies ??= {})[dep] = v;
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify(theirs, null, 2) + '\n');
  // the new reference is the release; files still in conflict will show up in `doctor` until they are resolved
  copy(join(releaseDir, VENDOR_LOCK), join(root, VENDOR_LOCK));
  const installed = join(releaseDir, 'INSTALLED_MODULES.json');
  if (existsSync(installed)) copy(installed, join(root, 'INSTALLED_MODULES.json'));
  return plan;
}

export function formatUpgradePlan(plan: UpgradePlan, applied: boolean): string {
  const l = [`Upgrade ${plan.from.slice(0, 10)} → ${plan.to.slice(0, 10)}${applied ? '' : ' (dry run — add --apply to perform it)'}`,
    `  vendor files updated: ${plan.update.length} · removed: ${plan.remove.length} · new modules: ${plan.newModules.join(', ') || 'none'}`,
    `  customer extensions (services/*/ext, own modules): untouched`];
  if (plan.keptLocal.length) l.push(`  edited vendor files the release did not change (kept): ${plan.keptLocal.length}`, ...plan.keptLocal.map((p) => `    ${p}`));
  if (plan.conflicts.length) {
    l.push(`  ✘ ${plan.conflicts.length} vendor file(s) edited here AND changed by the release — local version kept,`,
      `    release version ${applied ? 'written to' : 'will be written to'} .erp/upgrade/<path>. Merge them (ask your AI: /upgrade), or better, move the edit into ext/:`,
      ...plan.conflicts.map((p) => `    ${p}`));
  }
  if (applied) l.push('', 'Next: pnpm install && pnpm erp ui-sync && pnpm check');
  return l.join('\n');
}
