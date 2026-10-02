import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import type { EventData, EventType } from '@erp/contracts';
import { verifyToken, type AuthContext } from './auth.ts';
import { createDb, migrate, type Client, type Db } from './db.ts';
import { toErrorBody, unauthorized } from './errors.ts';
import { dispatchOutbox, emit, receiveEvent, type EventHandlers } from './events.ts';
import { checkLicense } from './license.ts';
import type { ModuleManifest } from './manifest.ts';

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
  /** publish an event inside the current transaction */
  emit<T extends EventType>(c: Client, type: T, data: EventData<T>): Promise<string>;
}

export interface ServiceDefinition {
  manifest: ModuleManifest;
  migrationsDir: string;
  routes: (app: FastifyInstance, k: Kernel) => void | Promise<void>;
  handlers?: EventHandlers;
}

export interface Service {
  app: FastifyInstance;
  db: Db;
  kernel: Kernel;
  manifest: ModuleManifest;
  migrate(): Promise<string[]>;
  dispatch(): Promise<{ sent: number; failed: number }>;
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
  const { manifest } = def;
  const handlers = def.handlers ?? {};
  const handled = Object.keys(handlers).sort().join(',');
  const declared = [...manifest.subscribes].sort().join(',');
  if (handled !== declared) throw new Error(`${manifest.id}: module.json "subscribes" [${declared}] must match handlers [${handled}]`);

  const jwtSecret = required(env, 'JWT_SECRET');
  const internalToken = required(env, 'INTERNAL_TOKEN');
  const db = createDb(required(env, 'DATABASE_URL'));
  const kernel: Kernel = { db, manifest, env, emit: (c, type, data) => emit(c, manifest.id, type, data) };

  const app = Fastify({ logger: env.LOG_LEVEL ? { level: env.LOG_LEVEL } : false, bodyLimit: 5 * 1024 * 1024 });
  app.decorateRequest('authCtx', null);

  app.addHook('onRequest', async (req) => {
    const cfg = req.routeOptions.config ?? {};
    if (cfg.public) return;
    if (cfg.internal) {
      if (req.headers['x-internal-token'] !== internalToken) throw unauthorized('Internal endpoint');
      return;
    }
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) throw unauthorized();
    req.authCtx = verifyToken(jwtSecret, h.slice(7));
  });

  app.setErrorHandler((err, req, reply) => {
    const { status, body } = toErrorBody(err);
    if (status >= 500) req.log.error(err);
    reply.code(status).send(body);
  });

  app.get('/_health', { config: { public: true } }, async () => ({ status: 'ok', module: manifest.id, version: manifest.version }));
  app.get('/_manifest', { config: { public: true } }, async () => manifest);
  app.post('/_events', { config: { internal: true } }, async (req) => ({ status: await receiveEvent(db, manifest.id, handlers, req.body, env) }));

  const ready = Promise.resolve(def.routes(app, kernel));

  let timer: NodeJS.Timeout | undefined;
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
    async start(opts = {}) {
      const lic = checkLicense(manifest.id, manifest.tier, env);
      if (!lic.ok) throw new Error(`[${manifest.id}] license check failed: ${lic.reason}`);
      await ready;
      await migrate(db, def.migrationsDir);
      const address = await app.listen({ port: opts.port ?? Number(env.PORT ?? 3000), host: opts.host ?? env.HOST ?? '0.0.0.0' });
      if (env.EVENT_ROUTER_URL) {
        timer = setInterval(async () => {
          if (dispatching) return;
          dispatching = true;
          try { await dispatch(); } catch (e) { app.log.error(e); } finally { dispatching = false; }
        }, Number(env.EVENT_DISPATCH_MS ?? 1000));
      }
      app.log.info(`${manifest.id} ${lic.mode} listening on ${address}`);
      return address;
    },
    async close() {
      if (timer) clearInterval(timer);
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
