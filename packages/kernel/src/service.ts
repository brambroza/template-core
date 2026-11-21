import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { EventData, EventType } from '@erp/contracts';
import { attachmentPerms, mountAttachments, type AttachmentsSpec } from './attachments.ts';
import { mountAudit, recordAudit } from './audit.ts';
import { inPlan, notInPlan, safeEqual, secretProblems, verifyToken, type AuthContext } from './auth.ts';
import { createDb, migrate, type Client, type Db } from './db.ts';
import { badRequest, toErrorBody, unauthorized } from './errors.ts';
import { dispatchOutbox, emit, receiveEvent, type EventHandlers, type HandlerContext } from './events.ts';
import { dryRunStore, type DryRunStore, type ImpactContext, type ImpactDescribers, type ImpactLine } from './impact.ts';
import { isKnownEvent, parseEvent } from '@erp/contracts';
import { randomUUID } from 'node:crypto';
import { checkLicense } from './license.ts';
import type { ModuleManifest } from './manifest.ts';
import { applyRevocation, DEFAULT_REVOCATION_RELOAD_MS, isKernelSubscription, RevocationList } from './revocation.ts';
import { createErrorReporter, type ErrorReporter } from './sentry.ts';
import { wipeTenantData } from './wipe.ts';

declare module 'fastify' {
  interface FastifyRequest {
    authCtx: AuthContext | null;
  }
  interface FastifyContextConfig {
    /** no login required */
    public?: boolean;
    /** service-to-service only (x-internal-token) */
    internal?: boolean;
    /** `?_dryRun=1` runs the route and rolls everything back, answering the events it would publish (see impact.ts) */
    dryRun?: boolean;
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
  /** unexpected errors to Sentry when SENTRY_DSN is set (see sentry.ts); 5xx answers are reported automatically */
  errors: ErrorReporter;
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
  /** what this module would do with an event it subscribes to, in Thai, for the "ผลกระทบ" preview (see impact.ts) */
  impact?: ImpactDescribers;
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

/** requests answered as a dry run (no audit row) */
const dryRunNoAudit = new WeakSet<object>();

export function createService(def: ServiceDefinition, env: NodeJS.ProcessEnv = process.env): Service {
  const own = new Set(def.manifest.permissions.map((p) => p.key));
  const manifest: ModuleManifest = { ...def.manifest, permissions: [...def.manifest.permissions, ...kernelPermissions(def.manifest.id).filter((p) => !own.has(p.key))] };
  const prefix = permPrefix(manifest.id);
  if (def.attachments) {
    const missing = attachmentPerms(def.attachments, `${prefix}.attachment.delete`).filter((p) => !own.has(p));
    if (missing.length) throw new Error(`${manifest.id}: attachments use permissions not declared in module.json: ${missing.join(', ')}`);
  }
  const ownHandlers = def.handlers ?? {};
  // kernel subscriptions (identity.tokens_revoked) are handled by the kernel itself and need not be listed in module.json
  const handled = Object.keys(ownHandlers).filter((x) => !isKernelSubscription(x)).sort().join(',');
  const declared = manifest.subscribes.filter((x) => !isKernelSubscription(x)).sort().join(',');
  if (handled !== declared) throw new Error(`${manifest.id}: module.json "subscribes" [${declared}] must match handlers [${handled}]`);
  const revocations = new RevocationList();
  const handlers: EventHandlers = {
    ...ownHandlers,
    // built-in: store the cutoff, then run the module's own handler if it has one
    'identity.tokens_revoked': async (data, ctx) => {
      await applyRevocation(ctx.client, revocations, data);
      await ownHandlers['identity.tokens_revoked']?.(data, ctx);
    },
    // built-in: "ล้างข้อมูลตัวอย่าง" — every row of the company in this module's database (wipe.ts), then the module's own handler
    'identity.tenant_data_cleared': async (data, ctx) => {
      const deleted = await wipeTenantData(ctx.client, ctx.tenantId);
      const total = Object.values(deleted).reduce((a, b) => a + b, 0);
      app.log.info(`[${manifest.id}] tenant ${ctx.tenantId} data cleared (${data.reason}, by ${data.by}): ${total} rows`);
      await ownHandlers['identity.tenant_data_cleared']?.(data, ctx);
    },
  };

  const jwtSecret = required(env, 'JWT_SECRET');
  const internalToken = required(env, 'INTERNAL_TOKEN');
  const db = createDb(required(env, 'DATABASE_URL'));
  const errors = createErrorReporter(manifest.id, manifest.version, env);
  const kernel: Kernel = {
    db, manifest, env, revocations, errors,
    async emit(c, type, data) {
      const id = await emit(c, manifest.id, type, data);
      dryRunStore.getStore()?.events.push({ type, data });
      if (type === 'identity.tokens_revoked') await applyRevocation(c, revocations, data as EventData<'identity.tokens_revoked'>);
      return id;
    },
  };

  const app = Fastify({ logger: env.LOG_LEVEL ? { level: env.LOG_LEVEL } : false, bodyLimit: 5 * 1024 * 1024 });
  app.decorateRequest('authCtx', null);
  app.decorateRequest('auditEntityId', null);

  // impact preview: routes with config.dryRun answer `?_dryRun=1` with what they would do, keeping nothing (impact.ts)
  app.addHook('onRoute', (route) => {
    if (!route.config?.dryRun) return;
    const original = route.handler;
    route.handler = async function dryRunnable(this: unknown, req, reply) {
      if ((req.query as Record<string, unknown> | undefined)?._dryRun !== '1') return original.call(this as never, req, reply);
      const store: DryRunStore = { events: [] };
      dryRunNoAudit.add(req);
      const result = await dryRunStore.run(store, () => original.call(this as never, req, reply));
      return { dryRun: true, result, events: store.events };
    };
  });

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
    // cloud plans: a company whose plan lacks this feature module gets a Thai 403 (the impact preview just skips the module)
    if (!inPlan(req.authCtx, manifest.id, manifest.tier)) throw notInPlan(manifest.nameTh);
  });

