import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalog, loadManifests } from './catalog.ts';

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
export function verify(root: string): { errors: string[]; warnings: string[] } {
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
    for (const t of m.subscribes) if (!publishers.has(t)) warnings.push(`${m.id}: subscribes to ${t} but no installed module publishes it (fine if that module is not purchased)`);

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

    // every table must be tenant-isolated
    for (const file of walk(join(dir, 'migrations')).filter((f) => f.endsWith('.sql'))) {
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

  if (existsSync(join(root, 'catalog', 'catalog.json'))) {
    const cat = loadCatalog(root);
    for (const m of manifests.filter((x) => x.tier === 'feature')) if (!cat.modules[m.id]) errors.push(`${m.id}: no price in catalog/catalog.json`);
    for (const b of cat.bundles) for (const id of b.modules) if (!ids.has(id)) warnings.push(`bundle ${b.id}: module ${id} not in this repo`);
  }
  return { errors, warnings };
}
