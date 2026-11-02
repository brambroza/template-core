import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isKernelSubscription, loadExtensionManifest } from '@erp/kernel';
import { join } from 'node:path';
import { loadCatalog, loadManifests } from './catalog.ts';
import { uiOutOfSync } from './ui-sync.ts';
import { readVendorLock, vendorDrift } from './vendor.ts';

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === 'node_modules' ? [] : walk(p)) : [p];
  });
}

/**
 * Architecture rules that keep every module independently sellable. Run by `pnpm check` and CI.
 */
export function verify(root: string, opts: { strict?: boolean } = {}): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  let manifests;
  try {
    manifests = loadManifests(root);
  } catch (e) {
    return { errors: [(e as Error).message], warnings };
  }
  const ids = new Set(manifests.map((m) => m.id));
  const publishers = new Set(manifests.flatMap((m) => m.publishes));

  for (const m of manifests) {
    const dir = join(root, 'services', m.id);
    for (const r of m.requires) if (!ids.has(r)) errors.push(`${m.id}: requires unknown module "${r}"`);
    for (const r of m.requires) if (manifests.find((x) => x.id === r)?.tier !== 'core') errors.push(`${m.id}: may only *require* core modules ("${r}" is a feature). Use events + enhancedBy instead.`);
    for (const f of ['src/service.ts', 'src/main.ts', 'migrations', 'CLAUDE.md', 'package.json']) if (!existsSync(join(dir, f))) errors.push(`${m.id}: missing ${f}`);
    if (!walk(join(dir, 'test')).some((f) => f.endsWith('.test.ts'))) errors.push(`${m.id}: has no tests`);
    for (const t of m.subscribes) {
      // kernel subscriptions (identity.tokens_revoked, SEC-07) reach every module through the kernel + gateway; listing one is allowed but redundant
      if (isKernelSubscription(t)) warnings.push(`${m.id}: subscribes to ${t}, which every module's kernel already handles — remove it from module.json unless the module adds its own handler`);
      else if (!publishers.has(t)) warnings.push(`${m.id}: subscribes to ${t} but no installed module publishes it (fine if that module is not purchased)`);
    }

    // no module may import another module's code: integration happens through @erp/contracts events only
    for (const file of walk(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = match[1];
        const other = spec.match(/^@erp\/svc-(.+)$/)?.[1] ?? spec.match(/services\/([a-z0-9-]+)/)?.[1];
        if (other && other !== m.id) errors.push(`${file.replace(root, '')}: imports module "${other}" — modules must talk through events, not imports`);
      }
      if (/_outbox|_inbox/.test(src) && !file.includes('/test/')) warnings.push(`${file.replace(root, '')}: touches kernel tables directly`);
    }

    // customer extension (ext/): valid ext.json, upgrade-safe names (/x/ routes, x_ tables and columns)
    const ext = join(dir, 'ext');
    if (existsSync(ext)) {
      try { loadExtensionManifest(ext, m); } catch (e) { errors.push((e as Error).message); }
      for (const file of walk(ext).filter((f) => f.endsWith('.ts') && !f.includes('/test/'))) {
        for (const r of readFileSync(file, 'utf8').matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]*)/g)) {
          if (!r[2].startsWith('/x/')) warnings.push(`${file.replace(root, '')}: ext route ${r[1].toUpperCase()} ${r[2]} should start with /x/ so a GO Along update can never add the same path`);
        }
      }
      for (const file of walk(join(ext, 'migrations')).filter((f) => f.endsWith('.sql'))) {
        const sql = readFileSync(file, 'utf8');
        for (const t of sql.matchAll(/create table (?:if not exists )?(\w+)/gi)) if (!t[1].startsWith('x_')) warnings.push(`${file.replace(root, '')}: ext table ${t[1]} should be named x_… (no clash with future vendor tables)`);
        for (const c of sql.matchAll(/add column (?:if not exists )?(\w+)/gi)) if (!c[1].startsWith('x_')) warnings.push(`${file.replace(root, '')}: ext column ${c[1]} should be named x_… (no clash with future vendor columns)`);
      }
    }

    // every table must be tenant-isolated (vendor and extension migrations alike)
    for (const file of [...walk(join(dir, 'migrations')), ...walk(join(dir, 'ext', 'migrations'))].filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(file, 'utf8');
      const tenantTables = new Set([...sql.matchAll(/^--\s*@tenant\s+(\w+)/gim)].map((x) => x[1]));
      for (const t of sql.matchAll(/create table (?:if not exists )?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
        const [, table, body] = t;
        if (m.id === 'identity' && table === 'tenants') continue;
        if (!/\btenant_id\b/.test(body)) errors.push(`${m.id}: table ${table} has no tenant_id`);
        else if (!tenantTables.has(table)) errors.push(`${m.id}: table ${table} is missing "-- @tenant ${table}" (row-level security)`);
      }
    }
  }

  // a customer installation: GO Along's base must stay as shipped (customer code belongs in ext/ or own modules)
  const lock = readVendorLock(root);
  if (lock) {
    const d = vendorDrift(root, lock);
    const changed = [...d.modified.map((p) => `edited ${p}`), ...d.missing.map((p) => `deleted ${p}`), ...d.added.map((p) => `added ${p}`)];
    for (const c of changed) (opts.strict ? errors : warnings).push(`vendor base: ${c} — move the change into services/<module>/ext/ or a new module (pnpm erp doctor)`);
  }

  for (const app of uiOutOfSync(root, [...ids])) errors.push(`${app}: module registry is out of date — run \`pnpm erp ui-sync\``);

  if (existsSync(join(root, 'catalog', 'catalog.json'))) {
    const cat = loadCatalog(root);
    for (const m of manifests.filter((x) => x.tier === 'feature')) {
      if (!cat.modules[m.id]) errors.push(`${m.id}: no price in catalog/catalog.json`);
      else if ((cat as any).rental?.modules && !(cat as any).rental.modules[m.id]) errors.push(`${m.id}: no monthly rental price in catalog/catalog.json (rental.modules)`);
    }
    for (const b of cat.bundles) for (const id of b.modules) if (!ids.has(id)) warnings.push(`bundle ${b.id}: module ${id} not in this repo`);
  }
  return { errors, warnings };
}
