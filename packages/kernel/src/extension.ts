import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isKnownEvent, type EventType } from '@erp/contracts';
import type { AuthContext } from './auth.ts';
import type { EventHandlers } from './events.ts';
import type { ModuleManifest } from './manifest.ts';
import type { Kernel } from './service.ts';

/**
 * Customer extension layer — `services/<module>/ext/`.
 *
 * GO Along ships each module as a tested, correct base ("vendor" code). A customer (usually with an AI coding tool)
 * adds behaviour in the module's `ext/` folder instead of editing vendor files, so:
 *   - vendor files can be replaced wholesale by an update (`pnpm erp upgrade`) without merging,
 *   - `pnpm erp doctor` can prove the base is still the one GO Along tested,
 *   - customer code is visibly separated, which is also where support stops.
 *
 * Layout (every file optional):
 *   ext/ext.json          extra permissions, published / subscribed events, a one-line description
 *   ext/index.ts          `export default defineExtension({ routes, handlers, guards })`
 *   ext/migrations/*.sql  applied after the vendor migrations, tracked as `ext/<file>` (same rules: `tenant_id` + `-- @tenant`)
 *   ext/ui.ts             screen patches + new screens (`defineUiExtension` from @erp/ui-schema), merged by `pnpm erp ui-sync`
 *   ext/test/*.test.ts    the customer's own tests (run by `pnpm check`)
 *
 * The kernel finds `ext/` next to the module's `migrations/` folder; nothing in the vendor code has to change.
 */

export interface ExtensionManifest {
  /** what this installation added, in one line (shown by `pnpm erp doctor` and in `/_manifest`) */
  description?: string;
  /** new permissions; must use the module's prefix (e.g. `purchasing.x_budget.approve`) and not repeat a vendor key */
  permissions?: { key: string; label: string }[];
  /** events the extension emits (must already exist in @erp/contracts) */
  publishes?: EventType[];
  /** events the extension handles — must match the keys of `handlers` in ext/index.ts */
  subscribes?: EventType[];
}

/**
 * A business rule on an existing route, run before the vendor handler (Fastify preHandler). Throw a kernel error
 * (`badRequest`, `conflict`, `forbidden`…) to refuse the request; return to let it through. Use `k.db.tx(auth.tenantId, …)`
 * for lookups. Guards cannot change what the vendor route does — they can only say "no", with a Thai message.
 */
export type Guard = (req: FastifyRequest, ctx: { k: Kernel; auth: AuthContext | null }) => void | Promise<void>;

export interface Extension {
  /** new routes (registered after the vendor routes; a path that already exists is an error — extend, don't override) */
  routes?: (app: FastifyInstance, k: Kernel) => void | Promise<void>;
  /** event handlers, run after the vendor handler for the same event, in the same transaction */
  handlers?: EventHandlers;
  /** business rules on existing routes, keyed `'METHOD /route/:template'` exactly as the vendor declares it */
  guards?: Record<string, Guard>;
}

export function defineExtension(ext: Extension): Extension {
  return ext;
}

/** Where a module's extension folder is: `ext/` next to its `migrations/` folder. */
export function extensionDirOf(migrationsDir: string): string {
  return join(dirname(migrationsDir), 'ext');
}

/** ext/ext.json of a module, validated against its vendor manifest; null when the module has no extension manifest. */
export function loadExtensionManifest(extDir: string, vendor: ModuleManifest): ExtensionManifest | null {
  const path = join(extDir, 'ext.json');
  if (!existsSync(path)) return null;
  let ext: ExtensionManifest;
  try {
    ext = JSON.parse(readFileSync(path, 'utf8')) as ExtensionManifest;
  } catch (e) {
    throw new Error(`${vendor.id}: ext/ext.json is not valid JSON (${(e as Error).message})`);
  }
  validateExtensionManifest(ext, vendor);
  return ext;
}

export function validateExtensionManifest(ext: ExtensionManifest, vendor: ModuleManifest): void {
  const id = vendor.id;
  const prefix = id.split('-')[0];
  const vendorPerms = new Set(vendor.permissions.map((p) => p.key));
  for (const p of ext.permissions ?? []) {
    if (!p.key || !p.label) throw new Error(`${id}: ext/ext.json permission needs "key" and "label"`);
    if (!p.key.startsWith(`${prefix}.`) && !p.key.startsWith(`${id}.`)) throw new Error(`${id}: ext permission "${p.key}" must be prefixed with "${prefix}."`);
    if (vendorPerms.has(p.key)) throw new Error(`${id}: ext permission "${p.key}" already exists in module.json — reuse it instead of declaring it again`);
  }
  for (const t of [...(ext.publishes ?? []), ...(ext.subscribes ?? [])]) {
    if (!isKnownEvent(t)) throw new Error(`${id}: ext/ext.json uses unknown event "${t}" (events are contracts between modules — see docs/extending-with-ai.md)`);
  }
}

/** The manifest a module serves when it has an extension: vendor + extension permissions and events, plus an `extension` summary. */
export function mergeExtensionManifest(vendor: ModuleManifest, ext: ExtensionManifest | null): ModuleManifest {
  if (!ext) return vendor;
  const union = <T>(a: T[], b: T[] = []) => [...a, ...b.filter((x) => !a.includes(x))];
  return {
    ...vendor,
    permissions: [...vendor.permissions, ...(ext.permissions ?? [])],
    publishes: union(vendor.publishes, ext.publishes),
    subscribes: union(vendor.subscribes, ext.subscribes),
    extension: { description: ext.description ?? '', permissions: (ext.permissions ?? []).map((p) => p.key), publishes: ext.publishes ?? [], subscribes: ext.subscribes ?? [] },
  };
}

/** `'POST /purchase-orders/:id/approve'` → `{ method, url }`; throws on a malformed key. */
export function parseGuardKey(key: string): { method: string; url: string } {
  const m = key.trim().match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)$/);
  if (!m) throw new Error(`guard "${key}": use "METHOD /path" with the route's exact template, e.g. "POST /purchase-orders/:id/approve"`);
  return { method: m[1], url: m[2] };
}
