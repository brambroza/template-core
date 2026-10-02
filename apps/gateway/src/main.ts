import { secretProblems } from '@erp/kernel';
import { createGateway, parseModules } from './gateway.ts';

const env = process.env;
if (!env.MODULES || !env.INTERNAL_TOKEN) throw new Error('MODULES and INTERNAL_TOKEN are required');
const weak = secretProblems(env, ['INTERNAL_TOKEN']);
if (weak.length) throw new Error(`[gateway] refusing to start: ${weak.join('; ')}`);
const gw = createGateway({ modules: parseModules(env.MODULES), internalToken: env.INTERNAL_TOKEN, logger: true });
await gw.discover({ retries: Number(env.DISCOVERY_RETRIES ?? 30), delayMs: 2000 });
await gw.app.listen({ port: Number(env.PORT ?? 8080), host: env.HOST ?? '0.0.0.0' });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await gw.app.close(); process.exit(0); });
