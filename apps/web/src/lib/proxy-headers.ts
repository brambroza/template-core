/**
 * A response that replaces the caller's login token (identity `POST /me/password` revokes every older token and returns a new one):
 * the web app stores it in place of the old one (lib/api.ts). Security review 0.3, SEC-07.
 */
export const SESSION_TOKEN_HEADER = 'x-erp-session-token';

/**
 * Response headers passed through from the gateway. Attachments rely on content-disposition (download vs. inline), nosniff and a
 * sandboxing CSP — dropping them here served uploaded files on the app's own origin without them (security review 0.3, SEC-04).
 */
export const PASSED_RESPONSE_HEADERS = ['content-type', 'content-disposition', 'cache-control', 'x-content-type-options', 'content-security-policy', SESSION_TOKEN_HEADER] as const;

export function responseHeaders(from: Headers): Headers {
  const out = new Headers();
  for (const h of PASSED_RESPONSE_HEADERS) {
    const v = from.get(h);
    if (v) out.set(h, v);
  }
  if (!out.has('content-type')) out.set('content-type', 'application/json');
  out.set('x-content-type-options', 'nosniff');
  return out;
}
