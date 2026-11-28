// Renders the feature-post images (3 posts x Facebook, LinkedIn, X) from HTML with headless Chrome.
// Screenshots come from site/assets/v2, so the images always show the real demo screens.
// Usage (from the repo root): node sales/social/2026-11-26/render.mjs
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = dirname(fileURLToPath(import.meta.url));
const repo = resolve(out, '../../..');
const require = createRequire(join(repo, 'package.json'));
const { chromium } = require('playwright-core');

/**
 * File URL of a landing-page screenshot.
 * @param {string} name file name inside site/assets/v2
 * @returns {string}
 */
const asset = (name) => 'file://' + join(repo, 'site/assets/v2', name);

/**
 * Factory OS logo mark as inline SVG.
 * @param {number} size width and height in px
 * @returns {string}
 */
const mark = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#818CF8"/><stop offset=".5" stop-color="#A78BFA"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="#0B1324"/><rect x="17" y="15" width="10" height="35" rx="2.5" fill="#fff"/><rect x="30" y="15" width="12" height="10" rx="2.5" fill="#fff"/><rect x="30" y="28.5" width="11" height="9.5" rx="2.5" fill="#fff" fill-opacity=".82"/><path d="M12 2.5c.5 4.6 2.4 7 7 8.2l2.5.6-2.5.6c-4.6 1.2-6.5 3.6-7 8.2-.5-4.6-2.4-7-7-8.2L2.5 11.3 5 10.7c4.6-1.2 6.5-3.6 7-8.2Z" transform="translate(41 4) scale(.82)" fill="url(#g)"/></svg>`;

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
.abs { position: absolute; }
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
.crop { overflow: hidden; }
.crop img { display: block; max-width: none; }
.frame { background: #fff; border-radius: 16px; border: 1px solid #CBD2DE; overflow: hidden;
  box-shadow: 0 2px 4px rgba(11,19,36,.06), 0 30px 70px rgba(11,19,36,.18); }
