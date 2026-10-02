import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCatalog, loadManifests, partnerCost, pilotPrice, quote, REPO_ROOT, type Catalog } from '../src/catalog.ts';

const manifests = loadManifests();
const catalog = loadCatalog();
const features = manifests.filter((m) => m.tier === 'feature').map((m) => m.id);
const cli = (...args: string[]) =>
  execFileSync(process.execPath, ['--import', 'tsx', join(REPO_ROOT, 'tools', 'erp', 'src', 'cli.ts'), ...args], { cwd: REPO_ROOT, encoding: 'utf8' });

describe('pricing v2 — catalog data', () => {
  it('has a monthly price for every feature module and every bundle', () => {
    const r = catalog.rental!;
    expect(r.platform).toBeGreaterThan(0);
    for (const id of features) expect(r.modules[id], id).toBeGreaterThan(0);
    for (const b of catalog.bundles) expect(r.bundles[b.id], b.id).toBeGreaterThan(0);
    expect(Object.keys(r.modules).sort()).toEqual(Object.keys(catalog.modules).sort());
  });

  it('a bundle is never undercut by another combination, to buy or to rent', () => {
    for (const b of catalog.bundles) {
      expect(quote(b.modules, manifests, catalog).total, b.id).toBe(catalog.platform.price + b.price);
      expect(quote(b.modules, manifests, catalog, { mode: 'rent' }).total, b.id).toBe(catalog.rental!.platform + catalog.rental!.bundles[b.id]);
    }
  });

  it('a month of rent is 4–5% of the license, so rent-to-own and the partner math stay sane', () => {
    for (const b of catalog.bundles) {
      const pct = quote(b.modules, manifests, catalog, { mode: 'rent' }).total / quote(b.modules, manifests, catalog).total;
      expect(pct, b.id).toBeGreaterThanOrEqual(0.04);
      expect(pct, b.id).toBeLessThanOrEqual(0.05);
    }
  });

  it('partner tiers are ordered and pilot terms are complete', () => {
    const t = Object.fromEntries(catalog.partner!.tiers.map((x) => [x.id, x]));
    expect(Object.keys(t)).toEqual(['referral', 'reseller', 'implementer']);
    expect(t.referral.referralFeePct).toBeGreaterThan(0);
    expect(t.reseller.licenseDiscountPct).toBeGreaterThan(0);
    expect(t.implementer.updatePlanSharePct).toBeGreaterThan(t.reseller.updatePlanSharePct);
    expect(t.reseller.updatePlanSharePct).toBeGreaterThan(t.referral.updatePlanSharePct);
    for (const tier of catalog.partner!.tiers) for (const id of tier.nfr.modules) expect(features).toContain(id);
    expect(catalog.pilot!.durationDays).toBe(60);
    expect(catalog.pilot!.creditTowardPurchasePct).toBe(100);
  });
});

