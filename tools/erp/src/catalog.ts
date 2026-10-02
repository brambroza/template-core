import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, type ModuleManifest } from '@erp/kernel';

export const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export interface Catalog {
  currency: string;
  platform: { id: string; name: string; nameTh: string; modules: string[]; price: number; description: string };
  modules: Record<string, { price: number }>;
  bundles: { id: string; nameTh: string; modules: string[]; price: number }[];
  updatePlanPct: number;
  services: Record<string, unknown>;
  /** Pricing v2 (optional so older catalogs keep working): monthly managed SaaS, design-partner pilot, partner tiers. */
  rental?: Rental;
  pilot?: Pilot;
  partner?: { minResalePct: number; dealRegistrationDays: number; tiers: PartnerTier[] } & Record<string, unknown>;
}

export interface Rental {
  /** monthly prices (excl. VAT), no source code, hosting + updates + support included */
  platform: number;
  modules: Record<string, number>;
  /** monthly price per bundle id; a bundle without a rental price is not offered for rent */
  bundles: Record<string, number>;
  minTermMonths: number;
  setupFee: number;
  prepayYearDiscountPct: number;
  rentToOwn: { creditPct: number; maxCreditPctOfLicense: number; windowMonths: number };
}

export interface Pilot {
  durationDays: number;
  pricePct: number;
  minPrice: number;
  maxPrice: number;
  creditTowardPurchasePct: number;
  creditWindowDays: number;
  refundPctIfCriteriaMissed: number;
  maxPerPack?: number;
  maxModules?: number;
}

export interface PartnerTier {
  id: string;
  nameTh: string;
  licenseDiscountPct: number;
  volumeDiscounts?: { dealsIn12Months: number; licenseDiscountPct: number }[];
  referralFeePct?: number;
  updatePlanSharePct: number;
  rentalSharePct: number;
  /** 0 = for the whole contract */
  rentalShareMonths: number;
  nfr: { modules: string[]; demoTenant: boolean };
  requirements: string[];
}