.frame .bar { height: 30px; background: #EEF1F7; display: flex; align-items: center; gap: 7px; padding-left: 14px; border-bottom: 1px solid #E3E7EF; }
.frame .bar i { width: 10px; height: 10px; border-radius: 50%; background: #CBD2DE; }
.frame .head { display: flex; justify-content: space-between; align-items: center; padding: .9em 1.1em .7em; font-weight: 600; }
.frame .head span { display: flex; align-items: center; gap: .5em; font-weight: 500; color: #4A5568; font-size: .82em; }
.dot { width: .7em; height: .7em; border-radius: 50%; display: inline-block; }
.backdrop { filter: blur(5px); opacity: .55; }
.palette { box-shadow: 0 0 0 2px rgba(139,92,246,.55), 0 30px 80px rgba(79,70,229,.30); background: #fff; }
.phone { background: #0B1324; padding: 9px; box-shadow: 0 30px 70px rgba(11,19,36,.30); overflow: hidden; }
.phone > div { overflow: hidden; height: 100%; background: #F6F7FB; }
.phone img { display: block; width: 100%; }
.cmds { display: flex; flex-wrap: wrap; gap: .6em; }
.cmds span { background: #fff; border: 1.5px solid #E3E7EF; border-radius: 12px; padding: .42em .9em; font-weight: 500; color: #24304A;
  box-shadow: 0 4px 14px rgba(11,19,36,.06); white-space: nowrap; }
.cmds span::before { content: '✦ '; color: #7C3AED; }
`;

/**
 * A cropped region of a 1440px-wide desktop screenshot, scaled to a display width.
 * @param {string} img file name inside site/assets/v2
 * @param {{x:number,y:number,w:number,h:number}} box region in source pixels
 * @param {number} width display width in px
 * @param {string} [cls] extra class names
 * @param {string} [style] extra inline style
 * @returns {string}
 */
function crop(img, box, width, cls = '', style = '') {
  const s = width / box.w;
  return `<div class="crop ${cls}" style="width:${width}px;height:${Math.round(box.h * s)}px;${style}"><img src="${asset(img)}" style="width:${1440 * s}px;margin:${-box.y * s}px 0 0 ${-box.x * s}px"></div>`;
}

/**
 * A window frame (title bar with three dots) around any content.
 * @param {string} inner HTML inside the frame
 * @param {string} style position and size
 * @param {string} [cls] extra class names
 * @returns {string}
 */
const windowFrame = (inner, style, cls = '') => `<div class="frame abs ${cls}" style="${style}"><div class="bar"><i></i><i></i><i></i></div>${inner}</div>`;

/**
 * A phone showing a 600px-wide mobile screenshot.
 * @param {string} img file name inside site/assets/v2
 * @param {{left:number,top:number,width:number,height:number,shift?:number}} p position, size and how many source px to scroll down
 * @returns {string}
 */
function phone(img, { left, top, width, height, shift = 0 }) {
  const s = (width - 18) / 600;
  const r = Math.round(width * 0.14);
  return `<div class="phone abs" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;border-radius:${r}px"><div style="border-radius:${r - 8}px"><img src="${asset(img)}" style="margin-top:${-shift * s}px"></div></div>`;
}

/**
 * Brand lockup: mark + "Factory OS by GO Along".
 * @param {number} px font size
 * @returns {string}
 */
const logo = (px) => `<div class="logo" style="font-size:${px}px">${mark(px * 1.9)}<span><b>Factory OS</b><small>by GO Along</small></span></div>`;

/**
 * Green-tick bullet list.
 * @param {string[]} items
 * @returns {string}
 */
const checks = (items) => `<ul class="checks">${items.map((t) => `<li>${t}</li>`).join('')}</ul>`;

// Source regions (px in the 1440x900 screenshots)
const PALETTE = { x: 382, y: 110, w: 676, h: 308 }; // cmdk.webp — the command palette
const HOME = { x: 0, y: 0, w: 1440, h: 900 };
const MAP = { x: 353, y: 372, w: 673, h: 392 }; // home.webp — the 3D plant map
const BOTS2 = { x: 325, y: 82, w: 730, h: 616 }; // bots.webp — title + two columns of templates
const BOTS3 = { x: 325, y: 82, w: 1095, h: 616 }; // bots.webp — title + three columns

const COMMANDS = ['สต็อก RM-SPCC', 'ผลิต FG-BRK-100 500', 'จองห้อง MR-1 ประชุมลูกค้า', 'เบิก ค่าน้ำมันไปหาลูกค้าบางนา', 'เสนอราคา CUS-001 แม่พิมพ์ 2 ชุด'];
const cmds = (n, style) => `<div class="cmds abs" style="${style}">${COMMANDS.slice(0, n).map((c) => `<span>${c}</span>`).join('')}</div>`;

/**
 * The plant map in a titled card with its legend.
 * @param {number} left
 * @param {number} top
 * @param {number} width card width in px
 * @returns {string}
 */
function mapCard(left, top, width) {
  const fs = Math.round(width / 30);
  return `<div class="frame abs" style="left:${left}px;top:${top}px;width:${width}px;font-size:${fs}px">
    <div class="head">ผังโรงงาน<span><i class="dot" style="background:#12A16B"></i>เดินเครื่อง <i class="dot" style="background:#E0443A;margin-left:.6em"></i>เสีย</span></div>
    ${crop('home.webp', MAP, width - 2)}</div>`;
}

const POSTS = [
  {
    slug: 'cmdk',
    pill: 'สั่งงานเป็นภาษาไทย',
    h1: ['พิมพ์ประโยคเดียว', 'ระบบกรอกฟอร์มให้'],
    checks: ['ไม่ต้องจำเมนู ไม่ต้องไล่คลิก', 'ระบบหาเครื่อง สินค้า ลูกค้า ให้เอง', 'ใช้ได้ทั้งคอมและมือถือ'],
    visual: {
      facebook: windowFrame(crop('home.webp', HOME, 858), 'left:650px;top:70px;width:860px', 'backdrop')
        + crop('cmdk.webp', PALETTE, 560, 'palette abs', 'left:606px;top:128px;border-radius:12px')
        + cmds(4, 'left:606px;top:420px;width:580px;font-size:17px'),
      linkedin: crop('cmdk.webp', PALETTE, 1040, 'palette abs', 'left:80px;top:690px;border-radius:22px'),
      x: windowFrame(crop('home.webp', HOME, 1148), 'left:880px;top:110px;width:1150px', 'backdrop')
        + crop('cmdk.webp', PALETTE, 740, 'palette abs', 'left:810px;top:190px;border-radius:16px')
        + cmds(5, 'left:810px;top:580px;width:760px;font-size:23px'),
    },
  },
  {
    slug: 'plant-map',
    pill: 'ผังโรงงาน 3 มิติ',
    h1: ['เครื่องไหนเสีย', 'รู้ได้จากผัง 3 มิติ'],
    checks: ['เครื่องที่เสียขึ้นสีแดงบนผัง', 'เห็นงานซ่อมที่ค้างของแต่ละเครื่อง', 'เปิดดูได้จากมือถือ'],
    visual: {
      facebook: mapCard(660, 84, 520) + phone('m-home.webp', { left: 560, top: 290, width: 180, height: 400, shift: 108 }),
      linkedin: mapCard(80, 690, 780) + phone('m-home.webp', { left: 830, top: 760, width: 290, height: 600, shift: 108 }),
      x: mapCard(900, 130, 660) + phone('m-home.webp', { left: 790, top: 420, width: 250, height: 560, shift: 108 }),
    },
  },
  {
    slug: 'bots',
    pill: '26 สูตรสำเร็จรูป · ไม่ต้องเขียนโค้ด',
    h1: ['ตั้งบอทเฝ้างาน', 'เปิดใช้ได้ในคลิกเดียว'],
    checks: ['เตือนสต็อกต่ำ เครื่องเสีย PO ยอดสูง', 'แจ้งในแอป LINE ส่วนตัว หรือ LINE กลุ่ม', 'สร้างกฎเองได้ แบบ เมื่อ… ถ้า… ให้…'],
    visual: {
      facebook: windowFrame(crop('bots.webp', BOTS2, 578), 'left:606px;top:66px;width:580px'),
      linkedin: windowFrame(crop('bots.webp', BOTS3, 1038), 'left:80px;top:690px;width:1040px'),
      x: windowFrame(crop('bots.webp', BOTS3, 958), 'left:900px;top:120px;width:960px')
        + phone('m-bots.webp', { left: 790, top: 420, width: 270, height: 560 }),
    },
  },
];

const SIZES = {
  // Facebook image post — 1200x630
  facebook: { w: 1200, h: 630, html: (p) => `
    <div class="card" style="width:1200px;height:630px">
      <div class="abs" style="left:64px;top:52px;width:520px">
        ${logo(22)}
        <div class="pill" style="margin-top:34px;font-size:17px">${p.pill}</div>
        <h1 style="margin-top:20px;font-size:52px">${p.h1[0]}<br><em>${p.h1[1]}</em></h1>
        <div style="margin-top:22px;font-size:21px">${checks(p.checks)}</div>
        <div class="url" style="margin-top:26px;font-size:20px">goalong.co.th</div>
      </div>
      ${p.visual.facebook}
    </div>` },
  // LinkedIn image post — 1200x1200
  linkedin: { w: 1200, h: 1200, html: (p) => `
    <div class="card" style="width:1200px;height:1200px;padding:76px 80px 0">
      <div style="display:flex;justify-content:space-between;align-items:center">${logo(26)}<div class="url" style="font-size:24px">goalong.co.th</div></div>
      <div class="pill" style="margin-top:50px;font-size:22px">${p.pill}</div>
      <h1 style="margin-top:24px;font-size:72px">${p.h1[0]}<br><em>${p.h1[1]}</em></h1>
      <div style="margin-top:34px;font-size:26px">${checks(p.checks)}</div>
      ${p.visual.linkedin}
    </div>` },
  // X image post — 1600x900
  x: { w: 1600, h: 900, html: (p) => `
    <div class="card" style="width:1600px;height:900px">
      <div class="abs" style="left:90px;top:84px;width:700px">
        ${logo(30)}
        <div class="pill" style="margin-top:52px;font-size:24px">${p.pill}</div>
        <h1 style="margin-top:28px;font-size:72px">${p.h1[0]}<br><em>${p.h1[1]}</em></h1>
        <div style="margin-top:32px;font-size:28px">${checks(p.checks)}</div>
        <div class="url" style="margin-top:36px;font-size:27px">goalong.co.th</div>
      </div>
      ${p.visual.x}
    </div>` },
};

const tmp = mkdtempSync(join(tmpdir(), 'social-'));
const browser = await chromium.launch({ channel: 'chrome' });
for (const post of POSTS) {
  for (const [name, size] of Object.entries(SIZES)) {
    const page = await browser.newPage({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 1 });
    const file = join(tmp, `${post.slug}-${name}.html`);
    writeFileSync(file, `<!doctype html><meta charset="utf-8"><style>${CSS}</style>${size.html(post)}`);
    await page.goto('file://' + file, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, `${post.slug}-${name}-${size.w}x${size.h}.png`) });
    await page.close();
  }
}
await browser.close();