describe('quote --rent', () => {
  it('prices the launch packs at the monthly numbers sales already quotes', () => {
    expect(quote(['maintenance', 'inventory', 'automation'], manifests, catalog, { mode: 'rent' }).total).toBe(3190);
    expect(quote(['approvals', 'expense', 'hr', 'booking'], manifests, catalog, { mode: 'rent' }).total).toBe(2890);
    expect(quote(['crm', 'projects', 'sales', 'expense', 'automation'], manifests, catalog, { mode: 'rent' }).total).toBe(3790);
  });

  it('adds core modules and requirements, then picks the cheapest monthly mix', () => {
    const r = catalog.rental!;
    const one = quote(['helpdesk'], manifests, catalog, { mode: 'rent' });
    expect(one.total).toBe(r.platform + r.modules.helpdesk);
    expect(one.lines).toHaveLength(2);
    const q = quote(['sales', 'purchasing', 'inventory', 'costing'], manifests, catalog, { mode: 'rent' });
    expect(q.total).toBe(r.platform + r.bundles.trading + r.modules.costing);
    expect(q.lines.map((l) => l.label).join()).toMatch(/Bundle: ซื้อมาขายไป/);
  });

  it('returns term, setup, prepay and rent-to-own figures', () => {
    const q = quote(['maintenance', 'inventory', 'automation'], manifests, catalog, { mode: 'rent' });
    const r = catalog.rental!;
    expect(q.mode).toBe('rent');
    expect(q.termTotal).toBe(q.total * r.minTermMonths);
    expect(q.setupFee).toBe(r.setupFee);
    expect(q.prepayYear).toBe(Math.round((q.total * 12 * (100 - r.prepayYearDiscountPct)) / 100));
    expect(q.licenseTotal).toBe(70000);
    expect(q.maxRentToOwnCredit).toBe(35000);
    expect(q.currency).toBe('THB');
  });

  it('buy mode is unchanged when the option is given explicitly', () => {
    const a = quote(['sales', 'purchasing', 'inventory'], manifests, catalog);
    const b = quote(['sales', 'purchasing', 'inventory'], manifests, catalog, { mode: 'buy' });
    expect(b).toEqual(a);
    expect(a).not.toHaveProperty('mode');
  });

  it('fails clearly when a catalog has no rental prices', () => {
    const old: Catalog = { ...catalog, rental: undefined };
    expect(() => quote(['sales'], manifests, old, { mode: 'rent' })).toThrow(/No monthly rental prices/);
    const partial: Catalog = { ...catalog, rental: { ...catalog.rental!, modules: { ...catalog.rental!.modules, sales: undefined as unknown as number } } };
    expect(() => quote(['sales'], manifests, partial, { mode: 'rent' })).toThrow(/No rental price in catalog.json for: sales/);
    // a bundle without a rental price is simply not offered for rent
    const noBundle: Catalog = { ...catalog, rental: { ...catalog.rental!, bundles: {} } };
    const r = noBundle.rental!;
    expect(quote(['sales', 'purchasing', 'inventory'], manifests, noBundle, { mode: 'rent' }).total).toBe(r.platform + r.modules.sales + r.modules.purchasing + r.modules.inventory);
  });
});

describe('pilot & partner helpers', () => {
  it('pilot = 50% of the license, clamped to the min/max fee', () => {
    expect(pilotPrice(70000, catalog)).toBe(35000);
    expect(pilotPrice(74000, catalog)).toBe(37000);
    expect(pilotPrice(87000, catalog)).toBe(43500);
    expect(pilotPrice(40000, catalog)).toBe(catalog.pilot!.minPrice);
    expect(pilotPrice(214000, catalog)).toBe(catalog.pilot!.maxPrice);
  });

  it('partner cost follows the tier and volume discounts', () => {
    expect(partnerCost(70000, 'reseller', catalog)).toEqual({ discountPct: 30, cost: 49000, minResale: 63000 });
    expect(partnerCost(70000, 'implementer', catalog, 4).discountPct).toBe(30);
    expect(partnerCost(70000, 'implementer', catalog, 5)).toMatchObject({ discountPct: 35, cost: 45500 });
    expect(partnerCost(70000, 'implementer', catalog, 12)).toMatchObject({ discountPct: 40, cost: 42000 });
    expect(() => partnerCost(70000, 'gold', catalog)).toThrow(/Unknown partner tier/);
  });
});

describe('pnpm erp quote (CLI)', () => {
  it('license output keeps its format', () => {
    const out = cli('quote', 'smart-maintenance');
    expect(out).toMatch(/TOTAL \(excl\. VAT\)\s+70,000 THB/);
    expect(out).toMatch(/Yearly updates & support\s+14,000 THB/);
    expect(out).not.toMatch(/month/);
  });

  it('--rent prints the monthly price and the contract terms', () => {
    const out = cli('quote', 'smart-maintenance', '--rent');
    expect(out).toMatch(/TOTAL per month \(excl\. VAT\).*\s3,190 THB\/month/);
    expect(out).toMatch(/Minimum term 12 months\s+38,280 THB/);
    expect(out).toMatch(/Setup fee \(one-time\)\s+9,900 THB/);
    expect(out).toMatch(/Rent-to-own: .*license 70,000 \(max 35,000 THB\)/);
  });

  it('--pilot and --partner add the deal economics', () => {
    const out = cli('quote', 'smart-maintenance', '--pilot', '--partner', 'implementer', '--deals', '5');
    expect(out).toMatch(/Pilot 60 days.*\s35,000 THB/);
    expect(out).toMatch(/buys at −35%\s+45,500 THB/);
    expect(out).toMatch(/35% of the yearly update plan\s+4,900 THB\/year/);
    expect(cli('quote', 'smart-maintenance', '--rent', '--partner', 'implementer')).toMatch(/30% of rent .*\s957 THB/);
  });
});
