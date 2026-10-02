import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from 'playwright-core';

const WEB_DIR = fileURLToPath(new URL('../../apps/web', import.meta.url));
const NEXT_BIN = fileURLToPath(new URL('../../apps/web/node_modules/next/dist/bin/next', import.meta.url));

export const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

/** Start the built web app in its own process group so stopWeb() also ends next's workers. */
export async function startWeb(gatewayUrl: string, port: number): Promise<ChildProcess> {
  const proc = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port)], { cwd: WEB_DIR, env: { ...process.env, GATEWAY_URL: gatewayUrl, NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/login`)).ok) return proc; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  stopWeb(proc);
  throw new Error('web app did not start (run `pnpm --filter @erp/web build` first)');
}

export function stopWeb(proc?: ChildProcess) {
  if (proc?.pid) try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* already gone */ }
}

export async function login(page: Page, base: string, tenant: string, email = 'admin@example.com', password = 'password123') {
  await page.goto(`${base}/login`);
  await page.getByLabel('รหัสบริษัท').fill(tenant);
  await page.getByLabel('อีเมล').fill(email);
  await page.getByLabel('รหัสผ่าน').fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click();
  await page.getByRole('heading', { name: 'เริ่มทำงาน' }).waitFor();
}

export async function logout(page: Page, base: string) {
  await page.goto(`${base}/login`);
  await page.evaluate(() => { try { localStorage.removeItem('erp.session'); } catch { /* ignore */ } });
}

/** Type into a lookup and pick the first option containing `text`. */
export async function pick(page: Page, scope: Page | Locator, name: string, text: string) {
  const box = scope.getByRole('combobox', { name }).first();
  await box.click();
  await box.fill(text);
  await page.getByRole('option', { name: new RegExp(text) }).first().click();
}
