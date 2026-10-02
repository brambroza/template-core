'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { fillPath, get, hasPerm, matches, routeParams, type DetailScreen } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { screenHref } from '@/lib/nav';
import { loadSession } from '@/lib/session';
import { ActionButton } from './ActionButton';
import { FlowStepper } from './FlowStepper';
import { isNumeric, Value } from './Value';

const rank = (tone?: string) => (tone === 'primary' ? 0 : tone === 'danger' ? 2 : 1);
/** Long values (descriptions, addresses, notes) take a full row in the facts grid. */
const isLong = (v: unknown) => typeof v === 'string' && v.length > 60;

export function DetailView({ module, screen, id }: { module: string; screen: DetailScreen; id?: string }) {
  const router = useRouter();
  const perms = loadSession()?.permissions ?? [];
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  const params = routeParams(screen.endpoint, id);

  const load = useCallback(() => {
    api<Record<string, unknown>>(module, fillPath(screen.endpoint, params)).then(setRecord).catch((e) => setError(e.message));
  }, [module, screen.endpoint, id]);
  useEffect(load, [load]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!record) return <p className="muted">กำลังโหลด…</p>;

  // one yellow button per page: the first primary action is the next step, any other primary becomes a normal button
  const firstPrimary = (screen.actions ?? []).find((a) => a.tone === 'primary' && hasPerm(perms, a.perm) && matches(record, a.when));
  const actions = (screen.actions ?? []).filter((a) => hasPerm(perms, a.perm) && matches(record, a.when))
    .map((a) => (a.tone === 'primary' && a !== firstPrimary ? { ...a, tone: 'default' as const } : a))
    .sort((a, b) => rank(a.tone) - rank(b.tone));
  return (
    <article className={`screen detail${screen.printable ? ' printable' : ''}`}>
      <header className="screen-head">
        <div>
          <p className="doc-kind">{screen.title}</p>
          <h1 className="doc-no">{String(get(record, screen.heading) ?? '')}</h1>
        </div>
        <div className="screen-actions no-print">
          {actions.map((a) => (
            <ActionButton key={a.id} action={a} module={module} params={{ ...params, ...record }}
              onDone={(res) => (a.then ? router.push(screenHref(module, a.then.screen, a.then.idFrom ? get(res, a.then.idFrom) : undefined)) : load())} />
          ))}
          {screen.edit && <Link className="btn" href={screenHref(module, screen.edit, id)}>แก้ไข</Link>}
          {screen.printable && <button type="button" className="btn" onClick={() => window.print()}>พิมพ์</button>}
        </div>
      </header>

      {screen.flow && <FlowStepper flow={screen.flow} record={record} />}

      <dl className="facts">
        {screen.fields.filter((f) => { const v = get(record, f.key); return v !== null && v !== undefined && v !== ''; }).map((f) => (
          <div key={f.key} className={f.format === 'qr' ? 'fact fact-qr' : isLong(get(record, f.key)) ? 'fact fact-wide' : 'fact'}>
            <dt>{f.label}</dt>
            <dd className={isNumeric(f.format) ? 'num' : undefined}><Value value={get(record, f.key)} format={f.format} /></dd>
          </div>
        ))}
      </dl>

      {screen.lines?.map((ls) => {
        const rows = (get(record, ls.path) as Record<string, unknown>[] | undefined) ?? [];
        return (
          <section key={ls.path} className="detail-lines">
            <h2>{ls.label}</h2>
            <div className="table-wrap stack">
              <table className="data stack" role="table">
                <thead role="rowgroup"><tr role="row">{ls.columns.map((c) => <th role="columnheader" key={c.key} className={isNumeric(c.format) ? 'num' : undefined}>{c.label}</th>)}</tr></thead>
                <tbody role="rowgroup">
                  {rows.length === 0 && <tr role="row"><td role="cell" colSpan={ls.columns.length} className="empty">ไม่มีรายการ</td></tr>}
                  {rows.map((r, i) => (
                    <tr role="row" key={String(r.id ?? i)}>
                      {ls.columns.map((c) => <td role="cell" key={c.key} className={isNumeric(c.format) ? 'num' : undefined} data-label={c.label}><Value value={get(r, c.key)} format={c.format} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </article>
  );
}
