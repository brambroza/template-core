'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Download, Printer, SlidersHorizontal } from 'lucide-react';
import { useReveal } from '@/lib/motion';
import {
  columnTotals, fillPath, fillTemplate, filterGroups, filtersToQuery, get, hasPerm, listRows, matches, repeatsAbove, reportIndent, reportRowStyle, routeParams, rowLinkScreen, toCsv,
  type CompanyProfile, type Field, type ListScreen,
} from '@erp/ui-schema';
import { api } from '@/lib/api';
import { datedFileName, downloadText } from '@/lib/download';
import { screenHref } from '@/lib/nav';
import { loadSession } from '@/lib/session';
import { readPref, writePref } from '@/lib/prefs';
import { clampPage, DEFAULT_PAGE_SIZE, validPageSize } from '@/lib/paging';
import { Pagination } from './Pagination';
import { ActionButton } from './ActionButton';
import { DateRangeInput, FieldInput, type Values } from './Fields';
import { loadCompany } from './print/company';
import { Letterhead } from './print/PrintParts';
import { ImportButton } from './ImportButton';
import { isNumeric, isWideColumn, LabelsContext, Value } from './Value';
import { AiSpark, isAiModule } from './Brand';

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
  /** the whole response, for a report's period title and balance check */
  const [res, setRes] = useState<unknown>(null);
  const report = screen.report;
  const [company, setCompany] = useState<CompanyProfile | null>(null);
  useEffect(() => { if (report) loadCompany().then(setCompany); }, [!!report]);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [moreFilters, setMoreFilters] = useState(false);
  const params = routeParams(screen.endpoint, id);
  const tableRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      const r = await api(module, fillPath(screen.endpoint, params), { query: filters });
      setRes(r);
      setRows(listRows(screen, r));
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

  // paging: the rows are already loaded, so a page is a slice of them. Reports (statements that must be read whole) and
  // printing show every row; CSV and the totals row always use every row.
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => { setPageSize(validPageSize(readPref<unknown>('list.pageSize', DEFAULT_PAGE_SIZE))); }, []);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [filterQuery, screen.endpoint, id]);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => setPrinting(true), after = () => setPrinting(false);
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []);
  const paged = !report && !printing && !!rows && rows.length > pageSize;
  const currentPage = rows ? clampPage(page, rows.length, pageSize) : 1;
  const shown = rows && paged ? rows.slice((currentPage - 1) * pageSize, currentPage * pageSize) : rows;
  useReveal(tableRef, screen.display === 'cards' ? '.gcard' : 'tbody tr', [rows?.length ?? -1, page, pageSize]);
  const goToPage = (p: number) => {
    setPage(p);
    tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const changePageSize = (size: number) => {
    const next = validPageSize(size);
    // keep the first row the user was looking at on screen
    const firstRow = (currentPage - 1) * pageSize;
    setPageSize(next); writePref('list.pageSize', next);
    setPage(Math.floor(firstRow / next) + 1);
  };

  const exportCsv = () => rows?.length && downloadText(datedFileName(screen.title), toCsv(screen.columns, rows, labels));
  const activeFilters = filterSummary(screen.filters ?? [], filters);

  // a row links only when it carries the id (a report's opening / total lines have none)
  const rowHref = (row: Record<string, unknown>) => {
    if (!screen.rowLink) return undefined;
    const target = get(row, screen.rowLink.idFrom ?? 'id');
    return target === undefined || target === null || target === '' ? undefined : screenHref(module, rowLinkScreen(screen.rowLink, row), target);
  };
  // one solid blue (primary) button per page: the create button when there is one, else the first primary action
  const listActions = (screen.actions ?? []).filter((a) => hasPerm(perms, a.perm));
  const firstPrimary = screen.create ? undefined : listActions.find((a) => a.tone === 'primary');
  const headActions = listActions.map((a) => (a.tone === 'primary' && a !== firstPrimary ? { ...a, tone: 'default' as const } : a));
  const totals = rows ? columnTotals(screen.columns, rows, report) : null;
  const subtitle = report?.subtitle && res ? fillTemplate(report.subtitle, res) : '';
  const check = report?.check && res && get(res, report.check.path) !== undefined ? { passed: get(res, report.check.path) === true, ...report.check } : null;
  const checkText = check ? fillTemplate(check.passed ? check.ok : check.fail, res) || (check.passed ? check.ok : check.fail) : '';
  const rowActions = (screen.rowActions ?? []).filter((a) => hasPerm(perms, a.perm));
  const colClass = (c: ListScreen['columns'][number]) => [isNumeric(c.format) ? 'num' : '', rows && isWideColumn(rows, (r) => get(r, c.key), c.format) ? 'col-wide' : '', c.phone === false ? 'phone-hide' : ''].filter(Boolean).join(' ') || undefined;
  // phone: the first filter (usually search) stays, the rest fold behind "ตัวกรอง"
  const extraActive = (screen.filters ?? []).slice(1).filter((f) => { const v = filters[f.name]; return v !== undefined && v !== '' && v !== false; }).length;

  const footLabelAt = Math.max(0, screen.columns.findIndex((c) => !c.total && (c.indent || !c.format || c.format === 'text')));
  const footer = totals && rows && rows.length > 0 && (
    <tfoot role="rowgroup">
      <tr role="row" className="r-foot">
        {screen.columns.map((c, ci) => (
          <td role="cell" key={c.key} className={colClass(c)} data-label={c.total ? c.label : undefined}>
            {c.total ? <Value value={totals[c.key]} format={c.format} /> : ci === footLabelAt ? report?.totalLabel ?? 'รวม' : null}
          </td>
        ))}
        {rowActions.length > 0 && <td role="cell" className="row-actions no-print" />}
      </tr>
    </tfoot>
  );

  return (
    <div className={`screen${report ? ' report print-doc' : ''}${isAiModule(module) ? ' is-ai' : ''}`}>
      {report && <Letterhead company={company} title={screen.title} docNo="" subtitle={subtitle} />}
      <header className="screen-head">
        <div>
          <h1>{isAiModule(module) && !report && <AiSpark size={22} />}{screen.title}</h1>
          {subtitle && <p className="report-period">{subtitle}</p>}
        </div>
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
          {headActions.map((a) => (
            <ActionButton key={a.id} action={a} module={module} params={params} onDone={() => setTick((t) => t + 1)} />
          ))}
          {screen.create && <Link className="btn-primary" href={screenHref(module, screen.create)}>{screen.createLabel ?? 'สร้างใหม่'}</Link>}
        </div>
      </header>

      {!!screen.filters?.length && (
        <div className={`filters no-print${moreFilters ? ' is-open' : ''}`} role="search">
          {filterGroups(screen.filters).map((g, gi) => (g.kind === 'range' ? (
            <div key={g.from.name} className={`filter filter-range${gi ? ' filter-more' : ''}`}>
              <DateRangeInput from={g.from} to={g.to} values={filters} onChange={(p) => setFilters((v) => ({ ...v, ...p }))} />
            </div>
          ) : (
            <div key={g.field.name} className={gi ? 'filter filter-more' : 'filter'}>
              <FieldInput field={{ ...g.field, required: false }} module={module} values={filters} compact onChange={(p) => setFilters((v) => ({ ...v, ...p }))} />
            </div>
          )))}
          {screen.filters.length > 1 && (
            <button type="button" className="btn filters-toggle" aria-expanded={moreFilters} onClick={() => setMoreFilters((o) => !o)}>
              <SlidersHorizontal size={16} aria-hidden />ตัวกรอง{extraActive ? ` (${extraActive})` : ''}
            </button>
          )}
          {Object.values(filters).some((v) => v) && <button type="button" className="btn-ghost" onClick={() => setFilters({})}>ล้างตัวกรอง</button>}
        </div>
      )}

      {activeFilters && !report && <p className="print-only muted">ตัวกรอง — {activeFilters}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {check && rows && rows.length > 0 && (
        <p className={`report-check ${check.passed ? 'is-ok' : 'is-bad'}`} role="status">
          {check.passed ? <CheckCircle2 size={16} aria-hidden /> : <AlertTriangle size={16} aria-hidden />} {checkText}
        </p>
      )}

      {screen.display === 'cards' ? (
        <div className="card-grid" ref={tableRef}>
          {rows === null && <p className="muted">กำลังโหลด…</p>}
          {rows?.length === 0 && !error && <p className="empty">{screen.empty ?? 'ไม่มีรายการ'}</p>}
          {shown?.map((row, i) => {
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
      <div className={report ? 'table-wrap report-wrap' : 'table-wrap stack'} ref={tableRef}>
        <table className={report ? 'data report-table' : 'data stack'} role="table">
          <thead role="rowgroup">
            <tr role="row">
              {screen.columns.map((c) => <th role="columnheader" key={c.key} className={colClass(c)}>{c.label}</th>)}
              {rowActions.length > 0 && <th role="columnheader" className="no-print"><span className="sr-only">คำสั่ง</span></th>}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows === null && <tr role="row"><td role="cell" colSpan={screen.columns.length + 1} className="muted">กำลังโหลด…</td></tr>}
            {rows?.length === 0 && !error && <tr role="row"><td role="cell" colSpan={screen.columns.length + 1} className="empty">{screen.empty ?? 'ไม่มีรายการ'}</td></tr>}
            {shown?.map((row, i) => {
              const href = rowHref(row);
              const style = reportRowStyle(report, row);
              const level = report ? reportIndent(report, row) : 0;
              const linkAt = screen.columns.findIndex((c) => !(c.hideRepeats && repeatsAbove(shown!, i, c.key)) && get(row, c.key) !== undefined && get(row, c.key) !== null && get(row, c.key) !== '');
              const cls = [href ? 'is-link' : '', style ? `r-${style}` : ''].filter(Boolean).join(' ') || undefined;
              return (
                <tr role="row" key={report ? i : String(row.id ?? i)} className={cls} onClick={href ? () => router.push(href) : undefined}>
                  {screen.columns.map((c, ci) => {
                    const raw = get(row, c.key);
                    const blank = (style === 'heading' && (isNumeric(c.format) || ci !== linkAt)) || (c.hideRepeats && repeatsAbove(shown!, i, c.key))
                      || (!!report && (raw === null || raw === undefined || raw === ''));
                    const v = <Value value={get(row, c.key)} format={c.format} max={6} cell />;
                    return (
                      <td role="cell" key={c.key} className={colClass(c)} data-label={c.label}
                        style={c.indent && level ? { paddingLeft: `calc(14px + ${level * 1.4}em)` } : undefined}>
                        {blank ? null : ci === linkAt && href ? <Link href={href} onClick={(e) => e.stopPropagation()}>{v}</Link> : v}
                      </td>
                    );
                  })}
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
          {footer}
        </table>
      </div>
      )}
      {rows !== null && rows.length > 0 && !report && (rows.length > 10
        ? <Pagination total={rows.length} page={currentPage} size={pageSize} onPage={goToPage} onSize={changePageSize} />
        : <p className="list-count" role="status">แสดง {rows.length.toLocaleString('th-TH')} รายการ</p>)}
    </div>
  );
}
