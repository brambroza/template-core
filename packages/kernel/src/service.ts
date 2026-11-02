import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { EventData, EventType } from '@erp/contracts';
import { attachmentPerms, mountAttachments, type AttachmentsSpec } from './attachments.ts';
import { mountAudit, recordAudit } from './audit.ts';
import { safeEqual, secretProblems, verifyToken, type AuthContext } from './auth.ts';
import { createDb, migrate, type Client, type Db } from './db.ts';
import { toErrorBody, unauthorized } from './errors.ts';
import { dispatchOutbox, emit, receiveEvent, type EventHandlers } from './events.ts';
import { extensionDirOf, loadExtensionManifest, mergeExtensionManifest, parseGuardKey, type Extension, type Guard } from './extension.ts';
import { checkLicense } from './license.ts';
import type { ModuleManifest } from './manifest.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyRevocation, DEFAULT_REVOCATION_RELOAD_MS, isKernelSubscription, RevocationList } from './revocation.ts';

declare module 'fastify' {
  interface FastifyRequest {
    authCtx: AuthContext | null;
  }
  interface FastifyContextConfig {
    /** no login required */
    public?: boolean;
    /** service-to-service only (x-internal-token) */
    internal?: boolean;
  }
}

export interface Kernel {
  db: Db;
  manifest: ModuleManifest;
  env: NodeJS.ProcessEnv;
  /**
   * publish an event inside the current transaction. `identity.tokens_revoked` is also applied to this module's own
   * revocation list in the same transaction (the router does not send an event back to its publisher).
   */
  emit<T extends EventType>(c: Client, type: T, data: EventData<T>): Promise<string>;
  /** token revocation cutoffs this service enforces (SEC-07, see revocation.ts) */
  revocations: RevocationList;
}

export interface ServiceDefinition {
  manifest: ModuleManifest;
  migrationsDir: string;
  routes: (app: FastifyInstance, k: Kernel) => void | Promise<void>;
  handlers?: EventHandlers;
  /**
   * Opt in to file attachments (`/_attachments` routes, see attachments.ts). Without it the module has no attachment routes.
   * Every permission named here, and `<module>.attachment.delete`, must be declared in module.json.
   */
  attachments?: AttachmentsSpec;
  /**
   * The customer extension folder (see extension.ts). Default: `ext/` next to `migrationsDir`, so every module picks up
   * `services/<module>/ext/` without changing its code. `false` turns extensions off (used by tests of the vendor base).
   */
  extDir?: string | false;
}

/** Permission prefix of a module ("master" for master-data) — the prefix kernel-provided permissions use. */
export function permPrefix(moduleId: string): string {
  return moduleId.split('-')[0];
}

/** Permissions every module gets from the kernel; added to the served manifest when module.json does not declare them. */
export function kernelPermissions(moduleId: string): { key: string; label: string }[] {
  return [{ key: `${permPrefix(moduleId)}.audit.read`, label: 'ดูประวัติการแก้ไข (audit log)' }];
}

export interface Service {
  app: FastifyInstance;
  db: Db;
  kernel: Kernel;
  manifest: ModuleManifest;
  migrate(): Promise<string[]>;
  dispatch(): Promise<{ sent: number; failed: number }>;
  /** reload `_revoked_tokens` into memory (done at boot and every TOKEN_REVOCATION_RELOAD_MS) */
  reloadRevocations(): Promise<number>;
  start(opts?: { port?: number; host?: string }): Promise<string>;
  close(): Promise<void>;
}

/** Current user of an authenticated route. */
export function auth(req: FastifyRequest): AuthContext {
  if (!req.authCtx) throw unauthorized();
  return req.authCtx;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`Missing env ${key}`);
  return v;
}

