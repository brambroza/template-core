import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ModuleManifest } from '@erp/kernel';
import { compose } from './compose.ts';
import { syncUi } from './ui-sync.ts';
import { writeVendorLock } from './vendor.ts';

export interface PackOptions {
  customer: string;
  license?: string;
}

const ROOT_FILES = ['pnpm-workspace.yaml', 'tsconfig.json', 'vitest.config.ts', '.gitignore', '.dockerignore', 'Dockerfile', 'CLAUDE.md', 'AGENTS.md'];
const ROOT_DIRS = ['packages', 'apps', 'docs', '.claude', 'scripts', '.github', 'tools'];
const skipNodeModules = (src: string) => !src.split(/[\\/]/).some((p) => p === 'node_modules' || p === '.next' || p === '.expo');
/**
 * GO Along-internal material that never goes to a customer: pricing tests, and the planning / sales / review documents
 * under docs/ (roadmap with prices and dates, UAT evidence, UX reviews, licensing and showcase how-tos).
 */
export const INTERNAL_DOCS = ['docs/roadmap', 'docs/uat', 'docs/ux', 'docs/selling-and-licensing.md', 'docs/license-keys.md', 'docs/deploy-vercel.md'];
const norm = (p: string) => p.split(/[\\/]/).join('/');
const shipped = (root: string) => (src: string) => {
  if (!skipNodeModules(src) || /tools[\\/]erp[\\/]test/.test(src)) return false;
  const rel = norm(relative(root, src));
  return !INTERNAL_DOCS.some((d) => rel === d || rel.startsWith(`${d}/`));
};

/** CLAUDE.md for one installation: only its modules, no GO Along-internal tooling. */
export function installationClaudeMd(src: string, selection: string[], manifests: ModuleManifest[]): string {
  const mods = manifests.filter((m) => selection.includes(m.id));
  const list = (tier: string) => mods.filter((m) => m.tier === tier).map((m) => `\`${m.id}\``).join(', ');
  const modules = `Modules in THIS installation: ${list('core')} (core) · ${list('feature') || 'none'} (features). Other GO Along modules exist but are not installed here —\n`
    + 'never reference their code, tables or screens; integrate with them only through events in `packages/contracts`.';
  return src
    .replace(/<!-- erp:internal:start -->[\s\S]*?<!-- erp:internal:end -->\n?/g, '')
    .replace(/<!-- erp:modules:start -->[\s\S]*?<!-- erp:modules:end -->/, modules);
}

const CUSTOM_MD = (customer: string) => `# CUSTOM.md — ${customer}

This file belongs to ${customer}, not to GO Along: updates never overwrite it. AI coding tools read it after CLAUDE.md.
Write your company's own conventions here, for example:

- Document numbers, approval limits and who approves what
- Words your team uses (and the Thai labels screens should show)
- Which modules have extensions (\`services/<module>/ext/\`) and why
`;

/**
 * Build the deliverable for one customer: ONLY the modules they bought (+ core), the shared packages,
 * the gateway, the AI-ready docs, a deploy folder and a smoke test. Pricing data is never shipped.
 */
