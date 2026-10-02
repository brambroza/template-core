/**
 * Builds the public landing page: site/dist (static — host on any web server, Vercel, Netlify, GitHub Pages).
 * Prices come from catalog/catalog.json and module facts from services/<id>/module.json, so the page
 * never drifts from what `pnpm erp quote` says. Copy & contact details: site/site.config.json.
 *
 *   pnpm site            # build
 *   pnpm site --serve    # build and serve on http://localhost:4321
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog, loadManifests } from '../tools/erp/src/catalog.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const out = join(here, 'dist');

export function buildSite(): string {
  const site = JSON.parse(readFileSync(join(here, 'site.config.json'), 'utf8'));
  const catalog = loadCatalog(root);
  const modules = loadManifests(root).map((m) => ({
    id: m.id, name: m.name, nameTh: m.nameTh, tier: m.tier, requires: m.requires,
    pitch: site.modules?.[m.id]?.pitch ?? m.description, for: site.modules?.[m.id]?.for ?? '',
  }));
  const missing = modules.filter((m) => m.tier === 'feature' && !catalog.modules[m.id]).map((m) => m.id);
  if (missing.length) throw new Error(`No price in catalog.json for: ${missing.join(', ')}`);
  const data = { site: { ...site, modules: undefined }, catalog: { platform: catalog.platform, modules: catalog.modules, bundles: catalog.bundles, updatePlanPct: catalog.updatePlanPct, services: catalog.services }, modules };
  // JSON inside <script>: escape "<" so no value can close the tag
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = readFileSync(join(here, 'src', 'index.html'), 'utf8').replace('__DATA__', () => json);

  if (existsSync(out)) rmSync(out, { recursive: true });
  mkdirSync(join(out, 'vendor'), { recursive: true });
  writeFileSync(join(out, 'index.html'), html);
  cpSync(join(here, 'assets'), join(out, 'assets'), { recursive: true });
  // the web app already depends on these exact versions
  const gsapDir = join(root, 'apps', 'web', 'node_modules', 'gsap');
  const threeDir = join(root, 'apps', 'web', 'node_modules', 'three');
  cpSync(join(gsapDir, 'dist', 'gsap.min.js'), join(out, 'vendor', 'gsap.min.js'));
  cpSync(join(gsapDir, 'dist', 'ScrollTrigger.min.js'), join(out, 'vendor', 'ScrollTrigger.min.js'));
  cpSync(join(threeDir, 'build', 'three.module.js'), join(out, 'vendor', 'three.module.js'));
  cpSync(join(threeDir, 'build', 'three.core.js'), join(out, 'vendor', 'three.core.js'));
  return out;
}

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json' };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = buildSite();
  console.log(`Built ${dir}`);
  if (process.argv.includes('--serve')) {
    const port = Number(process.env.PORT ?? 4321);
    createServer((req, res) => {
      const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
      const file = join(dir, path.endsWith('/') ? `${path}index.html` : path);
      if (!file.startsWith(dir) || !existsSync(file)) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
    }).listen(port, () => console.log(`Landing page on http://localhost:${port}`));
  }
}
