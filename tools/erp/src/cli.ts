/**
 * pnpm erp <command>
 *
 *   catalog                                   list modules, dependencies and prices
 *   resolve  <modules>                        what actually gets installed (core + requires)
 *   quote    <modules>                        price, cheapest bundle combination (one-time license)
 *            [--rent]                         monthly managed-SaaS price instead (min. term, setup fee, prepay, rent-to-own)
 *            [--pilot]                        add the 60-day design-partner pilot fee
 *            [--partner referral|reseller|implementer [--deals N]]  what a partner pays / earns on this deal
 *   compose  <modules> [--out dir]            docker-compose installation for that selection
 *   pack     <modules> --customer NAME [--out dir] [--license TOKEN]
 *                                             customer deliverable containing only purchased modules
 *   license  keygen | issue --customer NAME --modules LIST [--expires YYYY-MM-DD] [--updates-until YYYY-MM-DD] | inspect TOKEN
 *   new-module <id> --name "English" --name-th "ไทย"
 *   ui-sync                                   regenerate web/mobile module registries from services/<id>/src/ui.ts
 *   uat-report                                build docs/uat/uat-pack.html from the UAT cases, runs and screenshots
 *   verify                                    architecture rules (run in CI)
 *   showcase-capture [--gateway URL] [--tenant demo] [--password demo1234] [--rows 5] [--out apps/web/showcase/snapshot.json]
 *                                             record a running demo's answers for the public showcase (SHOWCASE=1, docs/deploy-vercel.md)
 *   plan     list [--q text] | set <code> --by NAME [--plan …] [--status …] [--paid-through YYYY-MM-DD] [--trial-days N]
 *            [--max-users N|default] [--modules a,b|default] [--note …] | log <code> | grant-ops <email>
 *                                             cloud plans (back office; IDENTITY_URL + INTERNAL_TOKEN), see tools/erp/src/plan.ts
 *
 * <modules>: comma-separated module ids and/or bundle ids, e.g. "sales,inventory" or "factory-full".
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_PUBLIC_KEY_PATH, generateLicenseKeys, issueLicense, readLicense } from '@erp/kernel';
import { loadCatalog, loadManifests, partnerCost, pilotPrice, quote, REPO_ROOT, resolveSelection } from './catalog.ts';
import { compose } from './compose.ts';
import { pack } from './pack.ts';
import { scaffoldModule } from './scaffold.ts';
import { verify } from './verify.ts';
import { syncUi } from './ui-sync.ts';
import { buildUatReport } from './uat-report.ts';

const [cmd, ...rest] = process.argv.slice(2);
const flags: Record<string, string> = {};
const args: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') || rest[i + 1] === undefined ? 'true' : rest[++i];
  else args.push(rest[i]);
}

const fmt = (n: number) => n.toLocaleString('en-US');
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'customer';

function picks(spec: string | undefined): string[] {
  if (!spec) throw new Error('Give modules, e.g. "sales,inventory" (see `pnpm erp catalog`)');
  const bundles = existsSync(join(REPO_ROOT, 'catalog', 'catalog.json')) ? loadCatalog().bundles : [];
  return spec.split(',').map((x) => x.trim()).filter(Boolean).flatMap((x) => bundles.find((b) => b.id === x)?.modules ?? [x]);
}

function main() {
  const manifests = loadManifests();
  switch (cmd) {
    case 'catalog': {
      const cat = loadCatalog();
      console.log(`${cat.platform.nameTh} — ${fmt(cat.platform.price)} ${cat.currency} (always included: ${cat.platform.modules.join(', ')})\n`);
      for (const m of manifests.filter((x) => x.tier === 'feature')) {
        console.log(`${m.id.padEnd(12)} ${m.nameTh.padEnd(22)} ${fmt(cat.modules[m.id]?.price ?? 0).padStart(8)} ${cat.currency}`);
        console.log(`${''.padEnd(12)} ${m.description}`);
        if (m.enhancedBy.length) console.log(`${''.padEnd(12)} works better with: ${m.enhancedBy.join(', ')}`);
      }
      console.log('\nBundles:');
      for (const b of cat.bundles) console.log(`  ${b.id.padEnd(22)} ${b.nameTh} — ${fmt(b.price)} ${cat.currency} (${b.modules.join(', ')})`);
      return;
    }
    case 'resolve':
      console.log(resolveSelection(picks(args[0]), manifests).join('\n'));
      return;
    case 'quote': {
      const cat = loadCatalog();
      const spec = args[0] ?? [flags.rent, flags.pilot].find((v) => v && v !== 'true');
      const row = (label: string, n: number, unit = '') => console.log(`${label.padEnd(70)} ${fmt(n).padStart(9)}${unit ? ` ${unit}` : ''}`);
      if (flags.rent) {
        const q = quote(picks(spec), manifests, cat, { mode: 'rent' });
        const r = cat.rental!;
        for (const l of q.lines) row(l.label, l.price);
        row('TOTAL per month (excl. VAT) — monthly rental, no source code', q.total, `${q.currency}/month`);
        row(`Minimum term ${q.minTermMonths} months`, q.termTotal, q.currency);
        row('Setup fee (one-time)', q.setupFee, q.currency);
        row(`Prepay 12 months (−${r.prepayYearDiscountPct}%)`, q.prepayYear, q.currency);
        console.log(`Rent-to-own: within ${r.rentToOwn.windowMonths} months, ${r.rentToOwn.creditPct}% of rent paid is credited toward the license ${fmt(q.licenseTotal)} (max ${fmt(q.maxRentToOwnCredit)} ${q.currency})`);
        if (flags.pilot) row(`Pilot ${cat.pilot?.durationDays ?? 60} days (design partner, credited toward purchase)`, pilotPrice(q.licenseTotal, cat), q.currency);
        if (flags.partner) {
          const t = cat.partner?.tiers.find((x) => x.id === flags.partner);
          if (!t) throw new Error(`Unknown partner tier "${flags.partner}"`);
          const months = t.rentalShareMonths || q.minTermMonths;
          row(`Partner ${t.id}: ${t.rentalSharePct}% of rent for ${t.rentalShareMonths ? `${months} months` : 'the contract'} (per month)`, Math.round((q.total * t.rentalSharePct) / 100), q.currency);
        }
        return;
      }
      const q = quote(picks(spec), manifests, cat);
      for (const l of q.lines) console.log(`${l.label.padEnd(70)} ${fmt(l.price).padStart(9)}`);
      console.log(`${'TOTAL (excl. VAT)'.padEnd(70)} ${fmt(q.total).padStart(9)} ${q.currency}`);
      console.log(`${'Yearly updates & support'.padEnd(70)} ${fmt(q.yearlyUpdates).padStart(9)} ${q.currency}`);
      if (flags.pilot) row(`Pilot ${cat.pilot?.durationDays ?? 60} days (design partner, 100% credited if bought within ${cat.pilot?.creditWindowDays ?? 30} days)`, pilotPrice(q.total, cat), q.currency);
      if (flags.partner) {
        const t = cat.partner?.tiers.find((x) => x.id === flags.partner);
        if (!t) throw new Error(`Unknown partner tier "${flags.partner}". Available: ${(cat.partner?.tiers ?? []).map((x) => x.id).join(', ')}`);
        const deals = Number(flags.deals ?? 0);
        if (t.referralFeePct) row(`Partner ${t.id}: referral fee ${t.referralFeePct}%`, Math.round((q.total * t.referralFeePct) / 100), q.currency);
        else {
          const p = partnerCost(q.total, t.id, cat, deals);
          row(`Partner ${t.id}: buys at −${p.discountPct}%`, p.cost, q.currency);
          row(`Partner ${t.id}: lowest resale price (${cat.partner!.minResalePct}% of list)`, p.minResale, q.currency);
          row(`Partner ${t.id}: license margin at list price`, q.total - p.cost, q.currency);
        }
        row(`Partner ${t.id}: ${t.updatePlanSharePct}% of the yearly update plan`, Math.round((q.yearlyUpdates * t.updatePlanSharePct) / 100), `${q.currency}/year`);
      }
      return;
    }
    case 'compose': {
      const sel = resolveSelection(picks(args[0]), manifests);
      const out = resolve(flags.out ?? join(REPO_ROOT, 'deploy', slug(args[0])));
      compose(sel, manifests, out, REPO_ROOT);
      console.log(`Wrote ${out} (${sel.join(', ')})`);
      return;
    }
    case 'pack': {
      if (!flags.customer) throw new Error('--customer is required');
      const sel = resolveSelection(picks(args[0]), manifests);
      const out = resolve(flags.out ?? join(REPO_ROOT, 'dist', slug(flags.customer)));
      pack(REPO_ROOT, sel, manifests, out, { customer: flags.customer, license: flags.license });
      console.log(`Packed ${sel.join(', ')} for ${flags.customer} -> ${out}`);
      return;
    }
    case 'license': {
      const keyDir = join(REPO_ROOT, 'keys');
      const privPath = flags.key ?? process.env.ERP_LICENSE_PRIVATE_KEY_FILE ?? join(keyDir, 'license-private.pem');
      if (args[0] === 'keygen') {
        if (existsSync(privPath) && flags.force !== 'true') throw new Error(`${privPath} exists (use --force to replace — old licenses stop working)`);
        const k = generateLicenseKeys();
        mkdirSync(keyDir, { recursive: true });
        writeFileSync(privPath, k.privateKeyPem, { mode: 0o600 });
        writeFileSync(DEFAULT_PUBLIC_KEY_PATH, k.publicKeyPem);
        console.log(`Private key: ${privPath}  (keep it secret, never commit; keys/ is gitignored)\nPublic key:  ${DEFAULT_PUBLIC_KEY_PATH}  (commit this)`);
        return;
      }
      if (args[0] === 'issue') {
        if (!flags.customer || !flags.modules) throw new Error('--customer and --modules are required');
        const modules = resolveSelection(picks(flags.modules), manifests).filter((id) => manifests.find((m) => m.id === id)!.tier === 'feature');
        const token = issueLicense(readFileSync(privPath, 'utf8'), {
          licenseId: `LIC-${randomUUID().slice(0, 8).toUpperCase()}`, customer: flags.customer, modules,
          issuedAt: new Date().toISOString().slice(0, 10),
          ...(flags.expires ? { expiresAt: flags.expires } : {}),
          ...(flags['updates-until'] ? { updatesUntil: flags['updates-until'] } : {}),
        });
        console.log(token);
        return;
      }
      if (args[0] === 'inspect') {
        const pem = readFileSync(flags.pub ?? DEFAULT_PUBLIC_KEY_PATH, 'utf8');
        console.log(JSON.stringify(readLicense(args[1], pem), null, 2));
        return;
      }
      throw new Error('license keygen | issue | inspect');
    }
    case 'new-module': {
      if (!args[0] || !flags.name || !flags['name-th']) throw new Error('new-module <id> --name "English" --name-th "ไทย"');
      const files = scaffoldModule(REPO_ROOT, args[0], flags.name, flags['name-th']);
      syncUi(REPO_ROOT, loadManifests().map((m) => m.id));
      console.log(`Created services/${args[0]} (${files.length} files). Next: pnpm install, add a price in catalog/catalog.json (modules + rental.modules), pnpm check.`);
      return;
    }
    case 'ui-sync': {
      const apps = syncUi(REPO_ROOT, manifests.map((m) => m.id));
      console.log(`Updated ${apps.join(', ') || 'no apps'} — run pnpm install if dependencies changed`);
      return;
    }
    case 'uat-report': {
      console.log(`Wrote ${buildUatReport(REPO_ROOT)}`);
      return;
    }
    case 'verify': {
      const r = verify(REPO_ROOT);
      for (const w of r.warnings) console.log(`warn  ${w}`);
      for (const e of r.errors) console.log(`ERROR ${e}`);
      console.log(r.errors.length ? `\n${r.errors.length} error(s)` : `\nOK: ${manifests.length} modules follow the rules`);
      if (r.errors.length) process.exitCode = 1;
      return;
    }
    case 'showcase-capture': {
      // async: the walk talks to a running demo gateway
      pending = import('./showcase-capture.ts').then(async ({ captureShowcase }) => {
        const r = await captureShowcase({
          gateway: flags.gateway, tenant: flags.tenant, password: flags.password, out: flags.out ? resolve(flags.out) : undefined,
          rowsPerList: flags.rows ? Number(flags.rows) : undefined, log: (l) => console.log(l),
        });
        console.log(`Wrote ${r.file} — ${(r.bytes / 1024 / 1024).toFixed(2)} MB, ${r.responses} recorded answers, personas ${r.personas.join(', ')}`);
      });
      return;
    }
    case 'plan':
      pending = import('./plan.ts').then(({ runPlan }) => runPlan(args, flags));
      return;
    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0].replace('/**', '').replace(/^ \* ?/gm, ''));
  }
}

let pending: Promise<void> | undefined;
const fail = (e: unknown) => {
  console.error(`error: ${(e as Error).message}`);
  process.exitCode = 1;
};
try {
  main();
  await pending?.catch(fail);
} catch (e) {
  fail(e);
}
