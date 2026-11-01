'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { buyerInfo, buyerProblems, columnTotals, COPY_LABELS, companyProblems, factSections, fillPath, get, hasPerm, matches, printSpec, printsOnPaper, repeatsAbove, routeParams, signatureBoxes, type CompanyProfile, type CopyLabel, type DetailScreen, type Format } from '@erp/ui-schema';
import { Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { screenHref } from '@/lib/nav';
import { loadSession } from '@/lib/session';
import { ActionButton } from './ActionButton';
import { AttachmentsPanel } from './AttachmentsPanel';
import { AuditTrail } from './AuditTrail';
import { FlowStepper } from './FlowStepper';
import { SavedPanel } from './SavedPanel';
import { clearSaved, wasJustSaved } from '@/lib/saved-flash';
import { loadCompany } from './print/company';
import { BuyerBlock, Letterhead, PrintFooter, Signatures } from './print/PrintParts';
import { isNumeric, Value } from './Value';

const rank = (tone?: string) => (tone === 'primary' ? 0 : tone === 'danger' ? 2 : 1);
/** Long values (descriptions, addresses, notes) take a full row in the facts grid. */
const isLong = (v: unknown) => typeof v === 'string' && v.length > 60;

const isUrl = (v: unknown) => typeof v === 'string' && /^https?:\/\/\S+$/.test(v);

/** A URL someone has to paste elsewhere (a webhook, a share link): monospace, breakable, with a copy button. */
function CopyableUrl({ url }: { url: string }) {
  const copy = () => navigator.clipboard?.writeText(url).then(() => toast({ title: 'คัดลอกแล้ว', tone: 'ok' }), () => toast({ title: 'คัดลอกไม่ได้ — เลือกข้อความแล้วคัดลอกเอง', tone: 'warn' }));
  return (
    <span className="url-value">
      <code>{url}</code>
      <button type="button" className="btn-ghost no-print" onClick={copy}><Copy size={14} aria-hidden /> คัดลอก</button>
    </span>
  );
}

type LinesDef = NonNullable<DetailScreen['lines']>[number];
/** Consecutive `half` sections are drawn side by side in pairs; everything else on its own. */
function pairLines(lines: LinesDef[]): LinesDef[][] {
  const out: LinesDef[][] = [];
  for (const ls of lines) {
    const last = out[out.length - 1];
    if (ls.half && last?.length === 1 && last[0].half) last.push(ls);
    else out.push([ls]);
  }
  return out;
}

/** The company-settings link belongs under company problems only, not under a buyer warning. */
const companyProblemsShown = (problems: string[]) => problems.some((p) => p.startsWith('ข้อมูลบริษัท') || p.startsWith('ยังไม่ได้ตั้งค่าข้อมูลบริษัท'));

export function DetailView({ module, screen, id }: { module: string; screen: DetailScreen; id?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  // just created by a form: show the "บันทึกแล้ว" panel once (the flag lives in memory, a reload does not repeat it)
  const [justSaved, setJustSaved] = useState(() => wasJustSaved(pathname));
  useEffect(() => { if (justSaved) clearSaved(); }, []);
  const perms = loadSession()?.permissions ?? [];
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const params = routeParams(screen.endpoint, id);
  const printable = !!(screen.print || screen.printable);
  const [company, setCompany] = useState<CompanyProfile | null | undefined>(undefined);
  const [copy, setCopy] = useState<CopyLabel>(COPY_LABELS[0]);
  useEffect(() => { if (printable) loadCompany().then(setCompany); }, [printable]);

  const load = useCallback(() => {
    api<Record<string, unknown>>(module, fillPath(screen.endpoint, params)).then(setRecord).catch((e) => setError(e.message));
  }, [module, screen.endpoint, id]);
  useEffect(load, [load]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!record) return <p className="muted">กำลังโหลด…</p>;

  // one solid blue (primary) button per page: the first primary action is the next step, any other primary becomes a normal button
  const firstPrimary = (screen.actions ?? []).find((a) => a.tone === 'primary' && hasPerm(perms, a.perm) && matches(record, a.when));
  const actions = (screen.actions ?? []).filter((a) => hasPerm(perms, a.perm) && matches(record, a.when))
    .map((a) => (a.tone === 'primary' && a !== firstPrimary ? { ...a, tone: 'default' as const } : a))
    .sort((a, b) => rank(a.tone) - rank(b.tone));
  const print = printSpec(screen, company?.signature_labels ?? []);
  const docNo = String(get(record, screen.heading) ?? '');
  const buyer = print && print.legal !== 'none' ? buyerInfo(record) : null;
  const onPaperElsewhere = new Set(buyer?.keys ?? []);
  // shown on screen only: what the company profile lacks for this document (undefined = still loading)
  const problems = [
    ...(print && company !== undefined && (print.legal !== 'none' || hasPerm(perms, 'identity.company.write')) ? companyProblems(company, print.legal) : []),
    ...(print ? buyerProblems(buyer, print.legal) : []),
  ];
  // facts/columns/sections that stay on screen (status badges, owner, internal notes, payments received)
  const paperClass = (f: { print?: boolean; format?: Format }) => (print && !printsOnPaper(f) ? ' screen-only' : '');
  return (
    <article className={`screen detail${print ? ' printable print-doc' : ''}`}>
      {print && <Letterhead company={company ?? null} title={print.title} docNo={docNo} copyLabel={print.copyLabel ? copy : undefined} />}
      <header className="screen-head">
        <div>
          <p className="doc-kind">{screen.title}</p>
          <h1 className={docNo.length > 40 ? 'doc-no doc-no-long' : 'doc-no'}>{docNo}</h1>
        </div>
        <div className="screen-actions no-print">
          {actions.map((a) => (
            <ActionButton key={a.id} action={a} module={module} params={{ ...params, ...record }}
              onDone={(res) => (a.then ? router.push(screenHref(module, a.then.screen, a.then.idFrom ? get(res, a.then.idFrom) : undefined)) : load())} />
          ))}
          {screen.edit && <Link className="btn" href={screenHref(module, screen.edit, id)}>แก้ไข</Link>}
          {print?.copyLabel && (
            <select className="print-copy" aria-label="พิมพ์เป็น" value={copy} onChange={(e) => setCopy(e.target.value as CopyLabel)}>
              {COPY_LABELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {print && (
            <button type="button" className="btn" onClick={() => window.print()} title="บันทึกเป็น PDF: ในหน้าต่างพิมพ์ เลือกปลายทาง “บันทึกเป็น PDF” (Save as PDF)">
              พิมพ์ / บันทึกเป็น PDF
            </button>
          )}
        </div>
      </header>

      {justSaved && <SavedPanel screen={screen} record={record} docNo={docNo} next={actions.filter((a) => a.tone !== 'danger')} onClose={() => setJustSaved(false)} />}

      {problems.length > 0 && (
        <div className="print-warning no-print" role="status">
          {problems.map((p) => <p key={p}>{p}</p>)}
          {companyProblemsShown(problems) && hasPerm(perms, 'identity.company.write') && <Link href={screenHref('identity', 'companyEdit')}>ตั้งค่าข้อมูลบริษัท</Link>}
        </div>
      )}

      {buyer && <BuyerBlock buyer={buyer} />}

      {screen.flow && <FlowStepper flow={screen.flow} record={record} />}

      {factSections(screen.fields.filter((f) => {
        const v = get(record, f.key);
        return v !== null && v !== undefined && v !== '' && !(f.hideZero && Number(v) === 0);
      })).filter((g) => g.fields.length).map((g, gi) => (
        <section key={gi} className={g.title ? 'fact-section' : undefined} aria-label={g.title}>
          {g.title && <h2 className="fact-section-title">{g.title}</h2>}
          <dl className="facts">
            {g.fields.map((f) => (
              <div key={f.key} className={(f.format === 'qr' ? 'fact fact-qr' : isLong(get(record, f.key)) ? 'fact fact-wide' : 'fact') + (f.emphasis ? ' fact-key' : '') + (onPaperElsewhere.has(f.key) ? ' screen-only' : paperClass(f))}>
                <dt>{f.label}</dt>
                <dd className={isNumeric(f.format) ? 'num' : undefined}>
                  {isUrl(get(record, f.key)) ? <CopyableUrl url={String(get(record, f.key))} /> : <Value value={get(record, f.key)} format={f.format} />}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      {pairLines(screen.lines ?? []).map((group) => {
        const sections = group.map((ls) => {
          const rows = (get(record, ls.path) as Record<string, unknown>[] | undefined) ?? [];
          const totals = columnTotals(ls.columns, rows);
          const labelAt = Math.max(0, ls.columns.findIndex((c) => !c.total));
          if (rows.length === 0) {
            // an empty section is one quiet line, not a table header over "ไม่มีรายการ"
            return <section key={ls.path} className={'detail-lines lines-empty' + paperClass(ls)}><h2>{ls.label}</h2><p className="muted">ไม่มีรายการ</p></section>;
          }
          return (
            <section key={ls.path} className={'detail-lines' + paperClass(ls)}>
              <h2>{ls.label}</h2>
              <div className="table-wrap stack">
                <table className="data stack" role="table">
                  <thead role="rowgroup"><tr role="row">{ls.columns.map((c) => <th role="columnheader" key={c.key} className={(isNumeric(c.format) ? 'num' : '') + paperClass(c) || undefined}>{c.label}</th>)}</tr></thead>
                  <tbody role="rowgroup">
                    {rows.map((r, i) => (
                      <tr role="row" key={String(r.id ?? i)}>
                        {ls.columns.map((c) => (
                          <td role="cell" key={c.key} className={(isNumeric(c.format) ? 'num' : '') + paperClass(c) || undefined} data-label={c.label}>
                            {c.hideRepeats && repeatsAbove(rows, i, c.key) ? null : <Value value={get(r, c.key)} format={c.format} cell />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {totals && (
                    <tfoot role="rowgroup">
                      <tr role="row" className="r-foot">
                        {ls.columns.map((c, ci) => (
                          <td role="cell" key={c.key} className={(isNumeric(c.format) ? 'num' : '') + paperClass(c) || undefined} data-label={c.total ? c.label : undefined}>
                            {c.total ? <Value value={totals[c.key]} format={c.format} /> : ci === labelAt ? 'รวม' : null}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </section>
          );
        });
        return group.length > 1 ? <div key={group[0].path} className="lines-pair">{sections}</div> : sections[0];
      })}

      {screen.attachments && id && <AttachmentsPanel module={module} spec={screen.attachments} recordId={id} />}
      {id && <AuditTrail module={module} recordId={id} />}

      {print && <Signatures boxes={signatureBoxes(print, record)} />}
      {print && print.footer && <PrintFooter note={company?.footer_note} payment={print.footer === 'payment'} />}
    </article>
  );
}
