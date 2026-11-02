import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { buildRequest, lookupRd, parseColumns, readQuery, soapFault, thaiAddress, toBusinesses } from '../src/rd-lookup.ts';
import { definition } from '../src/service.ts';

// A valid tax ID (mod-11 check digit) and the answer shape of the Revenue Department VAT Service: one array per field.
const TIN = '0105547123454';
const col = (name: string, values: string[]) => `<${name}>${values.map((v) => `<anyType xsi:type="xsd:string">${v}</anyType>`).join('')}</${name}>`;
function answer(rows: { nid: string; title: string; name: string; branch: string; branchName: string; house: string; moo: string; soi: string; street: string; sub: string; dist: string; prov: string; post: string }[], msg = '') {
  const f = (k: keyof (typeof rows)[number]) => rows.map((r) => r[k]);
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
<soap:Body><ServiceResponse xmlns="https://rdws.rd.go.th/serviceRD3/vatserviceRD3"><ServiceResult>
${col('vNID', f('nid'))}${col('vtitleName', f('title'))}${col('vName', f('name'))}${col('vSurname', rows.map(() => '-'))}
${col('vBranchTitleName', rows.map((r) => (r.branch === '0' ? 'สำนักงานใหญ่' : 'สาขา')))}${col('vBranchName', f('branchName'))}${col('vBranchNumber', f('branch'))}
${col('vBuildingName', rows.map(() => '-'))}${col('vFloorNumber', rows.map(() => '-'))}${col('vVillageName', rows.map(() => '-'))}${col('vRoomNumber', rows.map(() => '-'))}
${col('vHouseNumber', f('house'))}${col('vMooNumber', f('moo'))}${col('vSoiName', f('soi'))}${col('vStreetName', f('street'))}
${col('vThambol', f('sub'))}${col('vAmphur', f('dist'))}${col('vProvince', f('prov'))}${col('vPostCode', f('post'))}
${col('vBusinessFirstDate', rows.map(() => '2547/03/15'))}${msg ? col('vmsgerr', [msg]) : '<vmsgerr><anyType xsi:nil="true" /></vmsgerr>'}
</ServiceResult></ServiceResponse></soap:Body></soap:Envelope>`;
}
const SIAM = [
  { nid: TIN, title: 'บริษัท', name: 'สยามพาร์ท เมทัลเวิร์ค จำกัด', branch: '0', branchName: '-', house: '99/9', moo: '-', soi: 'สุขุมวิท 71', street: 'สุขุมวิท', sub: 'พระโขนงเหนือ', dist: 'วัฒนา', prov: 'กรุงเทพมหานคร', post: '10110' },
  { nid: TIN, title: 'บริษัท', name: 'สยามพาร์ท เมทัลเวิร์ค จำกัด', branch: '1', branchName: 'โรงงานบางพลี', house: '918/288', moo: '10', soi: '-', street: '-', sub: 'ในคลองบางปลากด', dist: 'พระสมุทรเจดีย์', prov: 'สมุทรปราการ', post: '10290' },
];

describe('Revenue Department VAT Service: request and answer', () => {
  it('asks by tax ID or by name with the public anonymous login', () => {
    const x = buildRequest({ tin: TIN });
    expect(x).toContain(`<vat:TIN>${TIN}</vat:TIN>`);
    expect(x).toContain('<vat:username>anonymous</vat:username>');
    expect(buildRequest({ name: 'สยาม & พาร์ท' })).toContain('<vat:Name>สยาม &amp; พาร์ท</vat:Name>');
  });

  it('reads head office and branches with Thai addresses', () => {
    const rows = toBusinesses(parseColumns(answer(SIAM)).cols);
    expect(rows).toEqual([
      { taxId: TIN, branch: '00000', branchLabel: 'สำนักงานใหญ่', name: 'บริษัท สยามพาร์ท เมทัลเวิร์ค จำกัด',
        address: 'เลขที่ 99/9 ซอยสุขุมวิท 71 ถนนสุขุมวิท แขวงพระโขนงเหนือ เขตวัฒนา กรุงเทพมหานคร 10110',
        subdistrict: 'พระโขนงเหนือ', district: 'วัฒนา', province: 'กรุงเทพมหานคร', postcode: '10110', vatSince: '2547/03/15' },
      { taxId: TIN, branch: '00001', branchLabel: 'สาขาที่ 00001 โรงงานบางพลี', name: 'บริษัท สยามพาร์ท เมทัลเวิร์ค จำกัด',
        address: 'เลขที่ 918/288 หมู่ 10 ตำบลในคลองบางปลากด อำเภอพระสมุทรเจดีย์ จังหวัดสมุทรปราการ 10290',
        subdistrict: 'ในคลองบางปลากด', district: 'พระสมุทรเจดีย์', province: 'สมุทรปราการ', postcode: '10290', vatSince: '2547/03/15' },
    ]);
  });

  it('tolerates spelling and prefix differences', () => {
    const odd = answer(SIAM.slice(0, 1)).replace(/vThambol/g, 'vTambol').replace(/<(\/?)vName>/g, '<$1ns1:vName>').replace(/<(\/?)vName/g, '<$1ns1:vName');
    expect(toBusinesses(parseColumns(odd).cols)[0]).toMatchObject({ name: 'บริษัท สยามพาร์ท เมทัลเวิร์ค จำกัด', subdistrict: 'พระโขนงเหนือ' });
    expect(thaiAddress({ house: 'เลขที่ 5', subdistrict: 'ตำบลบางพลีใหญ่', district: 'อำเภอบางพลี', province: 'จังหวัดสมุทรปราการ', postcode: '10540' }))
      .toBe('เลขที่ 5 ตำบลบางพลีใหญ่ อำเภอบางพลี จังหวัดสมุทรปราการ 10540');
  });

  it('treats a SOAP fault as a failure, not as "not found" (the real answer to a name search on 2026-11-02)', async () => {
    const REAL = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body><soap:Fault><soap:Code><soap:Value>soap:Receiver</soap:Value></soap:Code><soap:Reason><soap:Text xml:lang="en">Server was unable to process request. ---&gt; Incorrect syntax near 'a'.</soap:Text></soap:Reason><soap:Detail /></soap:Fault></soap:Body></soap:Envelope>`;
    expect(soapFault(REAL)).toBe("Incorrect syntax near 'a'.");
    expect(soapFault(answer(SIAM))).toBeNull();
    const fake = (async () => new Response(REAL, { status: 500 })) as unknown as typeof fetch;
    await expect(lookupRd({ name: 'ซีพี ออลล์' }, { fetchImpl: fake })).rejects.toThrow(/ระบบกรมสรรพากรค้นหาไม่ได้ \(Incorrect syntax near 'a'\.\)/);
  });

  it('reads what people type', () => {
    expect(readQuery('0105-54712-345-4')).toEqual({ tin: TIN });
    expect(readQuery('0105547123452')).toEqual({ invalidTin: '0105547123452' });
    expect(readQuery('01055')).toBeNull();
    expect(readQuery('สย')).toBeNull();
    expect(readQuery('สยามพาร์ท')).toEqual({ name: 'สยามพาร์ท' });
  });
});

