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

/**
 * Public showcase (SHOWCASE=1 at build time, see docs/deploy-vercel.md): /api answers from showcase/snapshot.json, the landing page
 * (site/dist, copied to public/landing by `pnpm showcase:build`) is served at `/` and the dashboard moves to `/app`.
 * Default off — a normal installation builds exactly as before.
 */
const SHOWCASE = process.env.SHOWCASE === '1';

const config: NextConfig = {
  poweredByHeader: false,
  // `pnpm showcase:build` on a developer machine builds into .next-showcase so the normal build (and a running demo) stays intact
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // baked into the browser bundle (banner, persona login) and the server (lib/showcase-server.ts)
  env: { NEXT_PUBLIC_SHOWCASE: SHOWCASE ? '1' : '' },
  ...(SHOWCASE ? {
    async rewrites() {
      return {
        beforeFiles: [
          { source: '/', destination: '/landing/index.html' },
          { source: '/assets/:file*', destination: '/landing/assets/:file*' },
          { source: '/vendor/:file*', destination: '/landing/vendor/:file*' },
        ],
        afterFiles: [],
        fallback: [],
      };
    },
    // the recorded answers travel with the /api function on Vercel (read with fs at run time)
    outputFileTracingIncludes: { '/api/**': ['./showcase/**/*.json'] },
  } : {}),
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
