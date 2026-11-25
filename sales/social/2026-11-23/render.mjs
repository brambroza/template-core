// Renders the three social images (Facebook, LinkedIn, X) from HTML with headless Chromium.
// Usage: node social.mjs <repoRoot> <outDir>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [repo, out] = process.argv.slice(2);
const require = createRequire(join(repo, 'package.json'));
const { chromium } = require('playwright-core');
const asset = (name) => 'file://' + join(repo, 'site/assets/v2', name);

const LOGO = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#818CF8"/><stop offset=".5" stop-color="#A78BFA"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="#0B1324"/><rect x="17" y="15" width="10" height="35" rx="2.5" fill="#fff"/><rect x="30" y="15" width="12" height="10" rx="2.5" fill="#fff"/><rect x="30" y="28.5" width="11" height="9.5" rx="2.5" fill="#fff" fill-opacity=".82"/><path d="M12 2.5c.5 4.6 2.4 7 7 8.2l2.5.6-2.5.6c-4.6 1.2-6.5 3.6-7 8.2-.5-4.6-2.4-7-7-8.2L2.5 11.3 5 10.7c4.6-1.2 6.5-3.6 7-8.2Z" transform="translate(41 4) scale(.82)" fill="url(#g)"/></svg>`;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap');
* { box-sizing: border-box; margin: 0; }
body { font-family: 'IBM Plex Sans Thai', 'Thonburi', sans-serif; color: #0B1324; -webkit-font-smoothing: antialiased; }
.card { position: relative; overflow: hidden; background: #F6F7FB; }
.card::before { content: ''; position: absolute; inset: 0;
  background:
    radial-gradient(60% 70% at 100% 0%, rgba(139,92,246,.20), transparent 60%),
    radial-gradient(50% 60% at 0% 100%, rgba(6,182,212,.14), transparent 60%),
    linear-gradient(rgba(11,19,36,.035) 1px, transparent 1px) 0 0 / 100% 48px,
    linear-gradient(90deg, rgba(11,19,36,.035) 1px, transparent 1px) 0 0 / 48px 100%; }
.card > * { position: relative; }
.logo { display: flex; align-items: center; gap: .55em; }
.logo b { display: block; font-weight: 700; line-height: 1.15; }
.logo small { display: block; font-size: .62em; color: #5F6982; font-weight: 500; }
.pill { display: inline-block; border-radius: 999px; padding: .4em 1em; background: #fff; color: #5B3FD9; font-weight: 600;
  border: 1.5px solid rgba(139,92,246,.45); box-shadow: 0 8px 30px rgba(79,70,229,.14); }
h1 { font-weight: 700; line-height: 1.28; letter-spacing: -.01em; }
h1 em { font-style: normal; background: linear-gradient(120deg, #4F46E5 0%, #7C3AED 52%, #0891B2 100%); -webkit-background-clip: text; color: transparent; }
.checks { list-style: none; padding: 0; display: grid; gap: .5em; font-weight: 500; color: #24304A; }
.checks li { display: flex; align-items: center; gap: .6em; }
.checks li::before { content: '✓'; flex: none; width: 1.5em; height: 1.5em; border-radius: 50%; background: #12A16B; color: #fff;
  display: grid; place-items: center; font-size: .78em; font-weight: 700; }
.url { color: #1E40D8; font-weight: 600; }
.browser { background: #fff; border-radius: 16px; border: 1px solid #CBD2DE; overflow: hidden;
  box-shadow: 0 2px 4px rgba(11,19,36,.06), 0 30px 70px rgba(11,19,36,.18); }
.browser .bar { height: 30px; background: #EEF1F7; display: flex; align-items: center; gap: 7px; padding-left: 14px; border-bottom: 1px solid #E3E7EF; }
.browser .bar i { width: 10px; height: 10px; border-radius: 50%; background: #CBD2DE; }
.browser img { display: block; width: 100%; }
.phone { background: #0B1324; border-radius: 34px; padding: 9px; box-shadow: 0 30px 70px rgba(11,19,36,.30); overflow: hidden; }
.phone div { border-radius: 26px; overflow: hidden; height: 100%; }
.phone img { display: block; width: 100%; }
.chips { display: flex; flex-wrap: wrap; gap: 12px; }
.chips span { padding: .42em .95em; border-radius: 12px; background: #fff; border: 1.5px solid #E3E7EF; font-weight: 500; color: #4A5568; }
.chips span.on { background: #2F5BFF; border-color: #2F5BFF; color: #fff; font-weight: 600; box-shadow: 0 8px 22px rgba(47,91,255,.30); }
.chips span.on::before { content: '✓ '; }
`;

const browser = (img, style) => `<div class="browser" style="${style}"><div class="bar"><i></i><i></i><i></i></div><img src="${asset(img)}"></div>`;
const phone = (img, style) => `<div class="phone" style="${style}"><div><img src="${asset(img)}"></div></div>`;
const logo = (px) => `<div class="logo" style="font-size:${px}px">${LOGO(px * 1.9)}<span><b>Factory OS</b><small>by GO Along</small></span></div>`;
const checks = `<ul class="checks"><li>ไม่คิดค่าใช้จ่ายรายหัว</li><li>ซื้อขาดได้ พร้อม source code</li><li>เพิ่มโมดูลทีหลัง ไม่ต้องรื้อของเดิม</li></ul>`;

const MODULES = [
  ['คลังสินค้า', 1], ['จัดซื้อ', 1], ['ขาย', 0], ['วางแผนการผลิต', 0], ['ซ่อมบำรุง', 1], ['ต้นทุน', 0], ['ควบคุมคุณภาพ', 0],
  ['บอทอัตโนมัติ', 1], ['อนุมัติออนไลน์', 1], ['เบิกค่าใช้จ่าย', 0], ['บุคคลและลงเวลา', 0], ['เงินเดือน', 0], ['บัญชี', 0],
  ['จองห้องและรถ', 0], ['ทรัพย์สิน', 0], ['CRM', 0], ['Helpdesk', 0], ['โครงการ', 0], ['สัญญา MA', 0],
];
const chips = `<div class="chips">${MODULES.map(([n, on]) => `<span class="${on ? 'on' : ''}">${n}</span>`).join('')}</div>`;

const pages = {
  // Facebook link/image post — 1200x630
  facebook: { w: 1200, h: 630, html: `
    <div class="card" style="width:1200px;height:630px">
      <div style="position:absolute;left:64px;top:52px;width:520px">
        ${logo(22)}
        <div class="pill" style="margin-top:34px;font-size:17px">ERP แยกโมดูลสำหรับโรงงานและ SME ไทย</div>
        <h1 style="margin-top:20px;font-size:52px">ERP ไม่ต้องซื้อทั้งก้อน<br><em>เลือกเฉพาะโมดูลที่ใช้</em></h1>
        <div style="margin-top:22px;font-size:21px">${checks}</div>
        <div class="url" style="margin-top:26px;font-size:20px">goalong.co.th</div>
      </div>
      ${browser('home.webp', 'position:absolute;left:640px;top:84px;width:860px')}
      ${phone('m-approve.webp', 'position:absolute;left:560px;top:300px;width:190px;height:400px;border-radius:28px;padding:7px')}
    </div>` },

  // LinkedIn image post — 1200x1200
  linkedin: { w: 1200, h: 1200, html: `
    <div class="card" style="width:1200px;height:1200px;padding:76px 80px 0">
      <div style="display:flex;justify-content:space-between;align-items:center">
        ${logo(26)}<div class="url" style="font-size:24px">goalong.co.th</div>
      </div>
      <div class="pill" style="margin-top:50px;font-size:22px">19 โมดูล · ซื้อทีละตัวได้</div>
      <h1 style="margin-top:24px;font-size:72px">ERP ไม่ต้องซื้อทั้งก้อน<br><em>เลือกเฉพาะโมดูลที่ใช้</em></h1>
      <div style="margin-top:40px;font-size:25px">${chips}</div>
      <div style="margin-top:44px;font-size:24px">${checks.replace('class="checks"', 'class="checks" style="display:flex;flex-wrap:wrap;gap:14px 34px"')}</div>
      ${browser('home.webp', 'position:absolute;left:80px;top:970px;width:1040px')}
    </div>` },

  // X image post — 1600x900
  x: { w: 1600, h: 900, html: `
    <div class="card" style="width:1600px;height:900px">
      <div style="position:absolute;left:90px;top:84px;width:700px">
        ${logo(30)}
        <div class="pill" style="margin-top:52px;font-size:24px">ERP แยกโมดูลสำหรับธุรกิจไทย</div>
        <h1 style="margin-top:28px;font-size:72px">ERP ไม่ต้องซื้อ<br>ทั้งก้อน<br><em>เลือกเฉพาะที่ใช้</em></h1>
        <div style="margin-top:32px;font-size:28px">${checks}</div>
        <div class="url" style="margin-top:36px;font-size:27px">goalong.co.th</div>
      </div>
      ${browser('home.webp', 'position:absolute;left:860px;top:130px;width:1150px')}
      ${phone('m-approve.webp', 'position:absolute;left:760px;top:420px;width:270px;height:560px;border-radius:38px')}
    </div>` },
};

mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
for (const [name, p] of Object.entries(pages)) {
  const page = await b.newPage({ viewport: { width: p.w, height: p.h }, deviceScaleFactor: 1 });
  const file = join(out, `.${name}.html`);
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>${CSS}</style>${p.html}`);
  await page.goto('file://' + file, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, `factory-os-${name}-${p.w}x${p.h}.png`) });
  await page.close();
}
await b.close();