describe('GET /partners/lookup', () => {
  let t: TestService;
  let rd: Server;
  const asked: string[] = [];
  let mode: 'ok' | 'down' | 'empty' = 'ok';

  beforeAll(async () => {
    rd = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        asked.push(body);
        if (mode === 'down') { res.writeHead(503); res.end('down'); return; }
        res.writeHead(200, { 'content-type': 'application/soap+xml; charset=utf-8' });
        res.end(mode === 'empty' ? answer([], 'ไม่พบข้อมูล') : answer(SIAM));
      });
    });
    await new Promise<void>((r) => rd.listen(0, '127.0.0.1', r));
    t = await bootTestService(definition, { RD_VAT_SERVICE_URL: `http://127.0.0.1:${(rd.address() as AddressInfo).port}/vat` });
  });
  afterAll(async () => { await t?.close(); rd?.close(); });

  it('finds a company by tax ID, every branch, and says which one the company already has', async () => {
    await t.api('POST', '/partners', { code: 'CUS-SIAM', name: 'สยามพาร์ท (เดิม)', kind: 'customer', taxId: TIN, branch: '00001' });
    const r = await t.api('GET', `/partners/lookup?q=${TIN}`);
    expect(r.status).toBe(200);
    expect(r.body.source).toMatch(/กรมสรรพากร/);
    expect(r.body.results.map((x: any) => [x.branch, x.existing_code])).toEqual([['00000', null], ['00001', 'CUS-SIAM']]);
    expect(asked.at(-1)).toContain(`<vat:TIN>${TIN}</vat:TIN>`);
  });

  it('searches by name and remembers answers for a day (one call to the Revenue Department)', async () => {
    const before = asked.length;
    expect((await t.api('GET', `/partners/lookup?q=${encodeURIComponent('สยามพาร์ท')}`)).body.results).toHaveLength(2);
    await t.api('GET', `/partners/lookup?q=${encodeURIComponent('สยามพาร์ท')}`);
    expect(asked.length).toBe(before + 1);
    expect(asked.at(-1)).toContain('<vat:Name>สยามพาร์ท</vat:Name>');
  });

  it('explains bad input, not found and a service that is down — in Thai', async () => {
    const bad = await t.api('GET', '/partners/lookup?q=0105547123452');
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/หลักตรวจสอบไม่ตรง/);
    expect((await t.api('GET', '/partners/lookup?q=ab')).status).toBe(400);
    mode = 'empty';
    expect((await t.api('GET', `/partners/lookup?q=${encodeURIComponent('ไม่มีบริษัทนี้')}`)).body.results).toEqual([]);
    mode = 'down';
    const down = await t.api('GET', `/partners/lookup?q=${encodeURIComponent('บริษัทใหม่')}`);
    expect(down.status).toBe(502);
    expect(down.body.error.message).toMatch(/กรมสรรพากร/);
    mode = 'ok';
  });

  it('needs the partner write permission', async () => {
    expect((await t.api('GET', `/partners/lookup?q=${TIN}`, undefined, { token: t.token(['master.partner.read']) })).status).toBe(403);
  });

  it('only marks partners of the same company as existing', async () => {
    const other = t.token(['master.*'], t.otherTenantId);
    const r = await t.api('GET', `/partners/lookup?q=${TIN}`, undefined, { token: other });
    expect(r.body.results.every((x: any) => x.existing_code === null)).toBe(true);
  });
});
