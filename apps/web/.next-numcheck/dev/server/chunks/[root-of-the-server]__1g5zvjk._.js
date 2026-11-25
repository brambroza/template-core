module.exports = [
"[externals]/crypto [external] (crypto, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("crypto", () => require("crypto"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/runtime-reacts.external.js [external] (next/dist/server/runtime-reacts.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/runtime-reacts.external.js", () => require("next/dist/server/runtime-reacts.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/node:fs [external] (node:fs, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:fs", () => require("node:fs"));

module.exports = mod;
}),
"[externals]/node:path [external] (node:path, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:path", () => require("node:path"));

module.exports = mod;
}),
"[externals]/node:stream [external] (node:stream, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:stream", () => require("node:stream"));

module.exports = mod;
}),
"[externals]/path [external] (path, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("path", () => require("path"));

module.exports = mod;
}),
"[project]/apps/web/src/app/api/[...path]/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "DELETE",
    ()=>proxy,
    "GET",
    ()=>proxy,
    "PATCH",
    ()=>proxy,
    "POST",
    ()=>proxy,
    "PUT",
    ()=>proxy,
    "dynamic",
    ()=>dynamic
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$proxy$2d$headers$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/proxy-headers.ts [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$showcase$2d$server$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/apps/web/src/lib/showcase-server.ts [app-route] (ecmascript)");
;
;
const dynamic = 'force-dynamic';
/** Same-origin proxy to the ERP gateway (GATEWAY_URL read at runtime, so one build serves any installation). */ async function proxy(req, ctx) {
    const { path } = await ctx.params;
    // public showcase (SHOWCASE=1): answers from the recorded snapshot, never reaches a gateway, never writes
    if ((0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$showcase$2d$server$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["isShowcase"])()) return (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$showcase$2d$server$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["showcaseResponse"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$showcase$2d$server$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["loadSnapshot"])(), req, path);
    const base = (process.env.GATEWAY_URL ?? 'http://localhost:8080').replace(/\/$/, '');
    const target = `${base}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
    const headers = new Headers();
    for (const h of [
        'authorization',
        'content-type',
        'accept-language',
        'x-line-signature'
    ]){
        const v = req.headers.get(h);
        if (v) headers.set(h, v);
    }
    // an empty string body would be sent as text/plain and rejected; forward "no body" instead
    const body = [
        'GET',
        'HEAD'
    ].includes(req.method) ? '' : await req.text();
    if (!body) headers.delete('content-type');
    try {
        const res = await fetch(target, {
            method: req.method,
            headers,
            body: body || undefined,
            cache: 'no-store'
        });
        return new Response(res.body, {
            status: res.status,
            headers: (0, __TURBOPACK__imported__module__$5b$project$5d2f$apps$2f$web$2f$src$2f$lib$2f$proxy$2d$headers$2e$ts__$5b$app$2d$route$5d$__$28$ecmascript$29$__["responseHeaders"])(res.headers)
        });
    } catch  {
        return Response.json({
            error: {
                code: 'gateway_unreachable',
                message: 'เชื่อมต่อเซิร์ฟเวอร์ ERP ไม่ได้'
            }
        }, {
            status: 502
        });
    }
}
;
}),
"[project]/apps/web/src/lib/proxy-headers.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * A response that replaces the caller's login token (identity `POST /me/password` revokes every older token and returns a new one):
 * the web app stores it in place of the old one (lib/api.ts). Security review 0.3, SEC-07.
 */ __turbopack_context__.s([
    "PASSED_RESPONSE_HEADERS",
    ()=>PASSED_RESPONSE_HEADERS,
    "SESSION_TOKEN_HEADER",
    ()=>SESSION_TOKEN_HEADER,
    "responseHeaders",
    ()=>responseHeaders
]);
const SESSION_TOKEN_HEADER = 'x-erp-session-token';
const PASSED_RESPONSE_HEADERS = [
    'content-type',
    'content-disposition',
    'cache-control',
    'x-content-type-options',
    'content-security-policy',
    SESSION_TOKEN_HEADER
];
function responseHeaders(from) {
    const out = new Headers();
    for (const h of PASSED_RESPONSE_HEADERS){
        const v = from.get(h);
        if (v) out.set(h, v);
    }
    if (!out.has('content-type')) out.set('content-type', 'application/json');
    out.set('x-content-type-options', 'nosniff');
    return out;
}
}),
"[project]/apps/web/src/lib/showcase-server.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "NOT_RECORDED",
    ()=>NOT_RECORDED,
    "READ_ONLY",
    ()=>READ_ONLY,
    "SHOWCASE_AI_OFF",
    ()=>SHOWCASE_AI_OFF,
    "SHOWCASE_TOKEN_PREFIX",
    ()=>SHOWCASE_TOKEN_PREFIX,
    "daysSinceCapture",
    ()=>daysSinceCapture,
    "filterRecorded",
    ()=>filterRecorded,
    "isShowcase",
    ()=>isShowcase,
    "loadSnapshot",
    ()=>loadSnapshot,
    "lookup",
    ()=>lookup,
    "personaList",
    ()=>personaList,
    "personaOf",
    ()=>personaOf,
    "resetSnapshotCache",
    ()=>resetSnapshotCache,
    "shiftDates",
    ()=>shiftDates,
    "showcaseResponse",
    ()=>showcaseResponse,
    "snapshotKey",
    ()=>snapshotKey
]);
/**
 * SHOWCASE MODE (server-only): the public "try the real ERP" site. With `SHOWCASE=1` the /api proxy answers from a recorded
 * snapshot (apps/web/showcase/snapshot.json, written by `pnpm erp showcase-capture`) instead of the gateway:
 *   - GET: exact path+query, then the path without its query (rows filtered in memory by `q`, simple equality params, `limit`), else a Thai 404
 *   - POST identity /auth/login: the recorded session of a persona (admin, sales, …) — no password check, the tokens are fake
 *   - any other write: 403 `showcase_read_only` (the web shows it as a friendly toast)
 * Normal installations never load the snapshot (default off).
 */ var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:fs [external] (node:fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/node:path [external] (node:path, cjs)");
;
;
const SHOWCASE_TOKEN_PREFIX = 'showcase-demo-token.';
const READ_ONLY = {
    code: 'showcase_read_only',
    message: 'โหมดตัวอย่าง — ไม่บันทึกข้อมูล ติดต่อทีม GO Along เพื่อทดลองระบบเต็ม'
};
const NOT_RECORDED = 'ไม่มีข้อมูลนี้ในโหมดตัวอย่าง';
function isShowcase() {
    return process.env.SHOWCASE === '1' || ("TURBOPACK compile-time value", "") === '1';
}
function snapshotKey(path, search = '') {
    const clean = path.replace(/^\/+|\/+$/g, '');
    const q = typeof search === 'string' ? new URLSearchParams(search.replace(/^\?/, '')) : search;
    const pairs = [
        ...q.entries()
    ].filter(([, v])=>v !== '').sort((a, b)=>a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    return pairs.length ? `${clean}?${new URLSearchParams(pairs).toString()}` : clean;
}
const json = (body, status = 200)=>Response.json(body, {
        status,
        headers: {
            'x-content-type-options': 'nosniff',
            'cache-control': 'no-store'
        }
    });
function personaOf(snap, authorization) {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token.startsWith(SHOWCASE_TOKEN_PREFIX)) return null;
    return snap.personas.find((p)=>p.session.token === token) ?? null;
}
const textOf = (v, depth = 0)=>{
    if (v === null || v === undefined) return [];
    if (typeof v === 'string' || typeof v === 'number') return [
        String(v)
    ];
    if (depth < 2 && typeof v === 'object' && !Array.isArray(v)) return Object.values(v).flatMap((x)=>textOf(x, depth + 1));
    return [];
};
/** Paging / search params that never mean "row field equals value". */ const NOT_FIELD_FILTERS = new Set([
    'q',
    'limit',
    'offset',
    'page',
    'pageSize',
    'sort',
    'order'
]);
function filterRecorded(body, query) {
    if (!Array.isArray(body)) return body;
    let rows = body;
    const q = (query.get('q') ?? '').trim().toLowerCase();
    if (q) rows = rows.filter((r)=>textOf(r).some((t)=>t.toLowerCase().includes(q)));
    for (const [k, v] of query.entries()){
        if (NOT_FIELD_FILTERS.has(k) || v === '') continue;
        if (!rows.some((r)=>r && typeof r === 'object' && k in r)) continue;
        rows = rows.filter((r)=>String(r[k] ?? '') === v);
    }
    const limit = Number(query.get('limit'));
    if (Number.isFinite(limit) && limit > 0) rows = rows.slice(0, limit);
    return rows;
}
function lookup(snap, persona, path, search) {
    const overlay = snap.overlays?.[persona] ?? {};
    const exact = snapshotKey(path, search);
    const hit = overlay[exact] ?? snap.responses[exact];
    if (hit) return hit;
    const bare = snapshotKey(path);
    const base = overlay[bare] ?? snap.responses[bare];
    if (!base) return null;
    if (base.s !== 200) return base;
    return {
        s: 200,
        b: filterRecorded(base.b, new URLSearchParams(search.replace(/^\?/, '')))
    };
}
function personaList(snap) {
    return snap.personas.map((p)=>({
            id: p.id,
            label: p.label,
            description: p.description ?? '',
            email: p.email,
            name: p.session.user.name,
            tenant: p.session.tenant.name
        }));
}
async function showcaseResponse(snap, req, path) {
    const url = new URL(req.url);
    const joined = path.join('/');
    const method = req.method.toUpperCase();
    if (joined === '_showcase') return json({
        showcase: true,
        capturedAt: snap.capturedAt ?? null,
        personas: personaList(snap)
    });
    if (method === 'POST' && joined === 'identity/auth/login') {
        let body = {};
        try {
            body = await req.json();
        } catch  {}
        const email = String(body.email ?? '').trim().toLowerCase();
        const p = snap.personas.find((x)=>x.id === body.persona || x.email.toLowerCase() === email) ?? (email ? null : snap.personas[0]);
        if (!p) return json({
            error: {
                code: 'invalid_credentials',
                message: 'โหมดตัวอย่าง — เลือกบทบาทจากปุ่ม “เข้าชมในฐานะ …”'
            }
        }, 401);
        return json(p.session);
    }
    // logging out only forgets the session in the browser: say OK so the web does not treat it as a failed write
    if (method === 'POST' && (joined === 'identity/logout' || joined === 'identity/auth/logout')) return json({
        ok: true
    });
    if (method !== 'GET' && method !== 'HEAD') return json({
        error: READ_ONLY
    }, 403);
    const persona = personaOf(snap, req.headers.get('authorization'));
    if (!persona) return json({
        error: {
            code: 'showcase_login',
            message: 'กรุณาเข้าสู่ระบบ'
        }
    }, 401);
    const hit = lookup(snap, persona.id, joined, url.search);
    if (!hit) return json({
        error: {
            code: 'showcase_not_recorded',
            message: NOT_RECORDED
        }
    }, 404);
    return json(hit.b ?? null, hit.s);
}
let cached = null;
const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
function shiftDates(v, days) {
    if (!days) return v;
    const walk = (x)=>{
        if (typeof x === 'string') {
            if (DATE.test(x)) return new Date(Date.parse(`${x}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
            if (STAMP.test(x)) {
                const t = Date.parse(x);
                return Number.isNaN(t) ? x : new Date(t + days * DAY).toISOString();
            }
            return x;
        }
        if (Array.isArray(x)) return x.map(walk);
        if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y])=>[
                k,
                walk(y)
            ]));
        return x;
    };
    return walk(v);
}
function daysSinceCapture(capturedAt, now = Date.now()) {
    if (!capturedAt || process.env.SHOWCASE_SHIFT_DATES === '0') return 0;
    const at = Date.parse(capturedAt.length === 10 ? `${capturedAt}T00:00:00Z` : capturedAt);
    if (Number.isNaN(at)) return 0;
    return Math.max(0, Math.floor((Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()) - at) / DAY));
}
function loadSnapshot() {
    const today = new Date().toISOString().slice(0, 10);
    if (cached?.day === today) return cached.snap;
    const candidates = [
        process.env.SHOWCASE_SNAPSHOT,
        (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(process.cwd(), 'showcase', 'snapshot.json'),
        (0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$path__$5b$external$5d$__$28$node$3a$path$2c$__cjs$29$__["join"])(process.cwd(), 'apps', 'web', 'showcase', 'snapshot.json')
    ].filter(Boolean);
    const file = candidates.find((f)=>(0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["existsSync"])(f));
    if (!file) throw new Error(`showcase snapshot not found (tried ${candidates.join(', ')}) — run \`pnpm erp showcase-capture\``);
    const raw = JSON.parse((0, __TURBOPACK__imported__module__$5b$externals$5d2f$node$3a$fs__$5b$external$5d$__$28$node$3a$fs$2c$__cjs$29$__["readFileSync"])(file, 'utf8'));
    const days = daysSinceCapture(raw.capturedAt);
    // keys (paths, queries) stay as recorded; only the answers move
    const snap = days ? {
        ...raw,
        responses: shiftDates(raw.responses, days),
        overlays: shiftDates(raw.overlays, days)
    } : raw;
    cached = {
        snap,
        day: today
    };
    return snap;
}
function resetSnapshotCache() {
    cached = null;
}
const SHOWCASE_AI_OFF = 'ผู้ช่วย AI ไม่ได้เปิดในโหมดตัวอย่าง — ในระบบจริงผู้ช่วยตอบจากข้อมูลบริษัทคุณเป็นภาษาไทย ติดต่อทีม GO Along เพื่อทดลองเต็มรูปแบบ (คำสั่งลัด ⌘K และการค้นหายังลองได้)';
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1g5zvjk._.js.map