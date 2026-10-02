'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { fillPath, get, hasPerm, matches, routeParams, type DetailScreen } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { screenHref } from '@/lib/nav';
import { loadSession } from '@/lib/session';
import { ActionButton } from './ActionButton';
import { isNumeric, Value } from './Value';

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

  const actions = (screen.actions ?? []).filter((a) => hasPerm(perms, a.perm) && matches(record, a.when));
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
              onDone={(res) => (a.then ? router.push(screenHref(module, a.then.screen, get(res, a.then.idFrom))) : load())} />
          ))}
          {screen.edit && <Link className="btn" href={screenHref(module, screen.edit, id)}>แก้ไข</Link>}
          {screen.printable && <button type="button" className="btn" onClick={() => window.print()}>พิมพ์</button>}
        </div>
      </header>

      <dl className="facts">
        {screen.fields.filter((f) => { const v = get(record, f.key); return v !== null && v !== undefined && v !== ''; }).map((f) => (
          <div key={f.key} className={f.format === 'qr' ? 'fact fact-qr' : 'fact'}>
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
            <div className="table-wrap">
              <table className="data">
                <thead><tr>{ls.columns.map((c) => <th key={c.key} className={isNumeric(c.format) ? 'num' : undefined}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {rows.length === 0 && <tr><td colSpan={ls.columns.length} className="empty">ไม่มีรายการ</td></tr>}
                  {rows.map((r, i) => (
                    <tr key={String(r.id ?? i)}>
                      {ls.columns.map((c) => <td key={c.key} className={isNumeric(c.format) ? 'num' : undefined}><Value value={get(r, c.key)} format={c.format} /></td>)}
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
