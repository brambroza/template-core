/**
 * Error reporting to Sentry (or any Sentry-compatible service such as GlitchTip) without the Sentry SDK: one HTTP POST of an
 * envelope per unexpected error. Off unless SENTRY_DSN is set.
 *
 * What is sent — on purpose very little (PDPA): error type, message and stack, module id and version, HTTP method and the
 * route pattern (no query string, no body, no headers), and the company / user *ids* of the request. Never e-mails, names,
 * tokens or request data.
 *
 * Environment: SENTRY_DSN, SENTRY_ENVIRONMENT (default "production"), SENTRY_RELEASE (default "<module>@<version>").
 */
import { randomUUID } from 'node:crypto';

/** A parsed DSN: where to POST and the public key that authorises it. */
export interface SentryTarget {
  url: string;
  publicKey: string;
  dsn: string;
}

/** Context attached to one report. Only ids and route patterns — see the file header. */
export interface ErrorContext {
  method?: string;
  route?: string;
  tenantId?: string;
  userId?: string;
  /** "request" (a 5xx answer), "event" (an event handler / outbox), "process" (unhandled rejection or exception) */
  kind?: string;
}

export interface ErrorReporter {
  /** Report one error; never throws and never waits for Sentry (the returned promise is for tests). */
  report(err: unknown, ctx?: ErrorContext): Promise<void>;
  readonly enabled: boolean;
}

/** `https://<key>@<host>/<project>` → envelope endpoint; null for an empty or malformed DSN. */
export function parseDsn(dsn: string | undefined): SentryTarget | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+|\/+$/g, '').split('/').pop();
    if (!u.username || !project || !/^https?:$/.test(u.protocol)) return null;
    const prefix = u.pathname.replace(/\/+$/, '').slice(0, -project.length).replace(/\/+$/, '');
    return { url: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/`, publicKey: decodeURIComponent(u.username), dsn };
  } catch {
    return null;
  }
}

interface Frame { function?: string; filename?: string; lineno?: number; colno?: number; in_app?: boolean }

/** V8 stack lines → Sentry frames, oldest call first (Sentry's order). */
export function stackFrames(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split('\n').slice(1)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    const filename = m[2]!.replace(/^file:\/\//, '');
    frames.push({ function: m[1] ?? '<anonymous>', filename, lineno: Number(m[3]), colno: Number(m[4]), in_app: !filename.includes('node_modules') && !filename.startsWith('node:') });
  }
  return frames.reverse().slice(-50);
}

/** The Sentry event for one error (exported for tests). */
export function sentryEvent(err: unknown, ctx: ErrorContext, meta: { module: string; release: string; environment: string }): Record<string, unknown> {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown');
  const pgCode = (err as { code?: unknown })?.code;
  return {
    event_id: randomUUID().replace(/-/g, ''),
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    logger: meta.module,
    release: meta.release,
    environment: meta.environment,
    tags: {
      module: meta.module,
      kind: ctx.kind ?? 'request',
      ...(ctx.tenantId ? { tenant_id: ctx.tenantId } : {}),
      ...(typeof pgCode === 'string' ? { error_code: pgCode } : {}),
    },
    ...(ctx.userId ? { user: { id: ctx.userId } } : {}),
    ...(ctx.method || ctx.route ? { request: { method: ctx.method, url: ctx.route }, transaction: `${ctx.method ?? ''} ${ctx.route ?? ''}`.trim() } : {}),
    exception: { values: [{ type: e.name || 'Error', value: (e.message || '').slice(0, 2000), stacktrace: { frames: stackFrames(e.stack) } }] },
  };
}

/**
 * Reporter for one module. At most `perMinute` reports a minute (an outage must not turn into thousands of requests),
 * each POST gives up after 3 s, and a failing Sentry only produces one warning in the log.
 */
export function createErrorReporter(
  module: string,
  version: string,
  env: NodeJS.ProcessEnv,
  opts: { perMinute?: number; fetch?: typeof fetch; warn?: (msg: string) => void } = {},
): ErrorReporter {
  const target = parseDsn(env.SENTRY_DSN);
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  if (env.SENTRY_DSN && !target) warn(`[${module}] SENTRY_DSN is not a valid DSN — error reporting is off`);
  const meta = { module, release: env.SENTRY_RELEASE || `${module}@${version}`, environment: env.SENTRY_ENVIRONMENT || 'production' };
  const perMinute = opts.perMinute ?? 30;
  const send = opts.fetch ?? fetch;
  let windowStart = 0;
  let sentInWindow = 0;
  let warned = false;
  return {
    enabled: !!target,
    async report(err, ctx = {}) {
      if (!target) return;
      const now = Date.now();
      if (now - windowStart > 60_000) { windowStart = now; sentInWindow = 0; }
      if (++sentInWindow > perMinute) return;
      try {
        const event = sentryEvent(err, ctx, meta);
        const body = `${JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString(), dsn: target.dsn })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
        const res = await send(target.url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-sentry-envelope', 'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=erp-kernel/1.0` },
          body,
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        if (!warned) { warned = true; warn(`[${module}] could not report an error to Sentry: ${(e as Error).message}`); }
      }
    },
  };
}
