'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Download, Printer, SlidersHorizontal } from 'lucide-react';
import { useReveal } from '@/lib/motion';
import { fillPath, filtersToQuery, get, hasPerm, listRows, matches, routeParams, toCsv, type Field, type ListScreen } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { datedFileName, downloadText } from '@/lib/download';
import { screenHref } from '@/lib/nav';
import { loadSession } from '@/lib/session';
import { ActionButton } from './ActionButton';
import { FieldInput, type Values } from './Fields';
import { ImportButton } from './ImportButton';
import { isNumeric, isWideColumn, LabelsContext, Value } from './Value';

/** "ประเภท: วัตถุดิบ · ค้นหา: เหล็ก" — the active filters, printed above the list. */
function filterSummary(fields: Field[], values: Values): string {
  return fields.flatMap((f) => {
    const v = values[f.name];
    if (v === undefined || v === null || v === '' || v === false) return [];
    const shown = f.type === 'select' ? f.options?.find((o) => o.value === String(v))?.label ?? String(v)
      : f.type === 'lookup' ? String(values[`__label.${f.name}`] ?? v)
      : f.type === 'boolean' ? 'ใช่' : String(v);
    return [`${f.label}: ${shown}`];
  }).join(' · ');
}

export function ListView({ module, screen, id }: { module: string; screen: ListScreen; id?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const labels = useContext(LabelsContext);
  const perms = loadSession()?.permissions ?? [];
  const [filters, setFilters] = useState<Values>(() => Object.fromEntries([...search.entries()]));
  /** the query string this list last wrote to the URL, so our own replace() is not read back as a new filter */
  const written = useRef(filtersToQuery(filters));
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [moreFilters, setMoreFilters] = useState(false);
  const params = routeParams(screen.endpoint, id);
  const tableRef = useRef<HTMLDivElement>(null);
  useReveal(tableRef, screen.display === 'cards' ? '.gcard' : 'tbody tr', [rows?.length ?? -1]);

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

  // filters -> URL (replace, no history entry per keystroke) so a filtered list can be bookmarked or shared
  const filterQuery = filtersToQuery(filters);
  useEffect(() => {
    if (filterQuery === written.current) return;
    const t = setTimeout(() => {
      written.current = filterQuery;
      router.replace(filterQuery ? `${pathname}?${filterQuery}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [filterQuery, pathname]);

  // URL -> filters when someone else changes it (back/forward, ⌘K opening this list with other filters)
  const urlQuery = filtersToQuery(Object.fromEntries([...search.entries()]));
  useEffect(() => {
    if (urlQuery === written.current) return;
    written.current = urlQuery;
    setFilters(Object.fromEntries([...search.entries()]));
  }, [urlQuery]);

  const exportCsv = () => rows?.length && downloadText(datedFileName(screen.title), toCsv(screen.columns, rows, labels));
  const activeFilters = filterSummary(screen.filters ?? [], filters);

  const rowHref = (row: Record<string, unknown>) => (screen.rowLink ? screenHref(module, screen.rowLink.screen, get(row, screen.rowLink.idFrom ?? 'id')) : undefined);
  const rowActions = (screen.rowActions ?? []).filter((a) => hasPerm(perms, a.perm));
  const colClass = (c: ListScreen['columns'][number]) => [isNumeric(c.format) ? 'num' : '', rows && isWideColumn(rows, (r) => get(r, c.key), c.format) ? 'col-wide' : ''].filter(Boolean).join(' ') || undefined;
  // phone: the first filter (usually search) stays, the rest fold behind "ตัวกรอง"
  const extraActive = (screen.filters ?? []).slice(1).filter((f) => { const v = filters[f.name]; return v !== undefined && v !== '' && v !== false; }).length;

  return (
    <div className="screen">
      <header className="screen-head">
        <h1>{screen.title}</h1>
        <div className="screen-actions no-print">
          <button type="button" className="btn-ghost" onClick={exportCsv} disabled={!rows?.length} title="ดาวน์โหลดรายการที่แสดงอยู่ เปิดด้วย Excel ได้">
            <Download size={16} aria-hidden /> ส่งออก CSV
          </button>
          <button type="button" className="btn-ghost" onClick={() => window.print()} disabled={!rows?.length}>
            <Printer size={16} aria-hidden /> พิมพ์รายการ
          </button>
          {screen.import && hasPerm(perms, screen.import.perm) && (
            <ImportButton module={module} spec={screen.import} title={screen.title} onDone={() => setTick((t) => t + 1)} />
          )}
          {(screen.actions ?? []).filter((a) => hasPerm(perms, a.perm)).map((a) => (
            <ActionButton key={a.id} action={a} module={module} params={params} onDone={() => setTick((t) => t + 1)} />
          ))}
          {screen.create && <Link className="btn-primary" href={screenHref(module, screen.create)}>{screen.createLabel ?? 'สร้างใหม่'}</Link>}
        </div>
      </header>

      {!!screen.filters?.length && (
        <div className={`filters no-print${moreFilters ? ' is-open' : ''}`} role="search">
          {screen.filters.map((f, fi) => (
            <div key={f.name} className={fi ? 'filter filter-more' : 'filter'}>
              <FieldInput field={{ ...f, required: false }} module={module} values={filters} compact onChange={(p) => setFilters((v) => ({ ...v, ...p }))} />
            </div>
          ))}
          {screen.filters.length > 1 && (
            <button type="button" className="btn filters-toggle" aria-expanded={moreFilters} onClick={() => setMoreFilters((o) => !o)}>
              <SlidersHorizontal size={16} aria-hidden />ตัวกรอง{extraActive ? ` (${extraActive})` : ''}
            </button>
          )}
          {Object.values(filters).some((v) => v) && <button type="button" className="btn-ghost" onClick={() => setFilters({})}>ล้างตัวกรอง</button>}
        </div>
      )}

      {activeFilters && <p className="print-only muted">ตัวกรอง — {activeFilters}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {screen.display === 'cards' ? (
        <div className="card-grid" ref={tableRef}>
          {rows === null && <p className="muted">กำลังโหลด…</p>}
          {rows?.length === 0 && !error && <p className="empty">{screen.empty ?? 'ไม่มีรายการ'}</p>}
          {rows?.map((row, i) => {
            const href = rowHref(row);
            const [head, body, ...facts] = screen.columns;
            return (
              <article key={String(row.id ?? i)} className={`gcard${href ? ' is-link' : ''}`} onClick={href ? () => router.push(href) : undefined}>
                <h3>{href ? <Link href={href} onClick={(e) => e.stopPropagation()}><Value value={get(row, head.key)} format={head.format} /></Link> : <Value value={get(row, head.key)} format={head.format} />}</h3>
                {body && <p><Value value={get(row, body.key)} format={body.format} /></p>}
                {facts.length > 0 && (
                  <dl>{facts.map((c) => <div key={c.key}><dt>{c.label}</dt><dd><Value value={get(row, c.key)} format={c.format} /></dd></div>)}</dl>
                )}
                {rowActions.length > 0 && (
                  <div className="gcard-actions" onClick={(e) => e.stopPropagation()}>
                    {rowActions.filter((a) => matches(row, a.when)).map((a) => (
                      <ActionButton key={a.id} action={a} module={module} params={row} onDone={(res) => (a.then ? router.push(screenHref(module, a.then.screen, a.then.idFrom ? get(res, a.then.idFrom) : undefined)) : setTick((t) => t + 1))} />
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
      <div className="table-wrap stack" ref={tableRef}>
        <table className="data stack" role="table">
          <thead role="rowgroup">
            <tr role="row">
              {screen.columns.map((c) => <th role="columnheader" key={c.key} className={colClass(c)}>{c.label}</th>)}
              {rowActions.length > 0 && <th role="columnheader" className="no-print"><span className="sr-only">คำสั่ง</span></th>}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows === null && <tr role="row"><td role="cell" colSpan={screen.columns.length + 1} className="muted">กำลังโหลด…</td></tr>}
            {rows?.length === 0 && !error && <tr role="row"><td role="cell" colSpan={screen.columns.length + 1} className="empty">{screen.empty ?? 'ไม่มีรายการ'}</td></tr>}
            {rows?.map((row, i) => {
              const href = rowHref(row);
              return (
                <tr role="row" key={String(row.id ?? i)} className={href ? 'is-link' : undefined} onClick={href ? () => router.push(href) : undefined}>
                  {screen.columns.map((c, ci) => (
                    <td role="cell" key={c.key} className={colClass(c)} data-label={c.label}>
                      {ci === 0 && href ? <Link href={href} onClick={(e) => e.stopPropagation()}><Value value={get(row, c.key)} format={c.format} /></Link> : <Value value={get(row, c.key)} format={c.format} />}
                    </td>
                  ))}
                  {rowActions.length > 0 && (
                    <td role="cell" className="row-actions no-print" onClick={(e) => e.stopPropagation()}>
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
      )}
      {rows !== null && rows.length > 0 && <p className="list-count" role="status">แสดง {rows.length.toLocaleString('th-TH')} รายการ</p>}
    </div>
  );
}
