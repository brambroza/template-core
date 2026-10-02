'use client';

import type { CompanyProfile } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { loadSession } from '@/lib/session';

/** How long a fetched profile is reused. Short, so an edit in "ข้อมูลบริษัท" shows on the next print. */
const TTL_MS = 2 * 60 * 1000;
let cache: { token: string; at: number; value: Promise<CompanyProfile | null> } | null = null;

/**
 * The seller details printed on every document (identity `GET /company`), fetched once per session token and
 * reused for a short while. Answers null when identity is unreachable, so a document still prints.
 */
export function loadCompany(): Promise<CompanyProfile | null> {
  const token = loadSession()?.token ?? '';
  if (cache && cache.token === token && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = api<CompanyProfile>('identity', '/company').catch(() => null);
  cache = { token, at: Date.now(), value };
  value.then((v) => { if (v === null && cache?.value === value) cache = null; }); // retry next time after a failure
  return value;
}
