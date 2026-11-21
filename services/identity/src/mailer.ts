/**
 * Transactional e-mail for identity (sign-up confirmation, password reset). One small HTTP call per provider, no SDK.
 *
 *   EMAIL_PROVIDER = resend (default when RESEND_API_KEY is set) | sendgrid | log (default otherwise: prints the mail, sends nothing)
 *   EMAIL_FROM     = "GO Along <no-reply@example.co.th>" — must be a sender/domain verified at the provider
 *   RESEND_API_KEY / SENDGRID_API_KEY
 *
 * `log` keeps the last mails in memory (`sentMail`) so tests and the local demo can follow links without a mail server.
 */
export interface Mail { to: string; subject: string; text: string; html: string }
export type Mailer = (mail: Mail) => Promise<void>;

/** last mails sent with the `log` provider (newest last, at most 50) */
export const sentMail: Mail[] = [];

type Env = Record<string, string | undefined>;

/** The provider these settings pick. */
export function mailProvider(env: Env): 'resend' | 'sendgrid' | 'log' {
  const p = (env.EMAIL_PROVIDER ?? '').toLowerCase();
  if (p === 'resend' || p === 'sendgrid' || p === 'log') return p;
  return env.RESEND_API_KEY ? 'resend' : 'log';
}

/** A mailer for these settings. Throws at once when a real provider lacks its key or sender. */
export function createMailer(env: Env, fetchImpl: typeof fetch = fetch, log: (line: string) => void = (l) => console.log(l)): Mailer {
  const provider = mailProvider(env);
  if (provider === 'log') {
    return async (mail) => {
      sentMail.push(mail);
      if (sentMail.length > 50) sentMail.shift();
      log(`[identity mail → ${mail.to}] ${mail.subject}\n${mail.text}`);
    };
  }
  const from = env.EMAIL_FROM;
  if (!from) throw new Error(`EMAIL_FROM is required with EMAIL_PROVIDER=${provider}`);
  if (provider === 'resend') {
    const key = env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is required with EMAIL_PROVIDER=resend');
    return async (mail) => {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html }),
      });
      if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    };
  }
  const key = env.SENDGRID_API_KEY;
  if (!key) throw new Error('SENDGRID_API_KEY is required with EMAIL_PROVIDER=sendgrid');
  const sender = /^(.*)<(.+)>$/.exec(from.trim());
  const fromObj = sender ? { email: sender[2].trim(), name: sender[1].trim() || undefined } : { email: from.trim() };
  return async (mail) => {
    const res = await fetchImpl('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: mail.to }] }], from: fromObj, subject: mail.subject,
        content: [{ type: 'text/plain', value: mail.text }, { type: 'text/html', value: mail.html }],
      }),
    });
    if (!res.ok) throw new Error(`sendgrid ${res.status}: ${(await res.text()).slice(0, 200)}`);
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A short Thai mail with one button. `lines` are plain text (escaped in the HTML part). */
export function buttonMail(to: string, subject: string, lines: string[], button?: { label: string; url: string }, footer?: string): Mail {
  const text = [...lines, ...(button ? ['', `${button.label}: ${button.url}`] : []), ...(footer ? ['', footer] : []), '', '— GO Along · บริษัท โกอะลอง จำกัด'].join('\n');
  const html = `<div style="font-family:system-ui,-apple-system,'Noto Sans Thai',sans-serif;font-size:15px;line-height:1.6;color:#0B1530;max-width:520px">
${lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('\n')}
${button ? `<p style="margin:20px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#1E40D8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${esc(button.label)}</a></p>
<p style="margin:0 0 12px;font-size:13px;color:#5B6478">ถ้าปุ่มกดไม่ได้ คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:<br>${esc(button.url)}</p>` : ''}
${footer ? `<p style="margin:16px 0 0;font-size:13px;color:#5B6478">${esc(footer)}</p>` : ''}
<p style="margin:24px 0 0;font-size:13px;color:#5B6478">— GO Along · บริษัท โกอะลอง จำกัด</p></div>`;
  return { to, subject, text, html };
}
