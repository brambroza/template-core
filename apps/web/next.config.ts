import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = fileURLToPath(new URL('../..', import.meta.url));
// written by `pnpm erp ui-sync` (and by `pnpm erp pack` for a customer's selection)
const modulePackages: string[] = JSON.parse(readFileSync(new URL('./src/modules.json', import.meta.url), 'utf8')).packages;

const config: NextConfig = {
  // module screen definitions live in services/<id>/src/ui.ts (shipped with each module)
  transpilePackages: ['@erp/ui-schema', ...modulePackages],
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default config;
