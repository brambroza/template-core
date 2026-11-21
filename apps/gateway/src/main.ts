import { createErrorReporter, secretProblems } from '@erp/kernel';
import { createGateway, parseModules } from './gateway.ts';

const env = process.env;
if (!env.MODULES || !env.INTERNAL_TOKEN) throw new Error('MODULES and INTERNAL_TOKEN are required');
const weak = secretProblems(env, ['INTERNAL_TOKEN']);
if (weak.length) throw new Error(`[gateway] refusing to start: ${weak.join('; ')}`);
// TRUST_PROXY: addresses of the proxy in front of the gateway, e.g. "10.0.0.0/8" or "loopback" (comma-separated); unset = none
const trustProxy = env.TRUST_PROXY || undefined;
const errors = createErrorReporter('gateway', env.npm_package_version ?? '0.0.0', env);
const gw = createGateway({ modules: parseModules(env.MODULES), internalToken: env.INTERNAL_TOKEN, logger: true, trustProxy, errors });
process.on('unhandledRejection', (e) => { gw.app.log.error(e); void errors.report(e, { kind: 'process' }); });
await gw.discover({ retries: Number(env.DISCOVERY_RETRIES ?? 30), delayMs: 2000 });
await gw.app.listen({ port: Number(env.PORT ?? 8080), host: env.HOST ?? '0.0.0.0' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await gw.app.close(); process.exit(0); });
