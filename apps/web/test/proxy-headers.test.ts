import { describe, expect, it } from 'vitest';
import { responseHeaders } from '../src/lib/proxy-headers.ts';

describe('web /api proxy (security review 0.3, SEC-04)', () => {
  it('passes the attachment safety headers through and always adds nosniff', () => {
    const h = responseHeaders(new Headers({
      'content-type': 'text/plain',
      'content-disposition': 'attachment; filename="a.txt"',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=300',
      'set-cookie': 'x=1',
      server: 'fastify',
    }));
    expect(h.get('content-disposition')).toBe('attachment; filename="a.txt"');
    expect(h.get('content-security-policy')).toContain('sandbox');
    expect(h.get('cache-control')).toBe('private, max-age=300');
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('set-cookie')).toBeNull();
    expect(h.get('server')).toBeNull();
  });

  it('defaults to JSON', () => {
    expect(responseHeaders(new Headers()).get('content-type')).toBe('application/json');
  });
});
