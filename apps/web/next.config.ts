import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const root = fileURLToPath(new URL('../..', import.meta.url));
// written by `pnpm erp ui-sync` (and by `pnpm erp pack` for a customer's selection)
const modulePackages: string[] = JSON.parse(readFileSync(new URL('./src/modules.json', import.meta.url), 'utf8')).packages;

/**
 * Security headers for every page (security review 0.3, SEC-05): no framing (clickjacking), no MIME sniffing, no referrer leak of
 * record ids, no plugins. A script CSP is left out on purpose — Next's inline bootstrap scripts would need nonces.
 */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
];

const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    // /api/* answers come from the gateway with their own headers (attachments carry a sandboxing CSP that must not be replaced)
    return [{ source: '/:path((?!api/).*)', headers: SECURITY_HEADERS }];
  },
  // module screen definitions live in services/<id>/src/ui.ts (shipped with each module)
  transpilePackages: ['@erp/ui-schema', ...modulePackages],
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default config;
