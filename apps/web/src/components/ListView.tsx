'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReveal } from '@/lib/motion';
import { fillPath, get, hasPerm, listRows, matches, routeParams, type ListScreen } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { screenHref } from '@/lib/nav';
import { loadSession } from '@/lib/session';
import { ActionButton } from './ActionButton';
import { FieldInput, type Values } from './Fields';
import { isNumeric, Value } from './Value';

export function ListView({ module, screen, id }: { module: string; screen: ListScreen; id?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const perms = loadSession()?.permissions ?? [];
  const [filters, setFilters] = useState<Values>(() => Object.fromEntries([...search.entries()]));
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const params = routeParams(screen.endpoint, id);
  const tableRef = useRef<HTMLDivElement>(null);
  useReveal(tableRef, 'tbody tr', [rows?.length ?? -1]);

  const load = useCallback(async () => {
    try {
      setError('');
      setRows(listRows(screen, await api(module, fillPath(screen.endpoint, params), { query: filters })));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ');
      setRows([]);
    }
  }, [module, screen.endpoint, id, JSON.stringify(filters)]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, tick]);

  const rowHref = (row: Record<string, unknown>) => (screen.rowLink ? screenHref(module, screen.rowLink.screen, get(row, screen.rowLink.idFrom ?? 'id')) : undefined);
  const rowActions = (screen.rowActions ?? []).filter((a) => hasPerm(perms, a.perm));

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>{screen.title}</h1>
        <div className="screen-actions">
          {(screen.actions ?? []).filter((a) => hasPerm(perms, a.perm)).map((a) => (
            <ActionButton key={a.id} action={a} module={module} params={params} onDone={() => setTick((t) => t + 1)} />
          ))}
          {screen.create && <Link className="btn-primary" href={screenHref(module, screen.create)}>{screen.createLabel ?? 'สร้างใหม่'}</Link>}
        </div>
      </header>

      {!!screen.filters?.length && (
        <div className="filters" role="search">
          {screen.filters.map((f) => (
            <div key={f.name} className="filter">
              <FieldInput field={{ ...f, required: false }} module={module} values={filters} compact onChange={(p) => setFilters((v) => ({ ...v, ...p }))} />
            </div>
          ))}
          {Object.values(filters).some((v) => v) && <button type="button" className="btn-ghost" onClick={() => setFilters({})}>ล้างตัวกรอง</button>}
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="table-wrap" ref={tableRef}>
        <table className="data">
          <thead>
            <tr>
              {screen.columns.map((c) => <th key={c.key} className={isNumeric(c.format) ? 'num' : undefined}>{c.label}</th>)}
              {rowActions.length > 0 && <th><span className="sr-only">คำสั่ง</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={screen.columns.length + 1} className="muted">กำลังโหลด…</td></tr>}
            {rows?.length === 0 && !error && <tr><td colSpan={screen.columns.length + 1} className="empty">{screen.empty ?? 'ไม่มีรายการ'}</td></tr>}
            {rows?.map((row, i) => {
              const href = rowHref(row);
              return (
                <tr key={String(row.id ?? i)} className={href ? 'is-link' : undefined} onClick={href ? () => router.push(href) : undefined}>
                  {screen.columns.map((c, ci) => (
                    <td key={c.key} className={isNumeric(c.format) ? 'num' : undefined}>
                      {ci === 0 && href ? <Link href={href} onClick={(e) => e.stopPropagation()}><Value value={get(row, c.key)} format={c.format} /></Link> : <Value value={get(row, c.key)} format={c.format} />}
                    </td>
                  ))}
                  {rowActions.length > 0 && (
                    <td className="row-actions" onClick={(e) => e.stopPropagation()}>
                      {rowActions.filter((a) => matches(row, a.when)).map((a) => (
                        <ActionButton key={a.id} action={a} module={module} params={row} onDone={(res) => (a.then ? router.push(screenHref(module, a.then.screen, a.then.idFrom ? get(res, a.then.idFrom) : undefined)) : setTick((t) => t + 1))} />
                      ))}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