export function loadManifests(root = REPO_ROOT): ModuleManifest[] {
  const dir = join(root, 'services');
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'module.json')))
    .map((d) => {
      const m = JSON.parse(readFileSync(join(dir, d.name, 'module.json'), 'utf8')) as ModuleManifest;
      validateManifest(m);
      if (m.id !== d.name) throw new Error(`services/${d.name}/module.json has id "${m.id}" (must equal folder name)`);
      return m;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function loadCatalog(root = REPO_ROOT): Catalog {
  const path = join(root, 'catalog', 'catalog.json');
  if (!existsSync(path)) throw new Error('Pricing (catalog/catalog.json) is not part of this installation — ask GO Along for a quote');
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Expand a customer's picks: add core modules and every transitive `requires`. */
export function resolveSelection(picked: string[], manifests: ModuleManifest[]): string[] {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const out = new Set<string>();
  const visit = (id: string) => {
    const m = byId.get(id);
    if (!m) throw new Error(`Unknown module "${id}". Available: ${[...byId.keys()].join(', ')}`);
    if (out.has(id)) return;
    out.add(id);
    m.requires.forEach(visit);
  };
  manifests.filter((m) => m.tier === 'core').forEach((m) => visit(m.id));
  picked.forEach(visit);
  return [...out].sort((a, b) => (byId.get(a)!.tier === 'core' ? 0 : 1) - (byId.get(b)!.tier === 'core' ? 0 : 1) || a.localeCompare(b));
}

export interface Quote {
  lines: { label: string; price: number }[];
  total: number;
  yearlyUpdates: number;
  currency: string;
}

/** Monthly managed-SaaS quote (`pnpm erp quote <mods> --rent`). `total` is per month. */
export interface RentQuote {
  mode: 'rent';
  lines: { label: string; price: number }[];
  total: number;
  minTermMonths: number;
  /** total × minimum term */
  termTotal: number;
  setupFee: number;
  /** 12 months paid up front, after the prepay discount */
  prepayYear: number;
  /** what the same selection costs to buy (license incl. platform) — basis of rent-to-own credit */
  licenseTotal: number;
  /** the most rent that can be credited when converting to a license */
  maxRentToOwnCredit: number;
  currency: string;
}

export interface QuoteOptions {
  mode?: 'buy' | 'rent';
}

type Priced = { lines: { label: string; price: number }[]; total: number };

/** Cheapest combination of non-overlapping bundles + single modules covering `features`. */
function cheapest(features: string[], bundles: { nameTh: string; modules: string[]; price: number }[], modulePrice: (id: string) => number): Priced {
  let best: Priced | null = null;
  const fit = bundles.filter((b) => b.modules.every((m) => features.includes(m)));
  for (let mask = 0; mask < 1 << fit.length; mask++) {
    const chosen = fit.filter((_, i) => mask & (1 << i));
    const covered = chosen.flatMap((b) => b.modules);
    if (new Set(covered).size !== covered.length) continue; // bundles must not overlap
    const lines = [
      ...chosen.map((b) => ({ label: `Bundle: ${b.nameTh} (${b.modules.join(', ')})`, price: b.price })),
      ...features.filter((f) => !covered.includes(f)).map((f) => ({ label: `Module: ${f}`, price: modulePrice(f) })),
    ];
    const total = lines.reduce((a, l) => a + l.price, 0);
    if (!best || total < best.total) best = { lines, total };
  }
  return best!;
}

/**
 * Price a selection. Default (`mode: 'buy'`): one-time source-code license, cheapest combination of bundles + single
 * modules. `mode: 'rent'`: the same rule over the monthly prices in `catalog.rental`.
 */
export function quote(selected: string[], manifests: ModuleManifest[], catalog: Catalog, opts?: { mode?: 'buy' }): Quote;
export function quote(selected: string[], manifests: ModuleManifest[], catalog: Catalog, opts: { mode: 'rent' }): RentQuote;
export function quote(selected: string[], manifests: ModuleManifest[], catalog: Catalog, opts?: QuoteOptions): Quote | RentQuote;
export function quote(selected: string[], manifests: ModuleManifest[], catalog: Catalog, opts: QuoteOptions = {}): Quote | RentQuote {
  const features = resolveSelection(selected, manifests).filter((id) => manifests.find((m) => m.id === id)!.tier === 'feature');
  const missingPrice = features.filter((id) => !catalog.modules[id]);
  if (missingPrice.length) throw new Error(`No price in catalog.json for: ${missingPrice.join(', ')}`);
  const best = cheapest(features, catalog.bundles, (f) => catalog.modules[f].price);
  const lines = [{ label: `${catalog.platform.nameTh} (${catalog.platform.modules.join(', ')})`, price: catalog.platform.price }, ...best.lines];
  const total = lines.reduce((a, l) => a + l.price, 0);
  if (opts.mode !== 'rent') return { lines, total, yearlyUpdates: Math.round((total * catalog.updatePlanPct) / 100), currency: catalog.currency };

  const r = catalog.rental;
  if (!r) throw new Error('No monthly rental prices in catalog.json (add a "rental" section)');
  const noRent = features.filter((id) => r.modules[id] === undefined);
  if (noRent.length) throw new Error(`No rental price in catalog.json for: ${noRent.join(', ')}`);
  const rentBundles = catalog.bundles.filter((b) => r.bundles[b.id] !== undefined).map((b) => ({ ...b, price: r.bundles[b.id] }));
  const monthly = cheapest(features, rentBundles, (f) => r.modules[f]);
  const rentLines = [{ label: `${catalog.platform.nameTh} — cloud, backup, updates, support`, price: r.platform }, ...monthly.lines];
  const perMonth = rentLines.reduce((a, l) => a + l.price, 0);
  return {
    mode: 'rent',
    lines: rentLines,
    total: perMonth,
    minTermMonths: r.minTermMonths,
    termTotal: perMonth * r.minTermMonths,
    setupFee: r.setupFee,
    prepayYear: Math.round((perMonth * 12 * (100 - r.prepayYearDiscountPct)) / 100),
    licenseTotal: total,
    maxRentToOwnCredit: Math.round((total * r.rentToOwn.maxCreditPctOfLicense) / 100),
    currency: catalog.currency,
  };
}

/** Design-partner pilot fee for a license total (incl. platform): pricePct of it, clamped to [minPrice, maxPrice]. */
export function pilotPrice(licenseTotal: number, catalog: Catalog): number {
  const p = catalog.pilot;
  if (!p) throw new Error('No pilot offer in catalog.json (add a "pilot" section)');
  const raw = Math.round((licenseTotal * p.pricePct) / 100 / 500) * 500;
  return Math.min(p.maxPrice, Math.max(p.minPrice, raw));
}

/** What a partner pays GO Along for a license, given its tier and deals closed in the last 12 months. */
export function partnerCost(licenseTotal: number, tierId: string, catalog: Catalog, dealsIn12Months = 0): { discountPct: number; cost: number; minResale: number } {
  const t = catalog.partner?.tiers.find((x) => x.id === tierId);
  if (!t) throw new Error(`Unknown partner tier "${tierId}". Available: ${(catalog.partner?.tiers ?? []).map((x) => x.id).join(', ')}`);
  const discountPct = (t.volumeDiscounts ?? []).filter((v) => dealsIn12Months >= v.dealsIn12Months).reduce((a, v) => Math.max(a, v.licenseDiscountPct), t.licenseDiscountPct);
  return { discountPct, cost: Math.round((licenseTotal * (100 - discountPct)) / 100), minResale: Math.round((licenseTotal * catalog.partner!.minResalePct) / 100) };
}