export function createService(def: ServiceDefinition, env: NodeJS.ProcessEnv = process.env): Service {
  // customer extension (ext/): its permissions and events join the served manifest; vendor wiring is checked on its own below
  const extDir = def.extDir === false ? null : (def.extDir ?? extensionDirOf(def.migrationsDir));
  const extManifest = extDir ? loadExtensionManifest(extDir, def.manifest) : null;
  const extEntry = extDir && ['index.ts', 'index.js'].map((f) => join(extDir, f)).find((f) => existsSync(f));
  const merged = mergeExtensionManifest(def.manifest, extManifest);
  const own = new Set(merged.permissions.map((p) => p.key));
  const manifest: ModuleManifest = { ...merged, permissions: [...merged.permissions, ...kernelPermissions(def.manifest.id).filter((p) => !own.has(p.key))] };
  const prefix = permPrefix(manifest.id);
  if (def.attachments) {
    const missing = attachmentPerms(def.attachments, `${prefix}.attachment.delete`).filter((p) => !own.has(p));
    if (missing.length) throw new Error(`${manifest.id}: attachments use permissions not declared in module.json: ${missing.join(', ')}`);
  }
  const ownHandlers = def.handlers ?? {};
  // kernel subscriptions (identity.tokens_revoked) are handled by the kernel itself and need not be listed in module.json
  const handled = Object.keys(ownHandlers).filter((x) => !isKernelSubscription(x)).sort().join(',');
  const declared = def.manifest.subscribes.filter((x) => !isKernelSubscription(x)).sort().join(',');
  if (handled !== declared) throw new Error(`${manifest.id}: module.json "subscribes" [${declared}] must match handlers [${handled}]`);
  const revocations = new RevocationList();
  // extension handlers are loaded with ext/index.ts (async, before the app is ready); they run after the vendor handler, same transaction
  const extHandlers: EventHandlers = {};
  const vendorHandlers: EventHandlers = { ...ownHandlers };
  for (const t of extManifest?.subscribes ?? []) {
    const vendor = ownHandlers[t] as ((d: unknown, ctx: Parameters<NonNullable<EventHandlers[typeof t]>>[1]) => Promise<void>) | undefined;
    (vendorHandlers as Record<string, unknown>)[t] = async (d: unknown, ctx: Parameters<NonNullable<EventHandlers[typeof t]>>[1]) => {
      await vendor?.(d, ctx);
      await (extHandlers[t] as ((d: unknown, c: typeof ctx) => Promise<void>) | undefined)?.(d, ctx);
    };
  }
  const handlers: EventHandlers = {
    ...vendorHandlers,
    // built-in: store the cutoff, then run the module's own handler if it has one
    'identity.tokens_revoked': async (data, ctx) => {
      await applyRevocation(ctx.client, revocations, data);
      await vendorHandlers['identity.tokens_revoked']?.(data, ctx);
    },
  };

  const jwtSecret = required(env, 'JWT_SECRET');
  const internalToken = required(env, 'INTERNAL_TOKEN');
  const db = createDb(required(env, 'DATABASE_URL'));
  const kernel: Kernel = {
    db, manifest, env, revocations,
    async emit(c, type, data) {
      const id = await emit(c, manifest.id, type, data);
      if (type === 'identity.tokens_revoked') await applyRevocation(c, revocations, data as EventData<'identity.tokens_revoked'>);
      return id;
    },
  };

  const app = Fastify({ logger: env.LOG_LEVEL ? { level: env.LOG_LEVEL } : false, bodyLimit: 5 * 1024 * 1024 });
  app.decorateRequest('authCtx', null);
  app.decorateRequest('auditEntityId', null);

  app.addHook('onRequest', async (req) => {
    const cfg = req.routeOptions.config ?? {};
    if (cfg.public) return;
    if (cfg.internal) {
      if (!safeEqual(req.headers['x-internal-token'], internalToken)) throw unauthorized('Internal endpoint');
      return;
    }
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw unauthorized();
    req.authCtx = verifyToken(jwtSecret, h.slice(7), revocations.before);
  });

  const reloadRevocations = () => revocations.load(db);
  // boot: load every cutoff before the first request is served (start() migrates before listen → ready)
  app.addHook('onReady', async () => {
    try { await reloadRevocations(); } catch (e) { app.log.warn(`[${manifest.id}] token revocations not loaded: ${(e as Error).message}`); }
  });

  // audit log: every successful write by a signed-in user (runs before the response leaves, so readers see it at once)
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.authCtx && req.method !== 'GET' && req.method !== 'HEAD' && reply.statusCode < 400) await recordAudit(db, req, reply.statusCode, payload);
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    const { status, body } = toErrorBody(err);
    if (status >= 500) req.log.error(err);
    reply.code(status).send(body);
  });

  app.get('/_health', { config: { public: true } }, async () => ({ status: 'ok', module: manifest.id, version: manifest.version }));
  app.get('/_manifest', { config: { public: true } }, async () => manifest);
  app.post('/_events', { config: { internal: true } }, async (req) => ({ status: await receiveEvent(db, manifest.id, handlers, req.body, env) }));

  mountAudit(app, { db, permPrefix: prefix });
  if (def.attachments) mountAttachments(app, { db, moduleId: manifest.id, permPrefix: prefix, jwtSecret, spec: def.attachments, revokedBefore: revocations.before });

  // guards (extension business rules on existing routes) — added before any route; the map is filled when ext/index.ts loads
  const guards = new Map<string, Guard>();
  if (extEntry) {
    app.addHook('preHandler', async (req) => {
      const g = guards.get(`${req.method} ${req.routeOptions.url}`);
      if (g) await g(req, { k: kernel, auth: req.authCtx });
    });
  }

  const ready = Promise.resolve(def.routes(app, kernel));

  if (extEntry) {
    app.register(async (scope) => {
      const mod = (await import(pathToFileURL(extEntry).href)) as { default?: Extension };
      const ext = mod.default ?? {};
      const declared = (extManifest?.subscribes ?? []).slice().sort().join(',');
      const given = Object.keys(ext.handlers ?? {}).sort().join(',');
      if (declared !== given) throw new Error(`${manifest.id}: ext/ext.json "subscribes" [${declared}] must match ext handlers [${given}]`);
      Object.assign(extHandlers, ext.handlers ?? {});
      for (const [key, g] of Object.entries(ext.guards ?? {})) {
        const { method, url } = parseGuardKey(key);
        guards.set(`${method} ${url}`, g);
      }
      await ext.routes?.(scope, kernel);
    });
    // a guard on a route that does not exist (renamed by an update, typo) must fail loudly, never silently stop guarding
    app.addHook('onReady', async () => {
      for (const key of guards.keys()) {
        const [method, url] = key.split(' ');
        if (!app.hasRoute({ method: method as 'GET', url })) throw new Error(`${manifest.id}: ext guard "${key}" matches no route of this module`);
      }
    });
  } else if (extManifest?.subscribes?.length) {
    throw new Error(`${manifest.id}: ext/ext.json subscribes to events but there is no ext/index.ts with handlers`);
  }
  const extMigrations = extDir ? join(extDir, 'migrations') : undefined;

  let timer: NodeJS.Timeout | undefined;
  let reloadTimer: NodeJS.Timeout | undefined;
  let dispatching = false;
  const dispatch = async () => {
    const router = env.EVENT_ROUTER_URL;
    if (!router) return { sent: 0, failed: 0 };
    return dispatchOutbox(db, router, internalToken);
  };

  return {
    app, db, kernel, manifest,
    migrate: () => migrate(db, def.migrationsDir, extMigrations),
    dispatch,
    reloadRevocations,
    async start(opts = {}) {
      const weak = secretProblems(env);
      if (weak.length) throw new Error(`[${manifest.id}] refusing to start: ${weak.join('; ')}`);
      const lic = checkLicense(manifest.id, manifest.tier, env);
      if (!lic.ok) throw new Error(`[${manifest.id}] license check failed: ${lic.reason}`);
      await ready;
      await migrate(db, def.migrationsDir, extMigrations);
      const address = await app.listen({ port: opts.port ?? Number(env.PORT ?? 3000), host: opts.host ?? env.HOST ?? '0.0.0.0' });
      if (env.EVENT_ROUTER_URL) {
        timer = setInterval(async () => {
          if (dispatching) return;
          dispatching = true;
          try { await dispatch(); } catch (e) { app.log.error(e); } finally { dispatching = false; }
        }, Number(env.EVENT_DISPATCH_MS ?? 1000));
      }
      // other instances of this module may have received a revocation this one did not (SEC-07)
      const reloadMs = Number(env.TOKEN_REVOCATION_RELOAD_MS ?? DEFAULT_REVOCATION_RELOAD_MS);
      if (reloadMs > 0) {
        reloadTimer = setInterval(() => { reloadRevocations().catch((e) => app.log.error(e)); }, reloadMs);
        reloadTimer.unref();
      }
      app.log.info(`${manifest.id} ${lic.mode} listening on ${address}`);
      return address;
    },
    async close() {
      if (timer) clearInterval(timer);
      if (reloadTimer) clearInterval(reloadTimer);
      await app.close();
      await db.close();
    },
  };
}

/** Entry point used by every service's src/main.ts. */
export async function runService(def: ServiceDefinition): Promise<Service> {
  const svc = createService(def);
  await svc.start();
  const stop = async () => { await svc.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return svc;
}
