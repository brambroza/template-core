import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Module licensing.
 *
 * A license is `base64url(payload).base64url(ed25519 signature)` signed with GO Along's private key.
 * Each service checks at boot that its module id is in `modules`. The public key ships with the
 * kernel (packages/kernel/license-public.pem) or comes from ERP_LICENSE_PUBLIC_KEY.
 *
 * The customer receives source code, so this is a contractual guard rail (it makes the purchased
 * scope explicit and stops accidental use of unpurchased modules), not DRM.
 */
export interface LicensePayload {
  licenseId: string;
  customer: string;
  modules: string[];
  /** ISO date; omitted = perpetual */
  expiresAt?: string;
  /** ISO date until which updates are included */
  updatesUntil?: string;
  issuedAt: string;
}

export const DEFAULT_PUBLIC_KEY_PATH = fileURLToPath(new URL('../license-public.pem', import.meta.url));

export function generateLicenseKeys(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export function issueLicense(privateKeyPem: string, payload: LicensePayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = sign(null, body, createPrivateKey(privateKeyPem));
  return `${body.toString('base64url')}.${sig.toString('base64url')}`;
}

export function readLicense(token: string, publicKeyPem: string): LicensePayload {
  const [body, sig] = token.trim().split('.');
  if (!body || !sig) throw new Error('Malformed license');
  const raw = Buffer.from(body, 'base64url');
  if (!verify(null, raw, createPublicKey(publicKeyPem), Buffer.from(sig, 'base64url'))) throw new Error('License signature is invalid');
  return JSON.parse(raw.toString('utf8')) as LicensePayload;
}

export type LicenseCheck = { ok: true; mode: 'dev' | 'licensed'; license?: LicensePayload } | { ok: false; reason: string };

/** Decide whether `moduleId` may start. Core modules (tier "core") are always allowed. */
export function checkLicense(moduleId: string, tier: string, env: NodeJS.ProcessEnv): LicenseCheck {
  const token = env.ERP_LICENSE;
  if (!token || token === 'dev') {
    if (env.NODE_ENV === 'production') return { ok: false, reason: 'ERP_LICENSE is required in production' };
    return { ok: true, mode: 'dev' };
  }
  const pem = env.ERP_LICENSE_PUBLIC_KEY ?? (existsSync(DEFAULT_PUBLIC_KEY_PATH) ? readFileSync(DEFAULT_PUBLIC_KEY_PATH, 'utf8') : undefined);
  if (!pem) return { ok: false, reason: 'No license public key (run `pnpm erp license keygen`)' };
  let lic: LicensePayload;
  try {
    lic = readLicense(token, pem);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (lic.expiresAt && new Date(lic.expiresAt) < new Date()) return { ok: false, reason: `License expired on ${lic.expiresAt}` };
  if (tier !== 'core' && !lic.modules.includes(moduleId)) return { ok: false, reason: `Module "${moduleId}" is not included in license ${lic.licenseId}` };
  return { ok: true, mode: 'licensed', license: lic };
}
