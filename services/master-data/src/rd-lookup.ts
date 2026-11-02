/**
 * Look up a VAT-registered business at the Revenue Department (กรมสรรพากร) "VAT Service" — free, public, no sign-up:
 * https://www.rd.go.th/42535.html · endpoint https://rdws.rd.go.th/serviceRD3/vatserviceRD3.asmx (SOAP 1.2, user/password "anonymous").
 * Search by 13-digit tax ID (all branches of that ID) or by name. Only VAT registrants are listed; anyone else is typed by hand.
 *
 * The response lists one array per field (`<vNID><anyType>…</anyType>…</vNID>`, `<vName>…`), one entry per branch/business.
 * The parser matches field names loosely (with or without the `v` prefix, any case, any namespace prefix) so a small change
 * in the service's spelling does not break the lookup.
 */
import { isValidThaiTaxId } from '@erp/thai';

export const RD_VAT_SERVICE_URL = 'https://rdws.rd.go.th/serviceRD3/vatserviceRD3.asmx';
const NS = 'https://rdws.rd.go.th/serviceRD3/vatserviceRD3';

export interface RdBusiness {
  taxId: string;
  /** 5 digits, 00000 = head office */
  branch: string;
  /** "สำนักงานใหญ่" or "สาขาที่ 00001 <branch name>" */
  branchLabel: string;
  /** full name as on a tax invoice, e.g. "บริษัท สยามพาร์ท จำกัด" */
  name: string;
  /** one line, Thai conventions (แขวง/เขต in Bangkok, ต./อ./จ. elsewhere), postcode last */
  address: string;
  subdistrict: string;
  district: string;
  province: string;
  postcode: string;
  /** VAT registration date as the service gives it */
  vatSince: string;
}

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export function buildRequest(q: { tin?: string; name?: string }, auth = { username: 'anonymous', password: 'anonymous' }): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:vat="${NS}">
  <soap:Header/>
  <soap:Body>
    <vat:Service>
      <vat:username>${esc(auth.username)}</vat:username>
      <vat:password>${esc(auth.password)}</vat:password>
      <vat:TIN>${esc(q.tin ?? '')}</vat:TIN>
      <vat:Name>${esc(q.name ?? '')}</vat:Name>
      <vat:ProvinceCode>0</vat:ProvinceCode>
      <vat:BranchNumber>0</vat:BranchNumber>
      <vat:AmphurCode>0</vat:AmphurCode>
    </vat:Service>
  </soap:Body>
