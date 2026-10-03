/**
 * Showcase mode, browser side. The flag is baked in at build time (next.config.ts sets NEXT_PUBLIC_SHOWCASE from SHOWCASE=1),
 * so a normal build carries no showcase code paths at run time. Server side: lib/showcase-server.ts.
 */
export const SHOWCASE = process.env.NEXT_PUBLIC_SHOWCASE === '1';

/**
 * The dashboard ("ภาพรวมวันนี้"). In showcase `/` is the public landing page (a rewrite in next.config.ts),
 * so the app's home lives at `/app`; a normal installation keeps it at `/`.
 */
export const HOME = SHOWCASE ? '/app' : '/';

/** "ขอเดโมเต็ม": the contact section of the landing page served at `/` in showcase. Plain <a>, not a Next <Link> (it is a static page). */
export const SHOWCASE_CONTACT = '/#contact';

/** Error code of a write refused by the showcase (any POST/PUT/PATCH/DELETE). */
export const SHOWCASE_READ_ONLY = 'showcase_read_only';
