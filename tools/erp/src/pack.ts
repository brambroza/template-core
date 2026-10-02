import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleManifest } from '@erp/kernel';
import { compose } from './compose.ts';
import { syncUi } from './ui-sync.ts';

export interface PackOptions {
  customer: string;
  license?: string;
}

const ROOT_FILES = ['pnpm-workspace.yaml', 'tsconfig.json', 'vitest.config.ts', '.gitignore', '.dockerignore', 'Dockerfile', 'CLAUDE.md', 'AGENTS.md'];
const ROOT_DIRS = ['packages', 'apps', 'docs', '.claude', 'scripts', '.github', 'tools'];
const skipNodeModules = (src: string) => !src.split(/[\\/]/).some((p) => p === 'node_modules' || p === '.next' || p === '.expo');
/** internal-only: pricing tests and the license public key are GO Along's, not the customer's */
const shipped = (src: string) => skipNodeModules(src) && !/tools[\\/]erp[\\/]test/.test(src);

/**
 * Build the deliverable for one customer: ONLY the modules they bought (+ core), the shared packages,
 * the gateway, the AI-ready docs, a deploy folder and a smoke test. Pricing data is never shipped.
 */
export function pack(root: string, selection: string[], manifests: ModuleManifest[], outDir: string, opts: PackOptions): string {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  for (const f of ROOT_FILES) if (existsSync(join(root, f))) cpSync(join(root, f), join(outDir, f));
  for (const d of ROOT_DIRS) if (existsSync(join(root, d))) cpSync(join(root, d), join(outDir, d), { recursive: true, filter: shipped });
  for (const id of selection) cpSync(join(root, 'services', id), join(outDir, 'services', id), { recursive: true, filter: skipNodeModules });

  // root package.json: drop services the customer did not buy
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const dep of Object.keys(pkg.devDependencies)) {
    const m = dep.match(/^@erp\/svc-(.+)$/);
    if (m && !selection.includes(m[1])) delete pkg.devDependencies[dep];
  }
  writeFileSync(join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

  // web/mobile apps include only the purchased modules' screens
  syncUi(outDir, selection);

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
- Deploy: see \`deploy/README.md\`
- Add more modules later: ask GO Along for the module folder + an updated license; drop it into \`services/\` and add it to \`deploy/\`.
`);
  return outDir;
}
