/**
 * pnpm demo — run every module in this repo + gateway + web app with demo data.
 * Env: DATABASE_ADMIN_URL (default postgres://postgres:postgres@127.0.0.1:5432/postgres), DEMO_RESET=1, WEB=0 to skip the web app.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceDefinition } from '@erp/kernel';
import { REPO_ROOT } from './catalog.ts';
import { seedDemo, startStack } from './demo.ts';

const dir = join(REPO_ROOT, 'services');
const ids = readdirSync(dir).filter((d) => existsSync(join(dir, d, 'src', 'service.ts')));
const order = ['identity', 'master-data'];
ids.sort((a, b) => (order.includes(a) ? order.indexOf(a) : 9) - (order.includes(b) ? order.indexOf(b) : 9));
const defs: ServiceDefinition[] = [];
for (const id of ids) defs.push((await import(join(dir, id, 'src', 'service.ts'))).definition);

console.log(`Starting ${ids.join(', ')}…`);
const stack = await startStack(defs, { reset: process.env.DEMO_RESET === '1' });
const t0 = Date.now();
const seed = await seedDemo(stack);
console.log(seed.created ? `Demo data created in ${((Date.now() - t0) / 1000).toFixed(1)}s.` : 'Demo data already present (DEMO_RESET=1 to start over).');

let web: ReturnType<typeof spawn> | undefined;
if (process.env.WEB !== '0') {
  const webDir = join(REPO_ROOT, 'apps', 'web');
  const built = existsSync(join(webDir, '.next', 'BUILD_ID'));
  web = spawn('pnpm', ['exec', 'next', built ? 'start' : 'dev', '-p', process.env.WEB_PORT ?? '3000'], {
    cwd: webDir, stdio: 'inherit', env: { ...process.env, GATEWAY_URL: 'http://127.0.0.1:8080' },
  });
}
console.log(`
  ERP demo is running
  web      http://localhost:${process.env.WEB_PORT ?? '3000'}
  api      ${stack.gatewayUrl}
  login    company "${seed.tenant}", ${seed.email} / ${seed.password}
           (also store@ / buyer@ / sales@ / tech@ / plan@ / hr@ / acc@ / it@ / qc@demo.co.th, password demo1234)
`);
const stop = async () => { web?.kill(); await stack.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
