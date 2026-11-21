import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { forbidden, HttpError, unauthorized } from './errors.ts';

export interface AuthContext {
  tenantId: string;
  userId: string;
  /** permission strings, e.g. "sales.order.create", "sales.*", "*" */
  perms: string[];
  /** display name of the signed-in user (from the token) — use it to fill "requested by" snapshots */
  userName?: string;
  /** unique token id (`jti`); undefined for tokens issued before wave 9 */
  tokenId?: string;
  /** issue time of the token (`iat`, epoch seconds) */
  issuedAt?: number;
  /**
   * Feature modules the company's plan includes (claim `mods`, set by identity for cloud subscriptions). Undefined = no plan
   * limit (self-hosted installs, older tokens): every installed module is open. Core modules are always open.
   */
  modules?: string[];
}

/** Message of the 401 a revoked token gets (error code `session_revoked`; apps send the user to login with a notice). */
export const SESSION_REVOKED_MESSAGE = 'เซสชันถูกยกเลิก กรุณาเข้าสู่ระบบใหม่';
export const sessionRevoked = () => new HttpError(401, 'session_revoked', SESSION_REVOKED_MESSAGE);

/** Epoch seconds before which tokens of (tenant, user) are refused, or undefined — see revocation.ts. */
export type RevokedBefore = (tenantId: string, userId: string) => number | undefined;

export interface SignOptions {
  /**
   * Issue time (epoch seconds). Default: now. Identity passes the user's revocation cutoff when it is later than now, so a token
   * issued in the same second as a logout/password change (cutoff = that second + 1) is not refused.
   */
  iat?: number;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Sign an HS256 JWT. Identity issues these; every module verifies with the shared JWT_SECRET. */
export function signToken(secret: string, ctx: AuthContext, ttlSeconds = 60 * 60 * 12, opts: SignOptions = {}): string {
  const now = Math.max(Math.floor(Date.now() / 1000), opts.iat ?? 0);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const jti = randomBytes(16).toString('base64url');
  const payload = b64url(JSON.stringify({
    sub: ctx.userId, tid: ctx.tenantId, perms: ctx.perms, ...(ctx.userName ? { name: ctx.userName } : {}),
    ...(ctx.modules ? { mods: ctx.modules } : {}), jti, iat: now, exp: now + ttlSeconds,
  }));
  const sig = b64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

/**
 * Verify signature, expiry and claims. With `revokedBefore` (every service passes its revocation list, SEC-07) a token whose
 * `iat` is earlier than the user's cutoff is refused with 401 `session_revoked`; a token without `iat` counts as issued at 0.
 */
export function verifyToken(secret: string, token: string, revokedBefore?: RevokedBefore): AuthContext {
  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized('Malformed token');
  const [header, payload, sig] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized('Invalid token');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  // every token identity issues carries `exp`; one without it would never expire (security review 0.3, SEC-12)
  if (typeof claims.exp !== 'number') throw unauthorized('Invalid token claims');
  if (claims.exp < Math.floor(Date.now() / 1000)) throw unauthorized('Token expired');
  if (!claims.tid || !claims.sub) throw unauthorized('Invalid token claims');
  const iat = typeof claims.iat === 'number' ? claims.iat : 0;
  const cutoff = revokedBefore?.(String(claims.tid), String(claims.sub));
  if (cutoff !== undefined && iat < cutoff) throw sessionRevoked();
  return {
    tenantId: claims.tid, userId: claims.sub, perms: Array.isArray(claims.perms) ? claims.perms : [],
    ...(typeof claims.name === 'string' && claims.name ? { userName: claims.name } : {}),
    ...(typeof claims.jti === 'string' && claims.jti ? { tokenId: claims.jti } : {}),
    ...(typeof claims.iat === 'number' ? { issuedAt: claims.iat } : {}),
    ...(Array.isArray(claims.mods) ? { modules: claims.mods.map(String) } : {}),
  };
}

/** Message of the 403 a module answers when the company's plan does not include it (error code `module_not_in_plan`). */
export const notInPlan = (moduleNameTh: string) =>
  new HttpError(403, 'module_not_in_plan', `แพ็กเกจของบริษัทไม่รวม "${moduleNameTh}" — อัปเกรดแพ็กเกจเพื่อใช้งานส่วนนี้`);

/** True when `ctx` may use module `id` of tier `tier`: core always; a feature module when the token has no plan list or lists it. */
export function inPlan(ctx: Pick<AuthContext, 'modules'>, id: string, tier: 'core' | 'feature'): boolean {
  return tier === 'core' || !ctx.modules || ctx.modules.includes(id);
}

/** "*" grants everything, "sales.*" grants every sales permission. */
export function hasPerm(ctx: AuthContext, perm: string): boolean {
  const mod = perm.split('.')[0];
  return ctx.perms.includes('*') || ctx.perms.includes(perm) || ctx.perms.includes(`${mod}.*`);
}

export function requirePerm(ctx: AuthContext, perm: string): void {
  if (!hasPerm(ctx, perm)) throw forbidden(`Missing permission: ${perm}`);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), 32);
  const expected = Buffer.from(hash, 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Constant-time string comparison for shared secrets (x-internal-token). */
export function safeEqual(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const a = createHmac('sha256', 'cmp').update(given).digest();
  const b = createHmac('sha256', 'cmp').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Values shipped in generated `.env.example` files: a server must never run with them (anyone could forge tokens). */
export const PLACEHOLDER_SECRETS = ['replace-with-64-random-characters', 'replace-with-another-random-string', 'change-me', 'changeme', 'secret'];
export const MIN_SECRET_LENGTH = 32;

/**
 * Problems with the shared secrets (JWT_SECRET signs every login token, INTERNAL_TOKEN guards service-to-service calls).
 * Placeholders from `.env.example` are always refused; in production (`NODE_ENV=production`) secrets must also be at least
 * MIN_SECRET_LENGTH characters and different from each other (security review 0.3, SEC-03).
 */
export function secretProblems(env: NodeJS.ProcessEnv, keys: string[] = ['JWT_SECRET', 'INTERNAL_TOKEN']): string[] {
  const out: string[] = [];
  const prod = env.NODE_ENV === 'production';
  for (const key of keys) {
    const v = env[key];
    if (!v) { out.push(`${key} is not set`); continue; }
    if (PLACEHOLDER_SECRETS.includes(v.trim().toLowerCase())) out.push(`${key} is still the example value — generate one with \`openssl rand -hex 32\``);
    else if (prod && v.length < MIN_SECRET_LENGTH) out.push(`${key} is shorter than ${MIN_SECRET_LENGTH} characters (NODE_ENV=production)`);
  }
  if (prod && keys.includes('JWT_SECRET') && keys.includes('INTERNAL_TOKEN') && env.JWT_SECRET && env.JWT_SECRET === env.INTERNAL_TOKEN) out.push('JWT_SECRET and INTERNAL_TOKEN must be different');
  return out;
}
