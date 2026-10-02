/**
 * Gateway — the single front door of a customer's installation.
 *
 *  - /api/<module>/*      proxied to that module (only modules the customer installed exist)
 *  - /api/_catalog         installed modules + manifests (the web/mobile apps build menus from this)
 *  - /_events/publish      event router: fans each event out to installed modules that subscribe to it
 *
 * The gateway holds no business logic and no database. It discovers wiring from each module's /_manifest.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { toErrorBody, unauthorized, type ModuleManifest } from '@erp/kernel';

/** module response headers passed through to the client */
export const FORWARDED_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'cache-control', 'x-content-type-options', 'content-security-policy'] as const;

export interface GatewayOptions {
  /** module id -> base URL, e.g. { sales: 'http://sales:3000' } */
  modules: Record<string, string>;
  internalToken: string;
  logger?: boolean;
}

export function parseModules(spec: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of spec.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [id, url] = part.split('=');
    if (!id || !url) throw new Error(`MODULES entry "${part}" must look like id=http://host:port`);
    out[id] = url.replace(/\/$/, '');
  }
  return out;
}

/** Every `requires` of every installed module must itself be installed. */
export function checkDependencies(manifests: ModuleManifest[]): string[] {
  const ids = new Set(manifests.map((m) => m.id));
  return manifests.flatMap((m) => m.requires.filter((r) => !ids.has(r)).map((r) => `${m.id} requires ${r}, which is not installed`));
}

export interface Gateway {
  app: FastifyInstance;
  manifests: () => ModuleManifest[];
  /** (re)load manifests from all modules; throws if a module is unreachable or a dependency is missing */
  discover(opts?: { retries?: number; delayMs?: number }): Promise<ModuleManifest[]>;
}

export function createGateway(opts: GatewayOptions): Gateway {
  // 8 MB: a 5 MB attachment travels as base64 JSON (~6.7 MB); modules enforce their own, smaller limits
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 8 * 1024 * 1024 });
  let manifests: ModuleManifest[] = [];

  async function fetchManifest(id: string, url: string, retries: number, delayMs: number): Promise<ModuleManifest> {
    for (let i = 0; ; i++) {
      try {
        const res = await fetch(`${url}/_manifest`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const m = (await res.json()) as ModuleManifest;
        if (m.id !== id) throw new Error(`${url} reports module "${m.id}", expected "${id}"`);
        return m;
      } catch (e) {
        if (i >= retries) throw new Error(`Cannot load manifest of ${id} at ${url}: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  async function discover({ retries = 0, delayMs = 1000 } = {}) {
    const loaded = await Promise.all(Object.entries(opts.modules).map(([id, url]) => fetchManifest(id, url, retries, delayMs)));
    const problems = checkDependencies(loaded);
    if (problems.length) throw new Error(`Invalid installation:\n - ${problems.join('\n - ')}`);
    manifests = loaded;
    return manifests;
  }

  app.setErrorHandler((err, _req, reply) => {
    const { status, body } = toErrorBody(err);
    reply.code(status).send(body);
  });

  app.get('/_health', async () => ({ status: 'ok', modules: manifests.map((m) => m.id) }));

  app.get('/api/_catalog', async () => ({
    modules: manifests.map((m) => ({ id: m.id, name: m.name, nameTh: m.nameTh, version: m.version, tier: m.tier, description: m.description, permissions: m.permissions, enhancedBy: m.enhancedBy.filter((e) => opts.modules[e]) })),
  }));

  app.post('/_events/publish', async (req, reply) => {
    if (req.headers['x-internal-token'] !== opts.internalToken) throw unauthorized('Internal endpoint');
    const event = req.body as { type?: string; source?: string };
    const targets = manifests.filter((m) => event.type && m.subscribes.includes(event.type as never) && m.id !== event.source);
    const results = await Promise.all(targets.map(async (m) => {
      try {
        const res = await fetch(`${opts.modules[m.id]}/_events`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-token': opts.internalToken }, body: JSON.stringify(event),
        });
        const body = await res.json().catch(() => ({}));
        return { module: m.id, ok: res.ok, status: res.ok ? (body as { status?: string }).status : `HTTP ${res.status}`, error: res.ok ? undefined : body };
      } catch (e) {
        return { module: m.id, ok: false, status: 'unreachable', error: (e as Error).message };
      }
    }));
    // any failure -> 502 so the publisher's outbox retries; receivers de-duplicate by event id
    if (results.some((r) => !r.ok)) reply.code(502);
    return { delivered: results };
  });

  // LINE webhook: LINE signs the exact bytes (x-line-signature) and the proxy below re-serialises JSON, so this one
  // public path is forwarded byte for byte with its signature; automation verifies it.
  app.register(async (raw) => {
    raw.removeAllContentTypeParsers();
    raw.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 1024 * 1024 }, (_req, body, done) => done(null, body));
    raw.post('/api/automation/line/webhook/:key', async (req, reply) => {
      const base = opts.modules.automation;
      if (!base) {
        reply.code(404);
        return { error: { code: 'module_not_installed', message: 'Module "automation" is not installed in this ERP' } };
      }
      const headers: Record<string, string> = {};
      for (const h of ['content-type', 'x-line-signature']) {
        const v = req.headers[h];
        if (typeof v === 'string') headers[h] = v;
      }
      const { key } = req.params as { key: string };
      const res = await fetch(`${base}/line/webhook/${encodeURIComponent(key)}`, { method: 'POST', headers, body: Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : undefined });
      reply.code(res.status).header('content-type', res.headers.get('content-type') ?? 'application/json');
      return reply.send(Buffer.from(await res.arrayBuffer()));
    });
  });

  app.all('/api/:module/*', async (req, reply) => {
    const { module } = req.params as { module: string; '*': string };
    const base = opts.modules[module];
    if (!base) {
      reply.code(404);
      return { error: { code: 'module_not_installed', message: `Module "${module}" is not installed in this ERP` } };
    }
    const rest = (req.params as Record<string, string>)['*'];
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const headers: Record<string, string> = {};
    for (const h of ['authorization', 'content-type', 'accept', 'accept-language']) {
      const v = req.headers[h];
      if (typeof v === 'string') headers[h] = v;
    }
    // which modules this installation has (e.g. identity builds roles from templates with only installed perms)
    headers['x-erp-modules'] = Object.keys(opts.modules).join(',');
    // the public address the client used (e.g. automation shows the LINE webhook URL built from it)
    headers['x-forwarded-host'] = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '');
    headers['x-forwarded-proto'] = String(req.headers['x-forwarded-proto'] ?? req.protocol);
    const hasBody = !['GET', 'HEAD'].includes(req.method) && req.body !== undefined;
    const res = await fetch(`${base}/${rest}${qs}`, { method: req.method, headers, body: hasBody ? JSON.stringify(req.body) : undefined });
    reply.code(res.status);
    // binary responses (attachments) need their file name and safety headers, not only the type
    for (const h of FORWARDED_RESPONSE_HEADERS) {
      const v = res.headers.get(h);
      if (v) reply.header(h, v);
    }
    return reply.send(Buffer.from(await res.arrayBuffer()));
  });

  return { app, manifests: () => manifests, discover };
}
