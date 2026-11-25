'use client';

import { useSyncExternalStore } from 'react';
import { DEFAULT_NUMBER_FORMAT, getNumberFormat, numberFormatOf, setNumberFormat, subscribeNumberFormat, type NumberFormat, type NumberFormatSource } from '@erp/ui-schema';
import { loadSession } from './session';

/**
 * The company's number format (thousands comma, decimals of money and of quantities — ข้อมูลบริษัท → รูปแบบตัวเลข) in this browser.
 * It comes with every `GET/PUT /company` answer (see api.ts) and is remembered per company in localStorage, so the next visit
 * writes numbers the right way from the first screen instead of flashing the default.
 */
const key = () => `erp.numfmt.${loadSession()?.tenant.code ?? '-'}`;

/** Use the format this browser remembers for the signed-in company (the default when it has none). Call once a session is known. */
export function restoreNumberFormat(): void {
  try {
    const raw = window.localStorage.getItem(key());
    setNumberFormat(raw ? (JSON.parse(raw) as Partial<NumberFormat>) : null);
  } catch {
    setNumberFormat(null);
  }
}

/** Take the number format from a company profile answer and remember it. Answers without the setting are ignored. */
export function applyCompanyNumberFormat(company: NumberFormatSource | null | undefined): void {
  if (!company || typeof company !== 'object' || !('money_decimals' in company || 'qty_decimals' in company || 'number_comma' in company)) return;
  const nf = numberFormatOf(company);
  setNumberFormat(nf);
  try {
    window.localStorage.setItem(key(), JSON.stringify(nf));
  } catch {
    /* storage unavailable: the format lasts until the page is reloaded, then it is fetched again */
  }
}

/** The number format in use; the component renders again when the company changes it. */
export function useNumberFormat(): NumberFormat {
  return useSyncExternalStore(subscribeNumberFormat, getNumberFormat, () => DEFAULT_NUMBER_FORMAT);
}