export function pack(root: string, selection: string[], manifests: ModuleManifest[], outDir: string, opts: PackOptions): string {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  for (const f of ROOT_FILES) if (existsSync(join(root, f))) cpSync(join(root, f), join(outDir, f));
  for (const d of ROOT_DIRS) if (existsSync(join(root, d))) cpSync(join(root, d), join(outDir, d), { recursive: true, filter: shipped(root) });
  // the vendor repo never has ext/ folders; if one exists (a GO Along test or demo), it is not part of the product
  const noExt = (src: string) => skipNodeModules(src) && !/[\\/]services[\\/][^\\/]+[\\/]ext([\\/]|$)/.test(src);
  for (const id of selection) cpSync(join(root, 'services', id), join(outDir, 'services', id), { recursive: true, filter: noExt });
  if (existsSync(join(root, 'CLAUDE.md'))) writeFileSync(join(outDir, 'CLAUDE.md'), installationClaudeMd(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), selection, manifests));
  writeFileSync(join(outDir, 'CUSTOM.md'), CUSTOM_MD(opts.customer));

  // root package.json: drop services the customer did not buy
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const dep of Object.keys(pkg.devDependencies)) {
    const m = dep.match(/^@erp\/svc-(.+)$/);
    if (m && !selection.includes(m[1])) delete pkg.devDependencies[dep];
  }
  writeFileSync(join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // web/mobile apps include only the purchased modules' screens
  syncUi(outDir, selection);
  // no other workspace package may depend on a module that is not in this package
  for (const dir of ['tools/erp', 'apps/gateway']) {
    const pj = join(outDir, dir, 'package.json');
    if (!existsSync(pj)) continue;
    const p = JSON.parse(readFileSync(pj, 'utf8'));
    for (const field of ['dependencies', 'devDependencies']) {
      for (const dep of Object.keys(p[field] ?? {})) {
        const m = dep.match(/^@erp\/svc-(.+)$/);
        if (m && !selection.includes(m[1])) delete p[field][dep];
      }
    }
    writeFileSync(pj, JSON.stringify(p, null, 2) + '\n');
  }

  // smoke test for exactly this installation
  mkdirSync(join(outDir, 'tests', 'e2e'), { recursive: true });
  cpSync(join(root, 'tests', 'e2e', 'helpers.ts'), join(outDir, 'tests', 'e2e', 'helpers.ts'));
  // UI <-> API contract test discovers modules itself, so it works for any selection
  if (existsSync(join(root, 'tests', 'ui'))) cpSync(join(root, 'tests', 'ui'), join(outDir, 'tests', 'ui'), { recursive: true });
  const ident = (id: string) => id.replace(/-(.)/g, (_, c) => c.toUpperCase());
  writeFileSync(join(outDir, 'tests', 'e2e', 'installation.test.ts'), `import { afterAll, beforeAll, expect, it } from 'vitest';
${selection.map((id) => `import { definition as ${ident(id)} } from '@erp/svc-${id}';`).join('\n')}
import { install, type Installation } from './helpers.ts';

let erp: Installation;
beforeAll(async () => { erp = await install([${selection.map(ident).join(', ')}]); });
afterAll(async () => { await erp?.close(); });

it('boots every purchased module behind the gateway', async () => {
  const { token } = await erp.provision('smoke');
  expect(token).toBeTruthy();
  const cat = await erp.call('GET', '/api/_catalog');
  expect(cat.body.modules.map((m: { id: string }) => m.id).sort()).toEqual(${JSON.stringify([...selection].sort())});
});
`);

  compose(selection, manifests, join(outDir, 'deploy'), outDir);
  const installed = { customer: opts.customer, modules: selection, versions: Object.fromEntries(selection.map((id) => [id, manifests.find((m) => m.id === id)!.version])), packedAt: new Date().toISOString() };
  writeFileSync(join(outDir, 'INSTALLED_MODULES.json'), JSON.stringify(installed, null, 2) + '\n');
  if (opts.license) writeFileSync(join(outDir, 'deploy', 'erp-license.txt'), opts.license + '\n');
  writeFileSync(join(outDir, 'README.md'), `# ERP — ${opts.customer}

Purchased modules: ${selection.map((id) => `\`${id}\``).join(', ')}

- Develop: \`pnpm install && pnpm db:dev && pnpm check\` (see CLAUDE.md — written so AI coding tools can extend this safely)
- Extend: your changes go in \`services/<module>/ext/\` or new modules — see \`docs/extending-with-ai.md\` (AI command: \`/extend\`)
- Check the base: \`pnpm erp doctor\` — GO Along's code is fingerprinted in \`.erp/vendor-lock.json\`
- Deploy: see \`deploy/README.md\`
- Updates: \`pnpm erp upgrade <release-folder>\` replaces GO Along's files and keeps everything in \`ext/\` and your own modules
- Add more modules later: ask GO Along for an updated release + license, then \`pnpm erp upgrade <release-folder> --apply\`.
`);
  // last: fingerprint exactly what was shipped
  writeVendorLock(outDir, { customer: opts.customer, modules: [...selection].sort(), versions: installed.versions, packedAt: installed.packedAt });
  return outDir;
}
