/**
 * Builds the public landing page: site/dist (static — host on any web server, Vercel, Netlify, GitHub Pages).
 * Prices (license, monthly rental, pilot, partner tiers) come from catalog/catalog.json (pack copy from sales/industry-packs.json), module facts from
 * services/<id>/module.json and function counts from docs/roadmap/functions.json, so the page never drifts
 * from what `pnpm erp quote` says. Copy, industries & contact details: site/site.config.json.
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

/** Function counts from the 1,000+-function roadmap — only numbers go into the page, never the rows. */
function roadmapStats(industries: { id: string; tags: string[] }[]) {
  const file = join(root, 'docs', 'roadmap', 'functions.json');
  const readme = join(root, 'docs', 'roadmap', 'README.md');
  if (!existsSync(file)) return null;
  type Fn = { module: string; status: 'done' | 'building' | 'planned'; industries: string[] };
  const fns: Fn[] = JSON.parse(readFileSync(file, 'utf8'));
  const blank = () => ({ done: 0, building: 0, planned: 0 });
  const totals = blank();
  const byModule: Record<string, ReturnType<typeof blank>> = {};
  const byIndustry: Record<string, ReturnType<typeof blank>> = {};
  for (const f of fns) {
    totals[f.status]++;
    (byModule[f.module] ??= blank())[f.status]++;
    for (const ind of industries) if (f.industries.includes('all') || f.industries.some((t) => ind.tags.includes(t))) (byIndustry[ind.id] ??= blank())[f.status]++;
  }
  // Thai names of modules that do not exist yet (accounting*, payroll* …) and function count per release, from the README tables
  const md = existsSync(readme) ? readFileSync(readme, 'utf8') : '';
  const names: Record<string, string> = {};
  for (const m of md.matchAll(/^\| `([a-z-]+)` \| ([^|]+?) \|/gm)) if (byModule[m[1]] && !names[m[1]] && !/^[\d*]/.test(m[2])) names[m[1]] = m[2].replace(/\s*\*$/, '').trim();
  const releases: Record<string, number> = {};
  for (const m of md.matchAll(/^### (\d+\.\d+) [^\n]*\n+[^\n]*\n+(\d+) ฟังก์ชัน/gm)) releases[m[1]] = Number(m[2]);
  return { total: fns.length, totals, byModule, byIndustry, names, releases };
}

export function buildSite(): string {
  const site = JSON.parse(readFileSync(join(here, 'site.config.json'), 'utf8'));
  const catalog = loadCatalog(root);
  const manifests = loadManifests(root);
  const modules = manifests.map((m) => ({
    id: m.id, name: m.name, nameTh: m.nameTh, tier: m.tier, requires: m.requires,
    pitch: site.modules?.[m.id]?.pitch ?? m.description, for: site.modules?.[m.id]?.for ?? '',
    // "new": true in site.config.json → "ใหม่" badge on the module card (just-shipped modules)
    isNew: site.modules?.[m.id]?.new === true,
  }));
  const featureIds = new Set(manifests.filter((m) => m.tier === 'feature').map((m) => m.id));
  const missing = [...featureIds].filter((id) => !catalog.modules[id]);
  if (missing.length) throw new Error(`No price in catalog.json for: ${missing.join(', ')}`);
  for (const b of catalog.bundles) {
    const bad = b.modules.filter((id) => !featureIds.has(id));
    if (bad.length) throw new Error(`catalog.json bundle ${b.id}: not a feature module: ${bad.join(', ')}`);
  }
  // industry packs (sales/industry-packs.json) must match the catalog bundles they describe
  const packsFile = join(root, 'sales', 'industry-packs.json');
  const packs: { id: string; nameTh: string; segment: string; pitchTh: string; modules: string[]; price: number }[] = existsSync(packsFile) ? JSON.parse(readFileSync(packsFile, 'utf8')) : [];
  for (const p of packs) {
    const b = catalog.bundles.find((x) => x.id === p.id);
    if (!b || b.price !== p.price || [...b.modules].sort().join() !== [...p.modules].sort().join()) throw new Error(`sales/industry-packs.json pack ${p.id} does not match catalog/catalog.json bundles (id, price, modules)`);
  }
  const bundles = catalog.bundles.map((b) => {
    const p = packs.find((x) => x.id === b.id);
    return { id: b.id, nameTh: p?.nameTh ?? b.nameTh, segment: p?.segment ?? (b as { segment?: string }).segment ?? '', pitch: p?.pitchTh ?? '', modules: b.modules, price: b.price };
  });
  for (const ind of site.industries ?? []) if (!bundles.some((b) => b.id === ind.pack)) throw new Error(`site.config.json industry ${ind.id}: pack ${ind.pack} is not a catalog bundle`);
  const roadmap = roadmapStats(site.industries ?? []);
  // pricing v2: monthly rental must cover every module the page can pick, or the buy/rent toggle would show gaps
  if (catalog.rental) {
    const noRent = [...featureIds].filter((id) => catalog.rental!.modules[id] === undefined);
    if (noRent.length) throw new Error(`catalog.json rental.modules: no monthly price for ${noRent.join(', ')}`);
  }
  const { rental, pilot, partner } = catalog;
  const data = { site: { ...site, modules: undefined }, catalog: { platform: catalog.platform, modules: catalog.modules, bundles, updatePlanPct: catalog.updatePlanPct, services: catalog.services, rental, pilot, partner }, modules, roadmap };
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
