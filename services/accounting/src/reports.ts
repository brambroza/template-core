/** Financial reports computed from posted journals (draft and cancelled entries never count). */
import type { Client } from '@erp/kernel';
import { round } from '@erp/thai';
import { CATEGORY_TH, TYPE_TH, type AccountType } from './chart.ts';
import { EFFECTIVE, periodTh } from './ledger.ts';

const r2 = (n: number) => round(Number(n ?? 0), 2);
/** debit-normal types show debit − credit, the rest credit − debit */
export const debitNormal = (type: string) => type === 'asset' || type === 'expense';

/** last day of a 'YYYY-MM' month */
export function monthEnd(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/* ---------------- trial balance ---------------- */

export async function trialBalance(c: Client, asOf: string, all: boolean) {
  const r = await c.query(
    `select a.id, a.code, a.name, a.type, a.category, coalesce(sum(l.debit), 0) as debit_total, coalesce(sum(l.credit), 0) as credit_total
     from accounts a
     left join (journal_lines l join journal_entries j on j.id = l.journal_id and j.status in ${EFFECTIVE} and j.entry_date <= $1) on l.account_id = a.id
     where not a.is_group
     group by a.id order by a.code`, [asOf]);
  const rows = r.rows
    .map((a) => {
      const bal = r2(a.debit_total - a.credit_total);
      return { id: a.id, code: a.code, name: a.name, type: a.type, type_label: TYPE_TH[a.type as AccountType],
        debit_total: r2(a.debit_total), credit_total: r2(a.credit_total), debit: bal > 0 ? bal : 0, credit: bal < 0 ? -bal : 0 };
    })
    .filter((a) => all || a.debit_total !== 0 || a.credit_total !== 0);
  const debit = r2(rows.reduce((s, x) => s + x.debit, 0));
  const credit = r2(rows.reduce((s, x) => s + x.credit, 0));
  const table = [...rows, { code: '', name: 'รวม', type_label: '', debit_total: r2(rows.reduce((s, x) => s + x.debit_total, 0)), credit_total: r2(rows.reduce((s, x) => s + x.credit_total, 0)), debit, credit }];
  return { asOf, rows, table, totals: { debit, credit, difference: r2(debit - credit), balanced: debit === credit } };
}

/* ---------------- general ledger ---------------- */

export async function generalLedger(c: Client, from: string, to: string, accountId?: string) {
  const accts = (await c.query(
    `select a.id, a.code, a.name, a.type,
       coalesce((select sum(l.debit - l.credit) from journal_lines l join journal_entries j on j.id = l.journal_id
                 where l.account_id = a.id and j.status in ${EFFECTIVE} and j.entry_date < $1), 0) as opening_dr
     from accounts a where not a.is_group and ($2::uuid is null or a.id = $2) order by a.code`, [from, accountId ?? null])).rows;
  const lines = (await c.query(
    `select l.account_id, j.id as journal_id, j.no, j.entry_date, j.description, j.ref, l.description as line_description, l.partner_name, l.debit, l.credit
     from journal_lines l join journal_entries j on j.id = l.journal_id
     where j.status in ${EFFECTIVE} and j.entry_date between $1 and $2 and ($3::uuid is null or l.account_id = $3)
     order by j.entry_date, j.no, l.line_no`, [from, to, accountId ?? null])).rows;
  const byAccount = new Map<string, typeof lines>();
  for (const l of lines) byAccount.set(l.account_id, [...(byAccount.get(l.account_id) ?? []), l]);

  const rows: Record<string, unknown>[] = [];
  const accounts: Record<string, unknown>[] = [];
  for (const a of accts) {
    const sign = debitNormal(a.type) ? 1 : -1;
    const opening = r2(a.opening_dr * sign);
    const mine = byAccount.get(a.id) ?? [];
    if (!accountId && opening === 0 && mine.length === 0) continue;
    let bal = opening;
    rows.push({ kind: 'opening', account_id: a.id, account_code: a.code, account_name: a.name, entry_date: from, description: 'ยอดยกมา', balance: opening });
    let dr = 0, cr = 0;
    for (const l of mine) {
      bal = r2(bal + (l.debit - l.credit) * sign);
      dr += l.debit; cr += l.credit;
      rows.push({ kind: 'line', account_id: a.id, account_code: a.code, account_name: a.name, journal_id: l.journal_id, id: l.journal_id, no: l.no, entry_date: l.entry_date,
        description: l.line_description ? `${l.description} — ${l.line_description}` : l.description, ref: l.ref, partner_name: l.partner_name,
        debit: r2(l.debit), credit: r2(l.credit), balance: bal });
    }
    rows.push({ kind: 'closing', account_id: a.id, account_code: a.code, account_name: a.name, entry_date: to, description: 'ยอดยกไป', debit: r2(dr), credit: r2(cr), balance: bal });
    accounts.push({ id: a.id, code: a.code, name: a.name, opening, debit: r2(dr), credit: r2(cr), closing: bal });
  }
  const one = accountId ? accounts[0] ?? null : null;
  return {
    from, to, account: one ? { id: one.id, code: one.code, name: one.name } : null,
    opening: one ? one.opening : null, closing: one ? one.closing : null,
    totalDebit: r2(accounts.reduce((s, a) => s + (a.debit as number), 0)), totalCredit: r2(accounts.reduce((s, a) => s + (a.credit as number), 0)),
    accounts, rows,
  };
}

/* ---------------- profit & loss ---------------- */

/** natural amount per non-group P&L account between two dates (revenue: Cr − Dr, expense: Dr − Cr) */
async function plAmounts(c: Client, from: string, to: string) {
  const r = await c.query(
    `select a.id, a.code, a.name, a.type, a.category, coalesce(sum(l.debit - l.credit), 0) as dr
     from accounts a
     join journal_lines l on l.account_id = a.id
     join journal_entries j on j.id = l.journal_id and j.status in ${EFFECTIVE} and j.entry_date between $1 and $2
     where a.type in ('revenue', 'expense') group by a.id`, [from, to]);
  return new Map(r.rows.map((a) => [a.id, { ...a, amount: r2(debitNormal(a.type) ? a.dr : -a.dr) }]));
}

const PL_SECTIONS = [
  { category: 'revenue', label: 'รายได้จากการขายและบริการ', total: 'รวมรายได้จากการขายและบริการ' },
  { category: 'cost_of_sales', label: 'ต้นทุนขายและบริการ', total: 'รวมต้นทุนขาย' },
  { category: 'expense', label: 'ค่าใช้จ่ายในการขายและบริหาร', total: 'รวมค่าใช้จ่ายในการขายและบริหาร' },
  { category: 'other_income', label: 'รายได้อื่น', total: 'รวมรายได้อื่น' },
  { category: 'income_tax', label: 'ภาษีเงินได้นิติบุคคล', total: 'รวมภาษีเงินได้' },
] as const;

/** P&L for a month and year-to-date (calendar fiscal year). */
export async function profitLoss(c: Client, month: string) {
  const year = month.slice(0, 4);
  const from = `${month}-01`;
  const to = monthEnd(month);
  const [m, y] = await Promise.all([plAmounts(c, from, to), plAmounts(c, `${year}-01-01`, to)]);
  const accounts = new Map([...y.values()].map((a) => [a.id, a]));
  const rows: Record<string, unknown>[] = [];
  const totals: Record<string, { month: number; ytd: number }> = {};
  for (const sec of PL_SECTIONS) {
    const list = [...accounts.values()].filter((a) => a.category === sec.category).sort((a, b) => a.code.localeCompare(b.code));
    const t = { month: r2(list.reduce((s, a) => s + (m.get(a.id)?.amount ?? 0), 0)), ytd: r2(list.reduce((s, a) => s + a.amount, 0)) };
    totals[sec.category] = t;
    if (!list.length && (sec.category === 'other_income' || sec.category === 'income_tax')) continue;
    rows.push({ kind: 'section', name: sec.label });
    for (const a of list) rows.push({ kind: 'account', id: a.id, account_id: a.id, code: a.code, name: a.name, month: m.get(a.id)?.amount ?? 0, ytd: a.amount });
    rows.push({ kind: 'total', name: sec.total, month: t.month, ytd: t.ytd });
    if (sec.category === 'cost_of_sales') {
      rows.push({ kind: 'result', name: 'กำไร (ขาดทุน) ขั้นต้น', month: r2(totals.revenue.month - t.month), ytd: r2(totals.revenue.ytd - t.ytd) });
    }
    if (sec.category === 'other_income') {
      const pre = (k: 'month' | 'ytd') => r2(totals.revenue[k] - totals.cost_of_sales[k] - totals.expense[k] + t[k]);
      rows.push({ kind: 'result', name: 'กำไร (ขาดทุน) ก่อนภาษีเงินได้', month: pre('month'), ytd: pre('ytd') });
    }
  }
  const net = (k: 'month' | 'ytd') => r2(totals.revenue[k] - totals.cost_of_sales[k] - totals.expense[k] + totals.other_income[k] - totals.income_tax[k]);
  rows.push({ kind: 'result', name: 'กำไร (ขาดทุน) สุทธิ', month: net('month'), ytd: net('ytd') });
  return {
    month, monthTh: periodTh(month), from, to, ytdFrom: `${year}-01-01`,
    totals: {
      revenue: totals.revenue, costOfSales: totals.cost_of_sales, grossProfit: { month: r2(totals.revenue.month - totals.cost_of_sales.month), ytd: r2(totals.revenue.ytd - totals.cost_of_sales.ytd) },
      expenses: totals.expense, otherIncome: totals.other_income, incomeTax: totals.income_tax, netProfit: { month: net('month'), ytd: net('ytd') },
    },
    rows,
  };
}

/* ---------------- balance sheet ---------------- */

async function netProfitBetween(c: Client, from: string | null, to: string): Promise<number> {
  const r = await c.query(
    `select coalesce(sum(l.credit - l.debit), 0) as v from journal_lines l
     join journal_entries j on j.id = l.journal_id and j.status in ${EFFECTIVE}
     join accounts a on a.id = l.account_id and a.type in ('revenue', 'expense')
     where j.entry_date <= $2 and ($1::date is null or j.entry_date >= $1)`, [from, to]);
  return r2(r.rows[0].v);
}

export async function balanceSheet(c: Client, asOf: string) {
  const r = await c.query(
    `select a.id, a.code, a.name, a.type, a.category, coalesce(sum(l.debit - l.credit), 0) as dr
     from accounts a
     join journal_lines l on l.account_id = a.id
     join journal_entries j on j.id = l.journal_id and j.status in ${EFFECTIVE} and j.entry_date <= $1
     where a.type in ('asset', 'liability', 'equity') group by a.id order by a.code`, [asOf]);
  const accts = r.rows.map((a) => ({ ...a, amount: r2(a.type === 'asset' ? a.dr : -a.dr) })).filter((a) => a.amount !== 0);
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const prior = await netProfitBetween(c, null, new Date(Date.parse(yearStart) - 86400000).toISOString().slice(0, 10));
  const current = await netProfitBetween(c, yearStart, asOf);

  const rows: Record<string, unknown>[] = [];
  const section = (category: string) => {
    const list = accts.filter((a) => a.category === category);
    const total = r2(list.reduce((s, a) => s + a.amount, 0));
    if (list.length) {
      rows.push({ kind: 'section', name: CATEGORY_TH[category as keyof typeof CATEGORY_TH] });
      for (const a of list) rows.push({ kind: 'account', id: a.id, account_id: a.id, code: a.code, name: a.name, amount: a.amount });
      rows.push({ kind: 'total', name: `รวม${CATEGORY_TH[category as keyof typeof CATEGORY_TH]}`, amount: total });
    }
    return total;
  };
  rows.push({ kind: 'heading', name: 'สินทรัพย์' });
  const ca = section('current_asset');
  const nca = section('non_current_asset');
  const assets = r2(ca + nca);
  rows.push({ kind: 'result', name: 'รวมสินทรัพย์', amount: assets });
  rows.push({ kind: 'heading', name: 'หนี้สินและส่วนของผู้ถือหุ้น' });
  const cl = section('current_liability');
  const ncl = section('non_current_liability');
  const liabilities = r2(cl + ncl);
  rows.push({ kind: 'result', name: 'รวมหนี้สิน', amount: liabilities });
  rows.push({ kind: 'section', name: 'ส่วนของผู้ถือหุ้น' });
  const eq = accts.filter((a) => a.category === 'equity');
  for (const a of eq) rows.push({ kind: 'account', id: a.id, account_id: a.id, code: a.code, name: a.name, amount: a.amount });
  if (prior !== 0) rows.push({ kind: 'account', name: 'กำไร (ขาดทุน) ปีก่อนที่ยังไม่ได้โอนปิดเข้ากำไรสะสม', amount: prior });
  rows.push({ kind: 'account', name: 'กำไร (ขาดทุน) สุทธิปีปัจจุบัน', amount: current });
  const equity = r2(eq.reduce((s, a) => s + a.amount, 0) + prior + current);
  rows.push({ kind: 'total', name: 'รวมส่วนของผู้ถือหุ้น', amount: equity });
  rows.push({ kind: 'result', name: 'รวมหนี้สินและส่วนของผู้ถือหุ้น', amount: r2(liabilities + equity) });
  return {
    asOf,
    totals: { currentAssets: ca, nonCurrentAssets: nca, assets, currentLiabilities: cl, nonCurrentLiabilities: ncl, liabilities, equity,
      netProfitYear: current, retainedUnclosed: prior, difference: r2(assets - liabilities - equity), balanced: r2(assets - liabilities - equity) === 0 },
    rows,
  };
}

/* ---------------- VAT (ภ.พ.30) ---------------- */

/**
 * ภ.พ.30 by month. C7: a reduction (purchase return / credit note) reduces the base with the tax — same signs as the registers.
 * C11: VAT is filed monthly, so months are never netted: an excess of input VAT is carried to the next month
 * (`carried_in` = ภาษีที่ชำระเกินยกมา, `carry_forward` = ยอดภาษีซื้อเกินยกไป; the chain starts at the first month with VAT postings,
 * earlier years included) and the year's total row shows what was actually payable, not output − input.
 */
export async function vatReport(c: Client, year: string) {
  const y = Number(year);
  const first = (await c.query(
    `select to_char(min(j.entry_date), 'YYYY-MM') as m from journal_entries j join journal_lines l on l.journal_id = j.id
     join accounts a on a.id = l.account_id and a.role in ('vat_output', 'vat_input') where j.status in ${EFFECTIVE}`)).rows[0]?.m as string | null;
  const startYear = first ? Math.min(Number(first.slice(0, 4)), y) : y;
  const r = await c.query(
    `select to_char(m, 'YYYY-MM') as month,
       coalesce(sum(case when a.role = 'vat_output' then l.credit - l.debit end), 0) as output_vat,
       coalesce(sum(case when a.role = 'vat_output' then case when l.credit > 0 then l.tax_base else -l.tax_base end end), 0) as output_base,
       coalesce(sum(case when a.role = 'vat_input' then l.debit - l.credit end), 0) as input_vat,
       coalesce(sum(case when a.role = 'vat_input' then case when l.debit > 0 then l.tax_base else -l.tax_base end end), 0) as input_base,
       count(l.id) filter (where a.role = 'vat_output')::int as output_count,
       count(l.id) filter (where a.role = 'vat_input')::int as input_count
     from generate_series(make_date($2::int, 1, 1), make_date($1::int, 12, 1), interval '1 month') m
     left join journal_entries j on date_trunc('month', j.entry_date) = m and j.status in ${EFFECTIVE}
     left join journal_lines l on l.journal_id = j.id
     left join accounts a on a.id = l.account_id and a.role in ('vat_output', 'vat_input')
     group by m order by m`, [y, startYear]);
  let carry = 0;
  const all = r.rows.map((x) => {
    const net = r2(x.output_vat - x.input_vat);
    const carriedIn = carry;
    const due = r2(net - carriedIn);
    const payable = due > 0 ? due : 0;
    carry = due < 0 ? r2(-due) : 0;
    return { month: x.month, month_th: periodTh(x.month), output_base: r2(x.output_base), output_vat: r2(x.output_vat), output_count: x.output_count,
      input_base: r2(x.input_base), input_vat: r2(x.input_vat), input_count: x.input_count, net,
      carried_in: carriedIn, payable, carry_forward: carry,
      result: payable > 0 ? 'ชำระเพิ่ม' : carry > 0 ? 'ภาษีซื้อเกิน (ยกไปเดือนถัดไป)' : '-' };
  });
  const rows = all.filter((x) => x.month.startsWith(`${year}-`));
  const sum = (k: 'output_vat' | 'input_vat' | 'output_base' | 'input_base' | 'net' | 'payable') => r2(rows.reduce((s, x) => s + x[k], 0));
  const last = rows.at(-1);
  const totals = {
    outputBase: sum('output_base'), outputVat: sum('output_vat'), inputBase: sum('input_base'), inputVat: sum('input_vat'), net: sum('net'),
    /** Σ of the months' payable amounts (what was paid with the returns) and the excess carried out of December */
    payable: sum('payable'), carriedIntoYear: rows[0]?.carried_in ?? 0, carryForward: last?.carry_forward ?? 0,
  };
  const table = [...rows, {
    month: '', month_th: `รวมปี ${y + 543}`, output_base: totals.outputBase, output_vat: totals.outputVat, input_base: totals.inputBase, input_vat: totals.inputVat,
    net: null, carried_in: null, payable: totals.payable, carry_forward: totals.carryForward,
    result: 'ยื่นรายเดือน — ไม่หักกลบข้ามเดือน',
  }];
  return { year, totals, rows, table };
}

/**
 * รายงานภาษีขาย / ภาษีซื้อ: each posting on a VAT account in a month, with the tax invoice behind it (C7/C8): invoice number and date,
 * the other party's name, tax ID and branch (null on postings made before they were carried — `ref` is the source document then).
 * A reduction (purchase return, reversal) shows a negative base and negative tax, so the register totals equal the ภ.พ.30 summary.
 * Wave 9: a credit note (ใบลดหนี้) is a negative row in the month it is issued, a debit note a positive one; `ref_invoice_no` / `ref_invoice_date`
 * name the tax invoice the note corrects.
 */
export async function vatLines(c: Client, month: string, kind: 'output' | 'input') {
  const role = kind === 'output' ? 'vat_output' : 'vat_input';
  const r = await c.query(
    `select j.id, j.id as journal_id, j.no, j.entry_date, j.ref, j.description, l.partner_name,
       case when (case when $2 = 'vat_output' then l.credit else l.debit end) > 0 then l.tax_base else -l.tax_base end as tax_base,
       case when $2 = 'vat_output' then l.credit - l.debit else l.debit - l.credit end as vat,
       l.tax_invoice_no, to_char(coalesce(l.tax_invoice_date, j.entry_date), 'YYYY-MM-DD') as tax_invoice_date,
       coalesce(l.tax_party_name, l.partner_name) as party_name, l.tax_party_tax_id as party_tax_id, l.tax_party_branch as party_branch,
       l.tax_ref_invoice_no as ref_invoice_no, to_char(l.tax_ref_invoice_date, 'YYYY-MM-DD') as ref_invoice_date
     from journal_lines l join journal_entries j on j.id = l.journal_id and j.status in ${EFFECTIVE}
     join accounts a on a.id = l.account_id and a.role = $2
     where j.entry_date between $1::date and (date_trunc('month', $1::date) + interval '1 month - 1 day')::date
     order by coalesce(l.tax_invoice_date, j.entry_date), j.entry_date, j.no, l.line_no`, [`${month}-01`, role]);
  const rows = r.rows.map((x, i) => ({
    ...x, seq: i + 1, tax_base: x.tax_base === null ? null : r2(x.tax_base), vat: r2(x.vat),
    party_branch_label: x.party_branch ? (/^0+$/.test(x.party_branch) ? 'สำนักงานใหญ่' : `สาขา ${x.party_branch}`) : null,
    document_no: x.tax_invoice_no ?? x.ref,
  }));
  return {
    month, monthTh: periodTh(month), kind, title: kind === 'output' ? 'รายงานภาษีขาย' : 'รายงานภาษีซื้อ',
    totals: { base: r2(rows.reduce((s, x) => s + (x.tax_base ?? 0), 0)), vat: r2(rows.reduce((s, x) => s + x.vat, 0)), count: rows.length },
    rows,
  };
}

/* ---------------- WHT received (ภาษีถูกหัก ณ ที่จ่าย) ---------------- */

export async function whtReceived(c: Client, year: string) {
  const lines = (await c.query(
    `select j.id, j.id as journal_id, j.no, j.entry_date, j.ref, l.partner_name, l.tax_base, l.debit - l.credit as amount
     from journal_lines l join journal_entries j on j.id = l.journal_id and j.status in ${EFFECTIVE}
     join accounts a on a.id = l.account_id and a.role = 'wht_receivable'
     where extract(year from j.entry_date) = $1::int order by j.entry_date, j.no`, [Number(year)])).rows
    .map((x) => ({ ...x, amount: r2(x.amount), tax_base: x.tax_base === null ? null : r2(x.tax_base) }));
  const months = new Map<string, { month: string; count: number; amount: number }>();
  for (const l of lines) {
    const k = String(l.entry_date).slice(0, 7);
    const m = months.get(k) ?? { month: k, count: 0, amount: 0 };
    m.count += 1; m.amount = r2(m.amount + l.amount);
    months.set(k, m);
  }
  const customers = new Map<string, { partner_name: string; count: number; amount: number }>();
  for (const l of lines) {
    const k = l.partner_name ?? '(ไม่ระบุ)';
    const x = customers.get(k) ?? { partner_name: k, count: 0, amount: 0 };
    x.count += 1; x.amount = r2(x.amount + l.amount);
    customers.set(k, x);
  }
  const balance = (await c.query(
    `select coalesce(sum(l.debit - l.credit), 0) as v from journal_lines l join journal_entries j on j.id = l.journal_id and j.status in ${EFFECTIVE}
     join accounts a on a.id = l.account_id and a.role = 'wht_receivable'`)).rows[0].v;
  return {
    year, total: r2(lines.reduce((s, l) => s + l.amount, 0)), balance: r2(balance),
    months: [...months.values()], customers: [...customers.values()].sort((a, b) => b.amount - a.amount), lines,
  };
}
