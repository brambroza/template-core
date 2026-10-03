/**
 * pnpm showcase:build — the public "landing page + showcase" exactly as Vercel builds it (docs/deploy-vercel.md):
 *   1. site/build.ts → site/dist (the landing page; CTA "ลองใช้ระบบจริง" → site.config.json `demoUrl`)
 *   2. copy it to apps/web/public/landing (served at `/` by a rewrite in next.config.ts)
 *   3. `next build` in apps/web with SHOWCASE=1 (no gateway needed: /api answers from apps/web/showcase/snapshot.json)
 * Locally the build goes to apps/web/.next-showcase (on Vercel: .next). pnpm showcase:start serves it (PORT, default 3000).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './catalog.ts';
import { buildSite } from '../../../site/build.ts';

const web = join(REPO_ROOT, 'apps', 'web');
const snapshot = join(web, 'showcase', 'snapshot.json');
if (!existsSync(snapshot)) {
  console.error('error: apps/web/showcase/snapshot.json is missing — run `pnpm demo`, then `pnpm erp showcase-capture`');
  process.exit(1);
}
console.log(`snapshot ${(statSync(snapshot).size / 1024 / 1024).toFixed(2)} MB`);

const dist = buildSite();
const landing = join(web, 'public', 'landing');
rmSync(landing, { recursive: true, force: true });
cpSync(dist, landing, { recursive: true });
console.log(`landing page → ${landing}`);

// on Vercel the output must be the default .next; locally keep the normal build (and a running demo) untouched
const distDir = process.env.VERCEL ? {} : { NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || '.next-showcase' };
const r = spawnSync('pnpm', ['exec', 'next', 'build'], { cwd: web, stdio: 'inherit', env: { ...process.env, SHOWCASE: '1', ...distDir } });
process.exit(r.status ?? 1);
