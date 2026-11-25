import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { getNumberFormat, numberFormatOf, setNumberFormat, subscribeNumberFormat, type NumberFormat, type NumberFormatSource } from '@erp/ui-schema';
import { getSession } from './session';

/**
 * The company's number format (thousands comma, decimals of money and of quantities — set on the web in ข้อมูลบริษัท) on this phone.
 * It arrives with every `GET /company` answer (see api.ts) and is remembered with the company code, so the app writes numbers
 * the right way from the first screen after a restart, also before the network answers.
 */
const KEY = 'erp.numfmt';

interface Remembered { tenant: string; format: NumberFormat }

/** Use what the phone remembers for this company; another company's (or nothing) means the default. Call once the session is restored. */
export async function restoreNumberFormat(tenantCode: string | undefined): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const kept = raw ? (JSON.parse(raw) as Remembered) : null;
    setNumberFormat(kept && tenantCode && kept.tenant === tenantCode ? kept.format : null);
  } catch {
    setNumberFormat(null);
  }
}

/** Take the number format from a company profile answer and remember it. Answers without the setting are ignored. */
export function applyCompanyNumberFormat(company: NumberFormatSource | null | undefined): void {
  if (!company || typeof company !== 'object' || !('money_decimals' in company || 'qty_decimals' in company || 'number_comma' in company)) return;
  const format = numberFormatOf(company);
  setNumberFormat(format);
  const tenant = getSession()?.tenant.code;
  if (tenant) void SecureStore.setItemAsync(KEY, JSON.stringify({ tenant, format } satisfies Remembered)).catch(() => undefined);
}

/** The number format in use; the component renders again when the company changes it. */
export function useNumberFormat(): NumberFormat {
  return useSyncExternalStore(subscribeNumberFormat, getNumberFormat, getNumberFormat);
}
