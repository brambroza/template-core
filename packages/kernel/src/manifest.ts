import { readFileSync } from 'node:fs';
import { isKnownEvent, type EventType } from '@erp/contracts';

/**
 * module.json — the sales sheet AND the wiring diagram of a module.
 * The gateway reads it at runtime; `pnpm erp` reads it to resolve, compose and pack customer selections.
 */
export interface ModuleManifest {
  id: string;
  name: string;
  nameTh: string;
  version: string;
  /** core = always included; feature = sold separately */
  tier: 'core' | 'feature';
  description: string;
  /** modules that MUST be installed for this one to run */
  requires: string[];
  /** modules that add extra behaviour when present (integration via events only) */
  enhancedBy: string[];
  publishes: EventType[];
  subscribes: EventType[];
  permissions: { key: string; label: string }[];
}

export function loadManifest(path: string | URL): ModuleManifest {
  const m = JSON.parse(readFileSync(path, 'utf8')) as ModuleManifest;
  validateManifest(m);
  return m;
}

export function validateManifest(m: ModuleManifest): void {
  if (!/^[a-z][a-z0-9-]*$/.test(m.id)) throw new Error(`Invalid module id "${m.id}"`);
  if (!['core', 'feature'].includes(m.tier)) throw new Error(`${m.id}: tier must be core|feature`);
  for (const t of [...m.publishes, ...m.subscribes]) if (!isKnownEvent(t)) throw new Error(`${m.id}: unknown event "${t}" (add it to @erp/contracts)`);
  for (const p of m.permissions) if (!p.key.startsWith(`${m.id.split('-')[0]}.`) && !p.key.startsWith(`${m.id}.`)) throw new Error(`${m.id}: permission "${p.key}" must be prefixed with the module id`);
}