</soap:Envelope>`;
}

const unescapeXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

/** "-", "", null-ish → "" ; trims Thai/ASCII spaces. */
const clean = (v: string | undefined) => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  return t === '-' ? '' : t;
};

/** Every `<x:vSomething>…<anyType>value</anyType>…</x:vSomething>` → { something: [values] } (keys lower-case, no `v` prefix). */
export function parseColumns(xml: string): { cols: Record<string, string[]>; error: string } {
  const result = xml.match(/<(?:\w+:)?ServiceResult\b[^>]*>([\s\S]*?)<\/(?:\w+:)?ServiceResult>/)?.[1] ?? xml;
  const cols: Record<string, string[]> = {};
  const field = /<((?:\w+:)?([A-Za-z]\w*))\b[^>]*>([\s\S]*?)<\/\1>/g;
  for (const m of result.matchAll(field)) {
    const name = m[2];
    if (/^anyType$/i.test(name)) continue;
    const inner = m[3];
    const values = [...inner.matchAll(/<(?:\w+:)?anyType\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?anyType>)/g)].map((v) => unescapeXml(v[1] ?? ''));
    const key = name.replace(/^v(?=[A-Z])/, '').toLowerCase(); // vNID → nid; vtitleName stays vtitlename (pick tries both)
    cols[key] = values.length ? values : [unescapeXml(inner.replace(/<[^>]+>/g, ''))];
  }
  const error = clean((cols.msgerr ?? cols.vmsgerr ?? []).join(' '));
  return { cols, error };
}

/** A field by any of its names, with or without the service's `v` prefix (vNID, vtitleName…), any case. */
const pick = (cols: Record<string, string[]>, i: number, ...names: string[]) => {
  for (const n of names) {
    for (const key of [n.toLowerCase(), `v${n.toLowerCase()}`]) { const v = cols[key]?.[i]; if (v !== undefined) return clean(v); }
  }
  return '';
};

const strip = (v: string, ...prefixes: string[]) => prefixes.reduce((s, p) => s.replace(new RegExp(`^${p}\\s*`), ''), v).trim();

/** Thai one-line address from the service's parts. Bangkok uses แขวง/เขต, the rest ต./อ./จ.; empty parts are skipped. */
export function thaiAddress(p: { building?: string; room?: string; floor?: string; village?: string; house?: string; moo?: string; soi?: string; street?: string; subdistrict?: string; district?: string; province?: string; postcode?: string }): string {
  const bkk = /กรุงเทพ/.test(p.province ?? '');
  const sub = strip(p.subdistrict ?? '', 'แขวง', 'ตำบล', 'ต\\.');
  const dist = strip(p.district ?? '', 'เขต', 'อำเภอ', 'อ\\.');
  const prov = strip(p.province ?? '', 'จังหวัด', 'จ\\.');
  const parts = [
    p.house && `เลขที่ ${strip(p.house, 'เลขที่')}`,
    p.moo && `หมู่ ${strip(p.moo, 'หมู่ที่', 'หมู่', 'ม\\.')}`,
    p.building && strip(p.building, 'อาคาร') && `อาคาร${strip(p.building, 'อาคาร')}`,
    p.room && `ห้อง ${strip(p.room, 'ห้อง')}`,
    p.floor && `ชั้น ${strip(p.floor, 'ชั้น')}`,
    p.village && `หมู่บ้าน${strip(p.village, 'หมู่บ้าน')}`,
    p.soi && `ซอย${strip(p.soi, 'ซอย', 'ซ\\.')}`,
    p.street && `ถนน${strip(p.street, 'ถนน', 'ถ\\.')}`,
    sub && (bkk ? `แขวง${sub}` : `ตำบล${sub}`),
    dist && (bkk ? `เขต${dist}` : `อำเภอ${dist}`),
    prov && (bkk ? 'กรุงเทพมหานคร' : `จังหวัด${prov}`),
    p.postcode,
  ];
  return parts.filter(Boolean).join(' ');
}

/** Rows of the service's answer → businesses (duplicates of the same tax ID + branch dropped). */
export function toBusinesses(cols: Record<string, string[]>): RdBusiness[] {
  const n = Math.max(0, ...['nid', 'tin', 'name', 'vnid', 'vname'].map((k) => cols[k]?.length ?? 0));
  const out: RdBusiness[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const taxId = pick(cols, i, 'NID', 'TIN').replace(/\D/g, '');
    const nameOnly = pick(cols, i, 'Name');
    if (!taxId || !nameOnly) continue;
    const surname = pick(cols, i, 'Surname');
    const title = pick(cols, i, 'titleName', 'Title');
    const name = [title && !nameOnly.startsWith(title) ? title : '', nameOnly, surname].filter(Boolean).join(' ');
    const branchNo = pick(cols, i, 'BranchNumber', 'Branch').replace(/\D/g, '') || '0';
    const branch = branchNo.padStart(5, '0').slice(-5);
    const branchName = pick(cols, i, 'BranchName');
    const province = pick(cols, i, 'Province');
    const parts = {
      building: pick(cols, i, 'BuildingName'), room: pick(cols, i, 'RoomNumber'), floor: pick(cols, i, 'FloorNumber'),
      village: pick(cols, i, 'VillageName'), house: pick(cols, i, 'HouseNumber'), moo: pick(cols, i, 'MooNumber'),
      soi: pick(cols, i, 'SoiName'), street: pick(cols, i, 'StreetName'),
      subdistrict: pick(cols, i, 'Thambol', 'Tambol', 'Tumbol', 'SubDistrict'), district: pick(cols, i, 'Amphur', 'District'),
      province, postcode: pick(cols, i, 'PostCode', 'ZipCode').replace(/\D/g, ''),
    };
    const key = `${taxId}:${branch}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      taxId, branch,
      branchLabel: branch === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${branch}${branchName && !/สำนักงานใหญ่/.test(branchName) ? ` ${branchName}` : ''}`,
      name, address: thaiAddress(parts),
      subdistrict: strip(parts.subdistrict, 'แขวง', 'ตำบล'), district: strip(parts.district, 'เขต', 'อำเภอ'), province: strip(province, 'จังหวัด'),
      postcode: parts.postcode, vatSince: pick(cols, i, 'BusinessFirstDate'),
    });
  }
  return out;
}

export class RdLookupError extends Error {}

/** What the user typed → a 13-digit tax ID (spaces/dashes allowed) or a name; null when it is neither yet. */
export function readQuery(q: string): { tin: string } | { name: string } | { invalidTin: string } | null {
  const t = q.trim();
  const digits = t.replace(/[\s-]/g, '');
  if (/^\d{13}$/.test(digits)) return isValidThaiTaxId(digits) ? { tin: digits } : { invalidTin: digits };
  if (/^\d+$/.test(digits)) return null; // still typing a number
  return t.length >= 3 ? { name: t } : null;
}

/** Call the service. Throws RdLookupError (Thai message) when it cannot be reached or answers with an error. */
export async function lookupRd(q: { tin: string } | { name: string }, opts: { url?: string; username?: string; password?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<RdBusiness[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  let text: string;
  try {
    const res = await (opts.fetchImpl ?? fetch)(opts.url ?? RD_VAT_SERVICE_URL, {
      method: 'POST',
      headers: { 'content-type': `application/soap+xml; charset=utf-8; action="${NS}/Service"` },
      body: buildRequest(q, { username: opts.username ?? 'anonymous', password: opts.password ?? 'anonymous' }),
      signal: ctrl.signal,
      redirect: 'error',
    });
    text = await res.text();
    if (!res.ok && !/ServiceResult/.test(text)) throw new RdLookupError(`กรมสรรพากรตอบกลับผิดพลาด (HTTP ${res.status}) — ลองใหม่อีกครั้ง หรือกรอกเอง`);
  } catch (e) {
    if (e instanceof RdLookupError) throw e;
    throw new RdLookupError((e as Error).name === 'AbortError' ? 'กรมสรรพากรตอบช้าเกินไป — ลองใหม่อีกครั้ง หรือกรอกเอง' : 'ติดต่อระบบกรมสรรพากรไม่ได้ — ตรวจอินเทอร์เน็ตของเซิร์ฟเวอร์ หรือกรอกเอง');
  } finally {
    clearTimeout(timer);
  }
  const { cols, error } = parseColumns(text);
  const rows = toBusinesses(cols);
  // "not found" comes back as an error text with no rows: that is an empty answer, not a failure
  if (!rows.length && error && !/ไม่พบ|not\s*found|no\s*data/i.test(error)) throw new RdLookupError(`กรมสรรพากร: ${error}`);
  return rows;
}
