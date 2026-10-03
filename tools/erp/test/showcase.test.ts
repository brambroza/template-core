import { describe, expect, it } from 'vitest';
import { assertNoSecrets, sanitize } from '../src/showcase-capture.ts';

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz012345';

describe('showcase capture', () => {
  it('masks secret fields and JWT-looking text, keeps everything else', () => {
    const out = sanitize({
      name: 'แจ้งเตือน LINE', line_token: 'abc123', apiKey: 'sk-x', webhookSecret: 's', password: 'p', empty_token: '',
      password_source: 'env', expiresIn: 43200, note: `token ${JWT} end`, rows: [{ access_token: 'z', qty: 2 }],
    }) as Record<string, any>;
    expect(out).toMatchObject({ name: 'แจ้งเตือน LINE', line_token: '••••••', apiKey: '••••••', webhookSecret: '••••••', password: '••••••', empty_token: '', password_source: 'env', expiresIn: 43200 });
    expect(out.note).toBe('token •••••• end');
    expect(out.rows[0]).toEqual({ access_token: '••••••', qty: 2 });
  });

  it('hides the demo host and secret hex path segments in links', () => {
    expect(sanitize({ webhook_url: 'http://127.0.0.1:8080/api/automation/line/webhook/47d2241d31994a3db1a4bcbd79d02d1502d16d2036c74b8892be28eee677dc0d' }))
      .toEqual({ webhook_url: 'https://erp.example.co.th/api/automation/line/webhook/••••••' });
    expect(sanitize('ดู /m/sales/soDetail/0c8011a1-04fc-4a40-9e80-c17afbb2851e')).toBe('ดู /m/sales/soDetail/0c8011a1-04fc-4a40-9e80-c17afbb2851e');
  });

  it('refuses to write a snapshot that still holds a JWT', () => {
    expect(() => assertNoSecrets(JSON.stringify({ token: JWT }))).toThrow(/JWT/);
    expect(() => assertNoSecrets(JSON.stringify({ token: 'showcase-demo-token.admin' }))).not.toThrow();
  });
});
