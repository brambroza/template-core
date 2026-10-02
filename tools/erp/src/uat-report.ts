/**
 * Builds the UAT pack page (docs/uat/uat-pack.html) from:
 *   docs/uat/cases.json   — the UAT cases (source of truth)
 *   docs/uat/run.json     — automated UAT run (vitest json, tests/uat)
 *   docs/uat/shots.json   — screenshots taken per case (docs/uat/screens)
 *   docs/uat/system.json  — all unit/integration/e2e tests (optional)
 *   docs/uat/browser.json — browser tests (optional)
 * The page records each tester's verdict in the artifact's shared `db` (collection `results`).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

interface VitestJson {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  startTime: number;
  testResults: { name: string; assertionResults: { title: string; status: string; duration?: number; fullName: string }[] }[];
}

const AREA: [RegExp, string][] = [
  [/packages\/kernel/, 'แกนกลาง: สิทธิ์, แยกข้อมูลบริษัท, event, license'],
  [/packages\/thai/, 'ภาษีไทย: VAT, บาทถ้วน, ปี พ.ศ., พร้อมเพย์'],
  [/packages\/ui-schema/, 'ตัวช่วยหน้าจอ'],
  [/services\/identity/, 'ผู้ใช้และสิทธิ์'],
  [/services\/master-data/, 'ข้อมูลหลัก'],
  [/services\/inventory/, 'คลังสินค้า'],
  [/services\/purchasing/, 'จัดซื้อ'],
  [/services\/sales/, 'ขาย'],
  [/services\/production/, 'วางแผนการผลิต'],
  [/services\/maintenance/, 'ซ่อมบำรุง'],
  [/services\/costing/, 'ต้นทุน'],
  [/tests\/e2e/, 'ทั้งระบบผ่าน gateway (ซื้อครบ / ซื้อบางโมดูล)'],
  [/tests\/ui\//, 'หน้าจอทุกปุ่มเรียก API ที่มีจริง'],
  [/tests\/ui-e2e/, 'ใช้งานผ่าน browser จริง'],
  [/tools\//, 'เครื่องมือเสนอราคา แพ็กส่งลูกค้า license'],
];

function summarize(root: string, run: VitestJson | null) {
  if (!run) return [];
  const rows = new Map<string, { area: string; total: number; passed: number }>();
  for (const f of run.testResults) {
    const rel = relative(root, f.name);
    const area = AREA.find(([re]) => re.test(rel))?.[1] ?? rel;
    const r = rows.get(area) ?? { area, total: 0, passed: 0 };
    r.total += f.assertionResults.length;
    r.passed += f.assertionResults.filter((a) => a.status === 'passed').length;
    rows.set(area, r);
  }
  return [...rows.values()];
}

const readJson = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : null);

export function buildUatReport(root: string): string {
  const dir = join(root, 'docs', 'uat');
  const cases = readJson<any>(join(dir, 'cases.json'));
  if (!cases) throw new Error('docs/uat/cases.json not found');
  const run = readJson<VitestJson>(join(dir, 'run.json'));
  const shots = readJson<Record<string, { file: string; device: string }[]>>(join(dir, 'shots.json')) ?? {};
  const system = readJson<VitestJson>(join(dir, 'system.json'));
  const browser = readJson<VitestJson>(join(dir, 'browser.json'));
  const auto: Record<string, { status: string; ms: number }> = {};
  for (const f of run?.testResults ?? []) for (const a of f.assertionResults) {
    const id = a.title.match(/^(UAT-\d+)/)?.[1];
    if (id) auto[id] = { status: a.status, ms: Math.round(a.duration ?? 0) };
  }
  const data = {
    ...cases,
    runAt: run ? new Date(run.startTime).toISOString() : null,
    auto,
    shots,
    system: { rows: [...summarize(root, system), ...summarize(root, browser)], total: (system?.numTotalTests ?? 0) + (browser?.numTotalTests ?? 0), passed: (system?.numPassedTests ?? 0) + (browser?.numPassedTests ?? 0) },
  };
  const template = readFileSync(join(dir, 'template.html'), 'utf8');
  const html = template.replace('/*__DATA__*/null', JSON.stringify(data).replace(/</g, '\\u003c'));
  const out = join(dir, 'uat-pack.html');
  writeFileSync(out, html);
  return out;
}