  const reloadRevocations = () => revocations.load(db);
  // boot: load every cutoff before the first request is served (start() migrates before listen → ready)
  app.addHook('onReady', async () => {
    try { await reloadRevocations(); } catch (e) { app.log.warn(`[${manifest.id}] token revocations not loaded: ${(e as Error).message}`); }
  });

  // audit log: every successful write by a signed-in user (runs before the response leaves, so readers see it at once)
  app.addHook('onSend', async (req, reply, payload) => {
    if (dryRunNoAudit.has(req)) return payload; // nothing happened: nothing to audit
    if (req.authCtx && req.method !== 'GET' && req.method !== 'HEAD' && reply.statusCode < 400) await recordAudit(db, req, reply.statusCode, payload);
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    const { status, body } = toErrorBody(err);
    if (status >= 500) {
      req.log.error(err);
      // 503 "database busy" is an outage UptimeRobot sees; only real bugs (500) go to Sentry
      if (status === 500) void errors.report(err, { kind: 'request', method: req.method, route: req.routeOptions.url, tenantId: req.authCtx?.tenantId, userId: req.authCtx?.userId });
    }
    reply.code(status).send(body);
  });

  // uptime monitors: 200 only when this module can reach its database (2 s), else 503 — nothing about the data is revealed
  app.get('/_health', { config: { public: true } }, async (_req, reply) => {
    const dbState = await Promise.race([
      db.pool.query('select 1').then(() => 'ok' as const, () => 'down' as const),
      new Promise<'down'>((r) => setTimeout(() => r('down'), 2000).unref()),
    ]);
    if (dbState !== 'ok') reply.code(503);
    return { status: dbState === 'ok' ? 'ok' : 'down', module: manifest.id, version: manifest.version, db: dbState };
  });
  app.get('/_manifest', { config: { public: true } }, async () => manifest);
  app.post('/_events', { config: { internal: true } }, async (req) => ({ status: await receiveEvent(db, manifest.id, handlers, req.body, env) }));

  /** What this module would do with one event (impact preview). Always rolled back; empty when the module has no describer for it. */
  app.post('/_impact', async (req) => {
    const a = req.authCtx!;
    dryRunNoAudit.add(req); // a question, not a write
    const body = (req.body ?? {}) as { type?: unknown; data?: unknown };
    const type = String(body.type ?? '');
    if (!isKnownEvent(type)) throw badRequest(`Unknown event type "${type}"`);
    const describe = def.impact?.[type] as ((data: unknown, ctx: ImpactContext) => Promise<ImpactLine[]>) | undefined;
    if (!describe || !manifest.subscribes.includes(type as never)) return { module: manifest.id, lines: [] };
    const data = parseEvent(type, body.data);
    const store: DryRunStore = { events: [] };
    const lines = await dryRunStore.run(store, () => db.tx(a.tenantId, (c) => describe(data, {
      client: c, tenantId: a.tenantId, auth: a,
      run: async () => {
        const handler = handlers[type] as ((d: unknown, ctx: HandlerContext) => Promise<void>) | undefined;
        if (!handler) return;
        const event = { id: randomUUID(), type, tenantId: a.tenantId, source: 'impact-preview', occurredAt: new Date().toISOString(), data };
        await handler(data, { client: c, tenantId: a.tenantId, event, env, emit: (t, d) => kernel.emit(c, t, d) });
      },
    })));
    return { module: manifest.id, lines: lines.slice(0, 50) };
  });

  mountAudit(app, { db, permPrefix: prefix });
  if (def.attachments) mountAttachments(app, { db, moduleId: manifest.id, permPrefix: prefix, jwtSecret, spec: def.attachments, revokedBefore: revocations.before });

  const ready = Promise.resolve(def.routes(app, kernel));

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
    migrate: () => migrate(db, def.migrationsDir),
    dispatch,
    reloadRevocations,
    async start(opts = {}) {
      const weak = secretProblems(env);
      if (weak.length) throw new Error(`[${manifest.id}] refusing to start: ${weak.join('; ')}`);
      const lic = checkLicense(manifest.id, manifest.tier, env);
      if (!lic.ok) throw new Error(`[${manifest.id}] license check failed: ${lic.reason}`);
      await ready;
      await migrate(db, def.migrationsDir);
      const address = await app.listen({ port: opts.port ?? Number(env.PORT ?? 3000), host: opts.host ?? env.HOST ?? '0.0.0.0' });
      if (env.EVENT_ROUTER_URL) {
        timer = setInterval(async () => {
          if (dispatching) return;
          dispatching = true;
          try { await dispatch(); } catch (e) { app.log.error(e); void errors.report(e, { kind: 'event', route: 'outbox dispatch' }); } finally { dispatching = false; }
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
  // a crash is reported before the process dies (the container restarts it); a stray rejection is reported and logged
  process.on('unhandledRejection', (e) => { svc.app.log.error(e); void svc.kernel.errors.report(e, { kind: 'process' }); });
  process.on('uncaughtException', (e) => {
    svc.app.log.fatal(e);
    void svc.kernel.errors.report(e, { kind: 'process' }).finally(() => process.exit(1));
    setTimeout(() => process.exit(1), 3500).unref();
  });
  await svc.start();
  const stop = async () => { await svc.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return svc;
}
