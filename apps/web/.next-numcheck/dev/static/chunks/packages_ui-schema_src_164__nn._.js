(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/packages/ui-schema/src/index.ts [app-client] (ecmascript) <locals>", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "AI_FILL_TYPES",
    ()=>AI_FILL_TYPES,
    "AREAS",
    ()=>AREAS,
    "ATTACHMENT_ACCEPT",
    ()=>ATTACHMENT_ACCEPT,
    "ATTACHMENT_MAX_BYTES",
    ()=>ATTACHMENT_MAX_BYTES,
    "COPY_LABELS",
    ()=>COPY_LABELS,
    "ICONS",
    ()=>ICONS,
    "IMPORT_MAX_ROWS",
    ()=>IMPORT_MAX_ROWS,
    "OPENING_PARTNER_RESOLVE",
    ()=>OPENING_PARTNER_RESOLVE,
    "PLAN_REMIND_DAYS",
    ()=>PLAN_REMIND_DAYS,
    "STATUS_TH",
    ()=>STATUS_TH,
    "THAI_MONTHS",
    ()=>THAI_MONTHS,
    "THAI_MONTHS_SHORT",
    ()=>THAI_MONTHS_SHORT,
    "THAI_WEEKDAYS_SHORT",
    ()=>THAI_WEEKDAYS_SHORT,
    "accounting",
    ()=>accounting,
    "aiFillable",
    ()=>aiFillable,
    "applyResolved",
    ()=>applyResolved,
    "areaLabel",
    ()=>areaLabel,
    "attachmentRef",
    ()=>attachmentRef,
    "auditActionLabel",
    ()=>auditActionLabel,
    "auditDetailText",
    ()=>auditDetailText,
    "auditPerm",
    ()=>auditPerm,
    "branchText",
    ()=>branchText,
    "brokenLinks",
    ()=>brokenLinks,
    "buildTodo",
    ()=>buildTodo,
    "buyerBranchText",
    ()=>buyerBranchText,
    "buyerInfo",
    ()=>buyerInfo,
    "buyerProblems",
    ()=>buyerProblems,
    "calendarWeeks",
    ()=>calendarWeeks,
    "checkOpeningDocs",
    ()=>checkOpeningDocs,
    "cleanAiValue",
    ()=>cleanAiValue,
    "cleanListFilters",
    ()=>cleanListFilters,
    "columnTotals",
    ()=>columnTotals,
    "commandExample",
    ()=>commandExample,
    "commandTarget",
    ()=>commandTarget,
    "companyContactLine",
    ()=>companyContactLine,
    "companyProblems",
    ()=>companyProblems,
    "csvCell",
    ()=>csvCell,
    "csvDate",
    ()=>csvDate,
    "csvTemplate",
    ()=>csvTemplate,
    "csvValue",
    ()=>csvValue,
    "dateInputText",
    ()=>dateInputText,
    "datePresets",
    ()=>datePresets,
    "defineUi",
    ()=>defineUi,
    "dueText",
    ()=>dueText,
    "endpointsOf",
    ()=>endpointsOf,
    "factSections",
    ()=>factSections,
    "fileKind",
    ()=>fileKind,
    "fillPath",
    ()=>fillPath,
    "fillTemplate",
    ()=>fillTemplate,
    "filterGroups",
    ()=>filterGroups,
    "filterRows",
    ()=>filterRows,
    "filtersToQuery",
    ()=>filtersToQuery,
    "flowPosition",
    ()=>flowPosition,
    "formatBytes",
    ()=>formatBytes,
    "formatDate",
    ()=>formatDate,
    "formatTaxId",
    ()=>formatTaxId,
    "formatValue",
    ()=>formatValue,
    "get",
    ()=>get,
    "groupByArea",
    ()=>groupByArea,
    "hasPerm",
    ()=>hasPerm,
    "headerKey",
    ()=>headerKey,
    "initialValues",
    ()=>initialValues,
    "initials",
    ()=>initials,
    "isBlankLine",
    ()=>isBlankLine,
    "isJuristicTaxId",
    ()=>isJuristicTaxId,
    "isNegative",
    ()=>isNegative,
    "isNumericFormat",
    ()=>isNumericFormat,
    "isPrintable",
    ()=>isPrintable,
    "kanbanLanes",
    ()=>kanbanLanes,
    "kanbanMove",
    ()=>kanbanMove,
    "listRows",
    ()=>listRows,
    "looksLikeCompany",
    ()=>looksLikeCompany,
    "mapImportRows",
    ()=>mapImportRows,
    "matchCommand",
    ()=>matchCommand,
    "matches",
    ()=>matches,
    "mergeAiFill",
    ()=>mergeAiFill,
    "missingRequired",
    ()=>missingRequired,
    "moduleArea",
    ()=>moduleArea,
    "monthInputText",
    ()=>monthInputText,
    "openingDocColumns",
    ()=>openingDocColumns,
    "parseCsv",
    ()=>parseCsv,
    "parseDateInput",
    ()=>parseDateInput,
    "parseMonthInput",
    ()=>parseMonthInput,
    "permPrefix",
    ()=>permPrefix,
    "pickRecord",
    ()=>pickRecord,
    "planNotice",
    ()=>planNotice,
    "prefillFromQuery",
    ()=>prefillFromQuery,
    "printSpec",
    ()=>printSpec,
    "printsOnPaper",
    ()=>printsOnPaper,
    "repeatsAbove",
    ()=>repeatsAbove,
    "reportIndent",
    ()=>reportIndent,
    "reportRowStyle",
    ()=>reportRowStyle,
    "routeParams",
    ()=>routeParams,
    "rowLinkScreen",
    ()=>rowLinkScreen,
    "signatureBoxes",
    ()=>signatureBoxes,
    "statusTh",
    ()=>statusTh,
    "statusTone",
    ()=>statusTone,
    "toBody",
    ()=>toBody,
    "toCsv",
    ()=>toCsv,
    "toIsoDate",
    ()=>toIsoDate,
    "todoActions",
    ()=>todoActions,
    "todoSources",
    ()=>todoSources,
    "waitingText",
    ()=>waitingText
]);
/**
 * UI descriptors — each module describes its screens as plain data in `services/<id>/src/ui.ts`.
 * The web app and the mobile app render them generically, so a module's UI ships (and is sold) with the module.
 *
 * Endpoints are relative to the module (`/purchase-orders/:id`) and use the SAME path template as the
 * server route. `:name` is filled from form values / the current row; a screen opened with an id fills
 * the FIRST `:param` of its endpoint with that id (see `routeParams`). Lookups may only point at the module itself or a core module.
 *
 * This file must stay dependency-free and browser-safe (no node imports): web and mobile both import it.
 */ var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$number$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui-schema/src/number.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$xlsx$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/packages/ui-schema/src/xlsx.ts [app-client] (ecmascript)");
;
function rowLinkScreen(link, row) {
    const v = link.byField ? row[link.byField.field] : undefined;
    return typeof v === 'string' && link.byField?.screens[v] || link.screen;
}
function applyResolved(rows, resolve, answer) {
    const byCode = new Map(answer.map((r)=>[
            String(r.code ?? '').trim().toLowerCase(),
            r
        ]));
    return rows.map((row)=>{
        const hit = byCode.get(String(row[resolve.column] ?? '').trim().toLowerCase());
        if (!hit) return row;
        const out = {
            ...row
        };
        for (const [target, source] of Object.entries(resolve.into))if (hit[source] != null) out[target] = String(hit[source]);
        return out;
    });
}
const IMPORT_MAX_ROWS = 2000;
function todoSources(modules, perms) {
    return modules.flatMap((m)=>(m.todo ?? []).flatMap((spec)=>{
            const screen = m.screens[spec.screen];
            if (!screen || screen.kind !== 'list') return [];
            const gate = spec.perm ?? (spec.actions ?? screen.rowActions)?.[0]?.perm;
            return hasPerm(perms, gate) && hasPerm(perms, screen.perm) ? [
                {
                    module: m,
                    spec,
                    screen
                }
            ] : [];
        }));
}
function todoActions(item, screen, perms) {
    return (item.spec.actions ?? screen.rowActions ?? []).filter((a)=>hasPerm(perms, a.perm) && matches(item.row, a.when));
}
const DAY_MS = 86_400_000;
/** Bangkok calendar day number of an ISO date/datetime (dates without time are taken as Bangkok dates). */ function bangkokDay(v) {
    const ms = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00+07:00`) : Date.parse(v);
    return Math.floor((ms + 7 * 3_600_000) / DAY_MS);
}
function waitingText(since, now = new Date()) {
    const t = /^\d{4}-\d{2}-\d{2}$/.test(since) ? Date.parse(`${since}T00:00:00+07:00`) : Date.parse(since);
    if (Number.isNaN(t)) return undefined;
    const min = Math.floor((now.getTime() - t) / 60_000);
    if (min < 5) return 'เพิ่งส่ง';
    if (min < 60) return `รอ ${min} นาที`;
    if (min < 24 * 60) return `รอ ${Math.floor(min / 60)} ชม.`;
    return `รอ ${Math.floor(min / (24 * 60))} วัน`;
}
function dueText(due, now = new Date()) {
    if (Number.isNaN(Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due}T00:00:00+07:00` : due))) return undefined;
    const diff = bangkokDay(due) - bangkokDay(now.toISOString());
    if (diff < 0) return {
        text: `เกินกำหนด ${-diff} วัน`,
        overdue: true
    };
    if (diff === 0) return {
        text: 'ครบกำหนดวันนี้',
        overdue: false
    };
    if (diff === 1) return {
        text: 'ครบกำหนดพรุ่งนี้',
        overdue: false
    };
    return {
        text: `อีก ${diff} วัน`,
        overdue: false
    };
}
function buildTodo(groups, now = new Date()) {
    const seen = new Set();
    const out = [];
    for (const { module, spec, rows } of groups){
        for (const row of rows){
            const id = String(row.id ?? '');
            const key = `${module}:${id || JSON.stringify(row).slice(0, 80)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const sub = (Array.isArray(spec.subtitle) ? spec.subtitle : spec.subtitle ? [
                spec.subtitle
            ] : []).map((f)=>get(row, f)).filter((v)=>v !== null && v !== undefined && v !== '').join(' · ');
            const since = spec.since ? get(row, spec.since) : undefined;
            const due = spec.due ? get(row, spec.due) : undefined;
            const d = typeof due === 'string' && due ? dueText(due, now) : undefined;
            const amount = spec.amount !== undefined ? Number(get(row, spec.amount)) : NaN;
            out.push({
                key,
                module,
                spec,
                row,
                title: String(get(row, spec.title) ?? ''),
                subtitle: sub,
                amount: Number.isFinite(amount) && amount !== 0 ? amount : undefined,
                waiting: typeof since === 'string' && since ? waitingText(since, now) : undefined,
                dueText: d?.text,
                overdue: !!d?.overdue,
                urgent: !!spec.urgent && matches(row, spec.urgent),
                sinceMs: typeof since === 'string' && since ? Date.parse(since) || Infinity : Infinity
            });
        }
    }
    const rank = (i)=>i.overdue ? 0 : i.urgent ? 1 : i.dueText === 'ครบกำหนดวันนี้' ? 2 : 3;
    return out.sort((a, b)=>rank(a) - rank(b) || a.sinceMs - b.sinceMs);
}
const AREAS = [
    {
        id: 'operations',
        label: 'การผลิต & คลัง'
    },
    {
        id: 'commercial',
        label: 'ขาย & ลูกค้า'
    },
    {
        id: 'finance',
        label: 'บัญชี & การเงิน'
    },
    {
        id: 'office',
        label: 'สำนักงาน & บุคคล'
    },
    {
        id: 'service',
        label: 'บริการ & โครงการ'
    },
    {
        id: 'settings',
        label: 'ตั้งค่า'
    }
];
const MODULE_AREA = {
    inventory: 'operations',
    purchasing: 'operations',
    production: 'operations',
    quality: 'operations',
    maintenance: 'operations',
    costing: 'operations',
    crm: 'commercial',
    sales: 'commercial',
    approvals: 'office',
    expense: 'office',
    hr: 'office',
    booking: 'office',
    assets: 'office',
    helpdesk: 'service',
    projects: 'service',
    contracts: 'service',
    accounting: 'finance',
    payroll: 'finance',
    automation: 'settings',
    'master-data': 'settings',
    identity: 'settings'
};
function moduleArea(ui) {
    return ui.area ?? MODULE_AREA[ui.module] ?? 'operations';
}
function areaLabel(id) {
    return AREAS.find((a)=>a.id === id)?.label ?? id;
}
function groupByArea(items, moduleOf) {
    return AREAS.map((a)=>({
            area: a.id,
            label: a.label,
            items: items.filter((i)=>moduleArea(moduleOf(i)) === a.id)
        })).filter((g)=>g.items.length);
}
const ICONS = [
    'users',
    'database',
    'boxes',
    'shopping-cart',
    'receipt',
    'factory',
    'wrench',
    'calculator',
    'zap',
    'bot',
    'gauge',
    'stamp',
    'id-card',
    'wallet',
    'package',
    'handshake',
    'life-buoy',
    'kanban',
    'shield-check',
    'calendar',
    'book',
    'banknote',
    'file-signature'
];
function defineUi(ui) {
    return ui;
}
function listRows(screen, res) {
    const v = screen.rows ? get(res, screen.rows) : res;
    return Array.isArray(v) ? v : [];
}
function pickRecord(lookup, rows, text) {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    const val = (r, k)=>String(get(r, k) ?? '').toLowerCase();
    return rows.find((r)=>lookup.label.some((k)=>val(r, k) === t)) ?? rows.find((r)=>lookup.label.some((k)=>val(r, k).startsWith(t))) ?? rows.find((r)=>lookup.label.some((k)=>val(r, k).includes(t))) ?? null;
}
function commandTarget(cmd, screen, record, rest) {
    const query = {};
    if (cmd.arg?.openId && record) return {
        screen: cmd.screen,
        id: String(get(record, cmd.arg.openId)),
        query
    };
    const isForm = screen?.kind === 'form';
    if (cmd.arg && record) {
        const { assign, label } = cmd.arg.lookup;
        for (const [target, source] of Object.entries(assign)){
            const v = get(record, source);
            if (v !== undefined && v !== null && v !== '') query[isForm ? `f.${target}` : target] = String(v);
        }
        const first = Object.keys(assign)[0];
        if (isForm && first) query[`l.${first}`] = label.map((k)=>get(record, k)).filter(Boolean).join('  ');
    }
    if (cmd.restField && rest) query[isForm ? `f.${cmd.restField}` : cmd.restField] = rest;
    return {
        screen: cmd.screen,
        query
    };
}
function prefillFromQuery(entries) {
    const out = {};
    for (const [k, v] of entries){
        if (k.startsWith('f.')) out[k.slice(2)] = v;
        else if (k.startsWith('l.')) out[`__label.${k.slice(2)}`] = v;
    }
    return out;
}
function get(obj, path) {
    return path.split('.').reduce((o, k)=>o == null ? undefined : o[k], obj);
}
function fillPath(template, ...sources) {
    return template.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name)=>{
        for (const s of sources){
            const v = s?.[name];
            if (v !== undefined && v !== null && v !== '') return encodeURIComponent(String(v));
        }
        throw new Error(`Missing value for :${name} in ${template}`);
    });
}
function commandExample(modules, perms) {
    const usable = modules.flatMap((m)=>(m.commands ?? []).filter((x)=>x.example && hasPerm(perms, x.perm) && hasPerm(perms, m.screens[x.screen]?.perm)));
    // a full sentence ("ลา ป่วย ไข้หวัด") teaches more than a bare keyword ("สลิป")
    return (usable.find((c)=>c.example.trim().includes(' ')) ?? usable[0])?.example ?? null;
}
function matchCommand(commands, text) {
    const t = text.trim();
    let best = null;
    for (const c of commands)for (const kw of c.keywords){
        if (t.toLowerCase().startsWith(kw.toLowerCase()) && (!best || kw.length > best.kw.length)) best = {
            command: c,
            kw
        };
    }
    if (!best) return null;
    const after = t.slice(best.kw.length).trim();
    if (!best.command.arg) return {
        command: best.command,
        argText: '',
        rest: after
    };
    const [argText = '', ...rest] = after.split(/\s+/);
    return {
        command: best.command,
        argText,
        rest: rest.join(' ')
    };
}
function routeParams(template, id) {
    if (!id) return {};
    const first = template.match(/:([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
    return first ? {
        [first]: id,
        id
    } : {
        id
    };
}
function flowPosition(flow, record) {
    const v = get(record, flow.field);
    const exit = flow.exits?.find((e)=>e.value === v);
    if (exit) return {
        index: -1,
        exit
    };
    return {
        index: flow.steps.findIndex((st)=>st.value === v)
    };
}
function hasPerm(perms, perm) {
    if (!perm) return true;
    // back-office permissions (`<module>.ops.<action>`) are never granted by a wildcard — same rule as the kernel
    if (perm.split('.')[1] === 'ops') return perms.includes(perm);
    const mod = perm.split('.')[0];
    return perms.includes('*') || perms.includes(perm) || perms.includes(`${mod}.*`);
}
function matches(record, cond) {
    if (!cond) return true;
    return cond.in.includes(get(record, cond.field) ?? null);
}
const STATUS_TH = {
    draft: 'ร่าง',
    approved: 'อนุมัติแล้ว',
    partially_received: 'รับบางส่วน',
    received: 'รับครบ',
    cancelled: 'ยกเลิก',
    confirmed: 'ยืนยันแล้ว',
    delivered: 'ส่งของแล้ว',
    invoiced: 'ออกใบกำกับแล้ว',
    planned: 'วางแผน',
    released: 'ปล่อยงาน',
    completed: 'เสร็จสิ้น',
    open: 'รอดำเนินการ',
    in_progress: 'กำลังดำเนินการ',
    done: 'เสร็จแล้ว',
    running: 'เดินเครื่อง',
    down: 'เครื่องเสีย',
    retired: 'เลิกใช้',
    receive: 'รับเข้า',
    issue: 'จ่ายออก',
    transfer_in: 'โอนเข้า',
    transfer_out: 'โอนออก',
    adjust: 'ปรับปรุง',
    breakdown: 'แจ้งเสีย',
    pm: 'PM',
    purchase: 'จากการซื้อ',
    manual: 'กำหนดเอง',
    raw: 'วัตถุดิบ',
    semi: 'กึ่งสำเร็จรูป',
    finished: 'สินค้าสำเร็จรูป',
    spare: 'อะไหล่',
    service: 'บริการ',
    customer: 'ลูกค้า',
    supplier: 'ผู้ขาย',
    both: 'ลูกค้าและผู้ขาย',
    failed: 'ล้มเหลว',
    skipped: 'ข้าม',
    inventory: 'คลังสินค้า',
    purchasing: 'จัดซื้อ',
    sales: 'ขาย',
    production: 'ผลิต',
    maintenance: 'ซ่อมบำรุง',
    info: 'ข้อมูล',
    warn: 'เตือน',
    stop: 'ด่วน',
    ok: 'สำเร็จ',
    // workflow statuses shared by the business modules
    pending: 'รออนุมัติ',
    submitted: 'ส่งแล้ว',
    rejected: 'ไม่อนุมัติ',
    returned: 'ส่งกลับแก้ไข',
    paid: 'จ่ายแล้ว',
    requested: 'ขอเบิก',
    cleared: 'เคลียร์แล้ว',
    sent: 'ส่งแล้ว',
    accepted: 'ตอบรับ',
    expired: 'หมดอายุ',
    new: 'ใหม่',
    contacted: 'ติดต่อแล้ว',
    qualified: 'มีโอกาส',
    converted: 'แปลงเป็นโอกาสขาย',
    lost: 'สูญหาย/ไม่สำเร็จ',
    prospect: 'สนใจ',
    proposal: 'เสนอราคา',
    negotiation: 'ต่อรอง',
    won: 'ปิดการขายได้',
    waiting: 'รอลูกค้า',
    resolved: 'แก้ไขแล้ว',
    closed: 'ปิดแล้ว',
    investigating: 'กำลังตรวจสอบ',
    action: 'ดำเนินการแก้ไข',
    verified: 'ยืนยันผลแล้ว',
    active: 'ใช้งาน',
    probation: 'ทดลองงาน',
    resigned: 'ลาออก',
    present: 'มาทำงาน',
    late: 'สาย',
    leave: 'ลา',
    absent: 'ขาดงาน',
    not_in: 'ยังไม่ลงเวลา',
    off: 'วันหยุด',
    self: 'ตนเอง',
    admin: 'ผู้ดูแล',
    planning: 'วางแผน',
    on_hold: 'พักไว้',
    todo: 'ยังไม่เริ่ม',
    doing: 'กำลังทำ',
    review: 'รอตรวจ',
    in_use: 'ใช้งานอยู่',
    in_storage: 'เก็บในคลัง',
    in_repair: 'ส่งซ่อม',
    disposed: 'จำหน่ายแล้ว',
    missing: 'ไม่พบ',
    unexpected: 'ไม่อยู่ในรายการ',
    sold: 'ขาย',
    scrapped: 'ทำลาย',
    donated: 'บริจาค',
    straight_line: 'เส้นตรง',
    none: 'ไม่คิด',
    low: 'ต่ำ',
    normal: 'ปกติ',
    high: 'สูง',
    urgent: 'ด่วนมาก',
    pass: 'ผ่าน',
    fail: 'ไม่ผ่าน',
    conditional: 'ผ่านแบบมีเงื่อนไข',
    minor: 'เล็กน้อย',
    major: 'สำคัญ',
    critical: 'วิกฤต',
    room: 'ห้อง',
    vehicle: 'รถ',
    equipment: 'อุปกรณ์'
};
function statusTh(status) {
    const st = status ?? '';
    return STATUS_TH[st] ?? st;
}
function statusTone(status) {
    if ([
        'received',
        'delivered',
        'invoiced',
        'completed',
        'done',
        'running',
        'ok',
        'paid',
        'accepted',
        'won',
        'resolved',
        'closed',
        'verified',
        'pass',
        'present',
        'cleared',
        'converted',
        'in_use'
    ].includes(status)) return 'ok';
    if ([
        'approved',
        'confirmed',
        'released',
        'in_progress',
        'submitted',
        'sent',
        'doing',
        'review',
        'active',
        'investigating',
        'action',
        'proposal',
        'negotiation',
        'qualified',
        'contacted'
    ].includes(status)) return 'progress';
    if ([
        'partially_received',
        'warn',
        'skipped',
        'pending',
        'returned',
        'waiting',
        'late',
        'on_hold',
        'conditional',
        'in_repair',
        'probation',
        'expired',
        'high'
    ].includes(status)) return 'warn';
    if ([
        'cancelled',
        'down',
        'retired',
        'failed',
        'stop',
        'rejected',
        'lost',
        'fail',
        'absent',
        'missing',
        'urgent',
        'critical',
        'disposed',
        'resigned'
    ].includes(status)) return 'stop';
    return 'neutral';
}
function formatDate(value, withTime = false) {
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString('th-TH-u-ca-buddhist', withTime ? {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    } : {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}
function formatValue(value, format = 'text', labels) {
    if (value === null || value === undefined || value === '') return '—';
    switch(format){
        case 'money':
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$number$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatNumber"])(Number(value), 'money');
        case 'accounting':
            return accounting(Number(value));
        case 'qty':
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$number$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatNumber"])(Number(value), 'qty');
        case 'number':
            return (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$number$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatNumber"])(Number(value));
        case 'percent':
            return `${(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$number$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatNumber"])(Number(value))}%`;
        case 'date':
            return formatDate(String(value));
        case 'month':
            {
                const d = new Date(`${String(value).slice(0, 7)}-01T00:00:00`);
                return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('th-TH-u-ca-buddhist', {
                    month: 'short',
                    year: '2-digit'
                });
            }
        case 'datetime':
            return formatDate(String(value), true);
        case 'status':
        case 'label':
            return labels?.[String(value)] ?? STATUS_TH[String(value)] ?? String(value);
        case 'boolean':
            return value ? 'ใช่' : 'ไม่ใช่';
        case 'list':
            return Array.isArray(value) ? value.join(', ') || '—' : String(value);
        default:
            return String(value);
    }
}
function initialValues(fields) {
    const out = {};
    for (const f of fields){
        if (f.default !== undefined) out[f.name] = f.default;
        else if (f.type === 'boolean') out[f.name] = false;
        else if (f.type === 'multilookup' || f.type === 'permissions') out[f.name] = [];
    }
    return out;
}
function toBody(fields, values, lines, lineValues) {
    const clean = (fs, v)=>{
        const out = {};
        for (const [k, raw] of Object.entries(v)){
            const f = fs.find((x)=>x.name === k);
            if (k.startsWith('__')) continue;
            if (raw === '' || raw === undefined || raw === null) continue;
            if (f?.type === 'number') {
                // commas are only on screen: "1,250.50" is 1250.5; a lone "-" is nothing yet
                const plain = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$number$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["plainNumber"])(raw);
                if (plain !== '') out[k] = Number(plain);
                continue;
            }
            out[k] = raw;
        }
        return out;
    };
    const body = clean(fields, values);
    if (lines) body[lines.name] = (lineValues ?? []).map((l)=>clean(lines.fields, l)).filter((l)=>Object.keys(l).length > 0);
    return body;
}
function missingRequired(fields, values) {
    const errors = {};
    for (const f of fields){
        if (!f.required) continue;
        const v = values[f.name];
        if (v === undefined || v === null || v === '' || Array.isArray(v) && v.length === 0) errors[f.name] = `กรอก${f.label}`;
    }
    return errors;
}
function endpointsOf(ui) {
    const out = [];
    const lookups = (fs, where)=>{
        for (const f of fs ?? [])if (f.lookup) out.push({
            module: f.lookup.module ?? ui.module,
            method: 'GET',
            path: f.lookup.path,
            where: `${where}.${f.name}`
        });
    };
    const action = (a, where)=>{
        out.push({
            module: ui.module,
            method: a.method,
            path: a.endpoint,
            where: `${where}.${a.id}`
        });
        lookups(a.fields, `${where}.${a.id}`);
        lookups(a.lines?.fields, `${where}.${a.id}.lines`);
    };
    for (const w of ui.widgets ?? [])out.push({
        module: ui.module,
        method: 'GET',
        path: w.endpoint,
        where: `${ui.module}.widget.${w.id}`
    });
    if (ui.notifications) {
        out.push({
            module: ui.module,
            method: 'GET',
            path: ui.notifications.endpoint,
            where: `${ui.module}.notifications`
        });
        out.push({
            module: ui.module,
            method: 'POST',
            path: ui.notifications.readEndpoint,
            where: `${ui.module}.notifications.read`
        });
        out.push({
            module: ui.module,
            method: 'POST',
            path: ui.notifications.readAllEndpoint,
            where: `${ui.module}.notifications.readAll`
        });
    }
    for (const sr of ui.search ?? [])out.push({
        module: ui.module,
        method: 'GET',
        path: sr.endpoint,
        where: `${ui.module}.search.${sr.id}`
    });
    for (const t of ui.todo ?? [])t.actions?.forEach((a)=>action(a, `${ui.module}.todo.${t.id}`));
    for (const c of ui.commands ?? [])if (c.arg) out.push({
        module: c.arg.lookup.module ?? ui.module,
        method: 'GET',
        path: c.arg.lookup.path,
        where: `${ui.module}.command.${c.id}`
    });
    for (const [id, s] of Object.entries(ui.screens)){
        const where = `${ui.module}.${id}`;
        if (s.kind === 'list') {
            out.push({
                module: ui.module,
                method: 'GET',
                path: s.endpoint,
                where
            });
            if (s.import) out.push({
                module: ui.module,
                method: 'POST',
                path: s.import.endpoint,
                where: `${where}.import`
            });
            lookups(s.filters, where);
            s.actions?.forEach((a)=>action(a, where));
            s.rowActions?.forEach((a)=>action(a, `${where}.row`));
        } else if (s.kind === 'form') {
            out.push({
                module: ui.module,
                method: s.method,
                path: s.endpoint,
                where
            });
            if (s.load) out.push({
                module: ui.module,
                method: 'GET',
                path: s.load,
                where: `${where}.load`
            });
            lookups(s.fields, where);
            lookups(s.lines?.fields, `${where}.lines`);
        } else {
            out.push({
                module: ui.module,
                method: 'GET',
                path: s.endpoint,
                where
            });
            s.actions?.forEach((a)=>action(a, where));
            if (s.attachments) {
                out.push({
                    module: ui.module,
                    method: 'GET',
                    path: '/_attachments',
                    where: `${where}.attachments`
                });
                out.push({
                    module: ui.module,
                    method: 'POST',
                    path: '/_attachments',
                    where: `${where}.attachments.upload`
                });
            }
        }
    }
    return out;
}
function brokenLinks(ui) {
    const problems = [];
    for (const [id, s] of Object.entries(ui.screens)){
        if (s.kind !== 'list' || !s.import) continue;
        if (!s.import.columns.length) problems.push(`${ui.module}: ${id}.import has no columns`);
        const keys = new Set();
        const names = new Map();
        for (const col of s.import.columns){
            if (keys.has(col.key)) problems.push(`${ui.module}: ${id}.import column "${col.key}" is declared twice`);
            keys.add(col.key);
            for (const n of [
                headerKey(col.key),
                headerKey(col.label)
            ]){
                const prev = names.get(n);
                if (prev !== undefined && prev !== col.key) problems.push(`${ui.module}: ${id}.import header "${n}" matches both "${prev}" and "${col.key}"`);
                names.set(n, col.key);
            }
        }
    }
    return [
        ...problems,
        ...brokenScreenLinks(ui)
    ];
}
function brokenScreenLinks(ui) {
    const ids = new Set(Object.keys(ui.screens));
    const refs = ui.menu.map((m)=>[
            m.screen,
            `menu "${m.label}"`
        ]);
    const todoProblems = [];
    for (const t of ui.todo ?? []){
        const s = ui.screens[t.screen];
        if (!s) refs.push([
            t.screen,
            `todo.${t.id}`
        ]);
        else if (s.kind !== 'list') todoProblems.push(`${ui.module}: todo.${t.id} must use a list screen, "${t.screen}" is a ${s.kind}`);
        else if (!(t.actions ?? s.rowActions)?.length && !s.rowLink) todoProblems.push(`${ui.module}: todo.${t.id} has no buttons and no rowLink`);
    }
    for (const [id, s] of Object.entries(ui.screens)){
        if (s.kind === 'list') {
            if (s.create) refs.push([
                s.create,
                `${id}.create`
            ]);
            if (s.rowLink) refs.push([
                s.rowLink.screen,
                `${id}.rowLink`
            ]);
            for (const [v, target] of Object.entries(s.rowLink?.byField?.screens ?? {}))refs.push([
                target,
                `${id}.rowLink.byField.${v}`
            ]);
            [
                ...s.actions ?? [],
                ...s.rowActions ?? []
            ].forEach((a)=>a.then && refs.push([
                    a.then.screen,
                    `${id}.${a.id}.then`
                ]));
            if (s.kanban) {
                const values = s.kanban.lanes.map((l)=>l.value);
                if (!values.length) todoProblems.push(`${ui.module}: ${id}.kanban has no lanes`);
                if (new Set(values).size !== values.length) todoProblems.push(`${ui.module}: ${id}.kanban has two lanes with the same value`);
                for (const m of s.kanban.moves ?? []){
                    for (const v of [
                        m.to,
                        ...m.from ?? []
                    ])if (!values.includes(v)) todoProblems.push(`${ui.module}: ${id}.kanban move "${m.action.id}" uses unknown lane "${v}"`);
                    if (m.action.then) refs.push([
                        m.action.then.screen,
                        `${id}.kanban.${m.action.id}.then`
                    ]);
                }
            }
        }
        if (s.kind === 'form' && s.after) refs.push([
            s.after.screen,
            `${id}.after`
        ]);
        if (s.kind === 'detail') {
            if (s.edit) refs.push([
                s.edit,
                `${id}.edit`
            ]);
            s.actions?.forEach((a)=>a.then && refs.push([
                    a.then.screen,
                    `${id}.${a.id}.then`
                ]));
        }
    }
    for (const sr of ui.search ?? [])refs.push([
        sr.screen,
        `search.${sr.id}`
    ]);
    for (const c of ui.commands ?? [])refs.push([
        c.screen,
        `command.${c.id}`
    ]);
    for (const w of ui.widgets ?? []){
        if (w.href) refs.push([
            w.href,
            `widget.${w.id}.href`
        ]);
        if ((w.kind === 'pipeline' || w.kind === 'floor3d') && w.link) refs.push([
            w.link.screen,
            `widget.${w.id}.link`
        ]);
    }
    return [
        ...todoProblems,
        ...refs.filter(([screen])=>!ids.has(screen)).map(([screen, where])=>`${ui.module}: ${where} points to unknown screen "${screen}"`)
    ];
}
function kanbanLanes(spec, rows) {
    const lanes = spec.lanes.map((l)=>({
            value: l.value,
            label: l.label,
            closed: !!l.closed,
            rows: [],
            total: spec.amount ? 0 : null
        }));
    const byValue = new Map(lanes.map((l)=>[
            l.value,
            l
        ]));
    for (const row of rows){
        const lane = byValue.get(String(get(row, spec.field) ?? ''));
        if (!lane) continue;
        lane.rows.push(row);
        if (spec.amount && lane.total !== null) {
            const n = Number(get(row, spec.amount.key));
            lane.total += Number.isFinite(n) ? n : 0;
        }
    }
    return lanes;
}
function kanbanMove(spec, row, to, perms) {
    const from = String(get(row, spec.field) ?? '');
    if (from === to) return undefined;
    return (spec.moves ?? []).find((m)=>m.to === to && (!m.from || m.from.includes(from)) && matches(row, m.action.when) && hasPerm(perms, m.action.perm));
}
function initials(name) {
    if (typeof name !== 'string') return '';
    const first = (w)=>[
            ...w.replace(/^[เแโใไ]+/, '')
        ][0] ?? '';
    return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(first).join('').toUpperCase();
}
/* ---------------- CSV export / import (pure; used by web lists and the import dialog) ---------------- */ const pad2 = (n)=>String(n).padStart(2, '0');
function csvDate(value, withTime = false) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (m) return `${m[3]}/${m[2]}/${Number(m[1]) + 543}`;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    const date = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear() + 543}`;
    return withTime ? `${date} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : date;
}
const NUMERIC_FORMATS = [
    'money',
    'accounting',
    'qty',
    'number',
    'percent'
];
function isNumericFormat(format) {
    return !!format && NUMERIC_FORMATS.includes(format);
}
function csvValue(value, format = 'text', labels) {
    if (value === null || value === undefined || value === '') return '';
    switch(format){
        case 'money':
        case 'accounting':
        case 'qty':
        case 'number':
        case 'percent':
            {
                const n = Number(value);
                if (!Number.isFinite(n)) return String(value);
                return format === 'money' || format === 'accounting' ? n.toFixed((0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$number$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNumberFormat"])().moneyDecimals) : String(n);
            }
        case 'date':
            return csvDate(String(value));
        case 'datetime':
            return csvDate(String(value), true);
        case 'month':
            {
                const m = /^(\d{4})-(\d{2})/.exec(String(value));
                return m ? `${m[2]}/${Number(m[1]) + 543}` : String(value);
            }
        case 'status':
        case 'label':
        case 'boolean':
        case 'list':
            return formatValue(value, format, labels);
        default:
            return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
}
function csvCell(text, numeric = false) {
    let t = text;
    // a "numeric" column only skips the guard when the cell really is a number (security review 0.3, SEC-13)
    const isNumber = numeric && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(t);
    if (!isNumber && /^[=+\-@\t\r＝＋－＠]/.test(t)) t = `'${t}`;
    return /[",\r\n;]/.test(t) || /^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}
function toCsv(columns, rows, labels) {
    const lines = [
        columns.map((c)=>csvCell(c.label)).join(',')
    ];
    for (const r of rows){
        lines.push(columns.map((c)=>csvCell(csvValue(get(r, c.key), c.format, labels), NUMERIC_FORMATS.includes(c.format ?? 'text'))).join(','));
    }
    return `﻿${lines.join('\r\n')}\r\n`;
}
function csvTemplate(spec) {
    return `﻿${spec.columns.map((c)=>csvCell(c.label)).join(',')}\r\n`;
}
function detectDelimiter(text) {
    const first = text.slice(0, text.search(/\r|\n/) === -1 ? undefined : text.search(/\r|\n/));
    const unquoted = first.replace(/"[^"]*"/g, '');
    const counts = [
        ',',
        ';',
        '\t'
    ].map((d)=>[
            d,
            unquoted.split(d).length - 1
        ]);
    const best = counts.reduce((a, b)=>b[1] > a[1] ? b : a);
    return best[1] > 0 ? best[0] : ',';
}
function parseCsv(input, delimiter) {
    const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
    if (!text) return [];
    const d = delimiter ?? detectDelimiter(text);
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for(let i = 0; i < text.length; i++){
        const ch = text[i];
        if (quoted) {
            if (ch !== '"') cell += ch;
            else if (text[i + 1] === '"') {
                cell += '"';
                i++;
            } else quoted = false;
        } else if (ch === '"' && cell === '') quoted = true;
        else if (ch === d) {
            row.push(cell);
            cell = '';
        } else if (ch === '\r' || ch === '\n') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
        } else cell += ch;
    }
    if (cell !== '' || row.length) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}
function headerKey(text) {
    return text.replace(/^﻿/, '').replace(/\*\s*$/, '').trim().replace(/\s+/g, ' ').toLowerCase();
}
function mapImportRows(columns, table) {
    const [header = [], ...body] = table;
    const byName = new Map();
    for (const c of columns){
        byName.set(headerKey(c.label), c.key);
        byName.set(headerKey(c.key), c.key);
    }
    const keys = header.map((h)=>byName.get(headerKey(h)));
    const found = new Set(keys.filter(Boolean));
    const rows = [];
    const lines = [];
    body.forEach((rec, i)=>{
        if (!rec.some((v)=>v.trim() !== '')) return;
        const out = {};
        rec.forEach((v, ci)=>{
            const key = keys[ci];
            const val = v.trim();
            if (key && val !== '' && out[key] === undefined) out[key] = val;
        });
        rows.push(out);
        lines.push(i + 2);
    });
    return {
        rows,
        lines,
        missing: columns.filter((c)=>c.required && !found.has(c.key)),
        ignored: header.filter((h, i)=>h.trim() !== '' && !keys[i])
    };
}
function filterRows(rows, columns, text, labels) {
    const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return rows;
    return rows.filter((r)=>{
        const hay = columns.map((c)=>{
            const v = get(r, c.key);
            return v === null || v === undefined ? '' : `${String(v)} ${formatValue(v, c.format, labels)}`;
        }).join(' ').toLowerCase();
        return words.every((w)=>hay.includes(w));
    });
}
function filtersToQuery(values) {
    const qs = new URLSearchParams();
    for (const k of Object.keys(values).sort()){
        const v = values[k];
        if (v !== undefined && v !== null && v !== '' && v !== false) qs.set(k, String(v));
    }
    return qs.toString();
}
const COPY_LABELS = [
    'ต้นฉบับ',
    'สำเนา'
];
function isPrintable(screen) {
    return screen.kind === 'detail' && (!!screen.print || !!screen.printable);
}
function printSpec(screen, companySignatures = []) {
    if (!isPrintable(screen)) return null;
    const p = screen.print ?? {};
    const boxes = (p.signatures ?? (p.signers ? [] : companySignatures)).map((x)=>typeof x === 'string' ? {
            label: x.trim()
        } : {
            ...x,
            label: x.label.trim()
        }).filter((x)=>x.label);
    return {
        title: p.title?.trim() || screen.title,
        signatures: boxes,
        ...p.signers ? {
            signers: p.signers
        } : {},
        copyLabel: !!p.copyLabel,
        legal: p.legal ?? 'none',
        footer: p.footer ?? (p.legal === 'tax-invoice' ? 'payment' : false)
    };
}
function printsOnPaper(f) {
    if (f.print === false) return false;
    if (f.format === 'status') return f.print === true;
    return true;
}
function looksLikeCompany(name) {
    return /^\s*(บริษัท|ห้างหุ้นส่วน|บจก\.?|บมจ\.?|หจก\.?)/.test(name ?? '');
}
function isJuristicTaxId(id) {
    const d = (id ?? '').replace(/[\s-]/g, '');
    return /^0\d{12}$/.test(d);
}
function buyerProblems(buyer, legal) {
    if (legal !== 'tax-invoice' || !buyer) return [];
    const out = [];
    if (!buyer.taxId && looksLikeCompany(buyer.name)) out.push('ลูกค้าไม่มีเลขผู้เสียภาษี — ใบกำกับภาษีแบบเต็มต้องระบุ');
    if (buyer.taxId && isJuristicTaxId(buyer.taxId) && !buyer.branch) out.push('ลูกค้าไม่ได้ระบุสาขา — ใบกำกับภาษีจะพิมพ์ว่า "สำนักงานใหญ่" (แก้ที่ข้อมูลลูกค้าถ้าเป็นสาขาอื่น)');
    return out;
}
function buyerBranchText(buyer) {
    if (buyer.branch) return branchText(buyer.branch);
    return isJuristicTaxId(buyer.taxId) ? branchText('00000') : '';
}
function signatureBoxes(spec, record) {
    const text = (v)=>v === null || v === undefined || v === '' ? undefined : String(v);
    const out = spec.signatures.map((b)=>({
            label: b.label,
            name: b.name ? text(get(record, b.name)) : undefined
        }));
    if (spec.signers) {
        const rows = get(record, spec.signers.path);
        const list = Array.isArray(rows) ? rows : [];
        list.forEach((row, i)=>out.push({
                label: list.length > 1 ? `${spec.signers.label} ขั้นที่ ${i + 1}` : spec.signers.label,
                name: spec.signers.name ? text(get(row, spec.signers.name)) : undefined
            }));
    }
    return out;
}
function branchText(branch) {
    const b = (branch ?? '').trim();
    if (!b) return '';
    if (b === '00000') return 'สำนักงานใหญ่';
    return /^\d{5}$/.test(b) ? `สาขาที่ ${b}` : b;
}
function formatTaxId(id) {
    const d = (id ?? '').replace(/[\s-]/g, '');
    return /^\d{13}$/.test(d) ? `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}` : id ?? '';
}
const PARTY_PATHS = {
    name: [
        'customer.name',
        'buyer.name',
        'customer_name',
        'customerName',
        'buyer_name',
        'partner_name'
    ],
    address: [
        'customer.address',
        'buyer.address',
        'customer_address',
        'customerAddress',
        'buyer_address'
    ],
    taxId: [
        'customer.taxId',
        'customer.tax_id',
        'buyer.taxId',
        'buyer.tax_id',
        'customer_tax_id',
        'customerTaxId',
        'buyer_tax_id'
    ],
    branch: [
        'customer.branch',
        'buyer.branch',
        'customer_branch',
        'customerBranch',
        'buyer_branch'
    ]
};
function buyerInfo(record) {
    const out = {
        keys: []
    };
    for (const [field, paths] of Object.entries(PARTY_PATHS)){
        for (const path of paths){
            const v = get(record, path);
            if (v !== null && v !== undefined && String(v).trim() !== '') {
                out[field] = String(v);
                out.keys.push(path);
                break;
            }
        }
    }
    return out.name ? out : null;
}
function companyProblems(company, legal) {
    const out = [];
    if (!company || company.configured === false) out.push('ยังไม่ได้ตั้งค่าข้อมูลบริษัท — หัวกระดาษจะมีแค่ชื่อบริษัท');
    if (legal === 'tax-invoice') {
        if (!company?.tax_id) out.push('ข้อมูลบริษัทยังไม่มีเลขประจำตัวผู้เสียภาษี — ใบกำกับภาษีที่ไม่มีเลขนี้ใช้ไม่ได้ตามมาตรา 86/4');
        if (!company?.address) out.push('ข้อมูลบริษัทยังไม่มีที่อยู่ — ใบกำกับภาษีต้องมีที่อยู่ผู้ขาย');
    }
    return out;
}
function companyContactLine(company) {
    if (!company) return '';
    return [
        company.phone && `โทร ${company.phone}`,
        company.email && `อีเมล ${company.email}`,
        company.website
    ].filter(Boolean).join(' · ');
}
const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
const ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.xlsx,.docx,.csv,.txt';
function attachmentRef(entity, id) {
    return `${entity}:${id}`;
}
function fileKind(contentType) {
    if (/^image\/(jpeg|png|webp)$/.test(contentType)) return 'image';
    if (contentType === 'application/pdf') return 'pdf';
    if (contentType.includes('spreadsheet') || contentType === 'text/csv') return 'sheet';
    if (contentType.includes('wordprocessing')) return 'doc';
    if (contentType.startsWith('text/')) return 'text';
    return 'file';
}
function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`;
}
function permPrefix(module) {
    return module.split('-')[0];
}
function auditPerm(module) {
    return `${permPrefix(module)}.audit.read`;
}
const AUDIT_VERBS = {
    submit: 'ส่ง',
    approve: 'อนุมัติ',
    reject: 'ไม่อนุมัติ',
    return: 'ส่งกลับแก้ไข',
    cancel: 'ยกเลิก',
    pay: 'จ่าย',
    close: 'ปิด',
    receive: 'รับของ',
    start: 'เริ่ม',
    complete: 'เสร็จ',
    reopen: 'เปิดใหม่',
    assign: 'มอบหมาย',
    clear: 'เคลียร์',
    post: 'ลงบัญชี',
    void: 'ยกเลิก'
};
function auditActionLabel(row) {
    if (row.route === '/_attachments') return 'แนบไฟล์';
    if (row.route.startsWith('/_attachments/')) return 'ลบไฟล์แนบ';
    const last = row.route.split('/').filter(Boolean).pop() ?? '';
    if (!last.startsWith(':') && AUDIT_VERBS[last]) return AUDIT_VERBS[last];
    return row.method === 'POST' ? last.startsWith(':') ? 'บันทึก' : 'สร้าง' : row.method === 'DELETE' ? 'ลบ' : 'แก้ไข';
}
/* ---------------- reports: accounting numbers, row styles, totals, date ranges ---------------- */ /** 10^decimals of money in the company's number format: 100 for satang. */ const moneyUnit = ()=>10 ** (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$number$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNumberFormat"])().moneyDecimals;
function accounting(n) {
    if (!Number.isFinite(n)) return String(n);
    const unit = moneyUnit();
    const r = Math.round(n * unit) / unit;
    if (r === 0) return '–';
    return r < 0 ? `(${(0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$number$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatNumber"])(-r, 'money')})` : (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$number$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatNumber"])(r, 'money');
}
function isNegative(value, format) {
    return (format === 'accounting' || format === 'money') && value !== null && value !== '' && Math.round(Number(value) * moneyUnit()) < 0;
}
function reportRowStyle(spec, row) {
    if (!spec) return null;
    const kind = get(row, spec.rowKind ?? 'kind');
    if (kind === undefined || kind === null) return null;
    const k = String(kind);
    if (spec.heading?.includes(k)) return 'heading';
    if (spec.total?.includes(k)) return 'total';
    if (spec.subtotal?.includes(k)) return 'subtotal';
    if (spec.muted?.includes(k)) return 'muted';
    return null;
}
function reportIndent(spec, row) {
    if (!spec) return 0;
    if (spec.indentFrom) {
        const n = Number(get(row, spec.indentFrom));
        return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 6) : 0;
    }
    const kind = get(row, spec.rowKind ?? 'kind');
    return kind === undefined || kind === null ? 0 : spec.levels?.[String(kind)] ?? 0;
}
function columnTotals(columns, rows, spec) {
    const keys = columns.filter((c)=>c.total).map((c)=>c.key);
    if (!keys.length) return null;
    const out = Object.fromEntries(keys.map((k)=>[
            k,
            0
        ]));
    for (const r of rows){
        if (reportRowStyle(spec, r)) continue;
        for (const k of keys){
            const v = Number(get(r, k));
            if (Number.isFinite(v)) out[k] += v;
        }
    }
    // rounded to satang as before, or finer when the company shows money or quantities with more decimals
    const nf = (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$number$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["getNumberFormat"])();
    const unit = 10 ** Math.max(2, nf.moneyDecimals, nf.qtyDecimals);
    for (const k of keys)out[k] = Math.round(out[k] * unit) / unit;
    return out;
}
function repeatsAbove(rows, index, key) {
    if (index === 0) return false;
    const v = get(rows[index], key);
    return v !== null && v !== undefined && v !== '' && v === get(rows[index - 1], key);
}
function fillTemplate(template, data) {
    let missing = false;
    const text = template.replace(/\{([\w.]+)(?:\|(\w+))?\}/g, (_, path, pipe)=>{
        const v = get(data, path);
        if (v === null || v === undefined || v === '') {
            missing = true;
            return '';
        }
        if (pipe === 'date') return formatDate(String(v));
        if (pipe === 'month') {
            const d = new Date(`${String(v).slice(0, 7)}-01T00:00:00`);
            return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('th-TH-u-ca-buddhist', {
                month: 'long',
                year: 'numeric'
            });
        }
        if (pipe === 'money') return (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$number$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["formatNumber"])(Number(v), 'money');
        if (pipe === 'year') {
            const y = Number(v);
            return Number.isFinite(y) ? String(y < 2400 ? y + 543 : y) : String(v);
        }
        return String(v);
    });
    return missing ? '' : text;
}
function filterGroups(fields) {
    const out = [];
    for(let i = 0; i < fields.length; i++){
        const f = fields[i];
        const n = fields[i + 1];
        if (f.type === 'date' && n?.type === 'date' && /from$/i.test(f.name) && /to$/i.test(n.name) && f.name.replace(/from$/i, '') === n.name.replace(/to$/i, '')) {
            out.push({
                kind: 'range',
                from: f,
                to: n
            });
            i++;
        } else out.push({
            kind: 'field',
            field: f
        });
    }
    return out;
}
const iso = (d)=>`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function datePresets(today = new Date()) {
    const y = today.getFullYear();
    const m = today.getMonth();
    const q = Math.floor(m / 3) * 3;
    return [
        {
            id: 'month',
            label: 'เดือนนี้',
            from: iso(new Date(y, m, 1)),
            to: iso(new Date(y, m + 1, 0))
        },
        {
            id: 'last-month',
            label: 'เดือนก่อน',
            from: iso(new Date(y, m - 1, 1)),
            to: iso(new Date(y, m, 0))
        },
        {
            id: 'quarter',
            label: 'ไตรมาสนี้',
            from: iso(new Date(y, q, 1)),
            to: iso(new Date(y, q + 3, 0))
        },
        {
            id: 'year',
            label: 'ปีนี้',
            from: iso(new Date(y, 0, 1)),
            to: iso(new Date(y, 11, 31))
        }
    ];
}
function factSections(fields) {
    const out = [];
    for (const f of fields){
        if (f.section || !out.length) out.push({
            title: f.section,
            fields: []
        });
        out[out.length - 1].fields.push(f);
    }
    return out;
}
const AUDIT_HIDDEN = new Set([
    'ref',
    'contentType',
    'dataBase64',
    'password',
    'token'
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function auditDetailText(row) {
    const parts = (row.summary_text ?? '').split(' · ').map((p)=>p.trim()).filter(Boolean);
    const kept = parts.filter((p)=>{
        const i = p.indexOf(': ');
        if (i < 0) return true;
        const key = p.slice(0, i);
        const value = p.slice(i + 2).replace(/^[\w-]+:/, '');
        return !AUDIT_HIDDEN.has(key) && !UUID.test(value) && !/Id$/.test(key);
    });
    if (row.route === '/_attachments') {
        const file = kept.find((p)=>p.startsWith('fileName: '));
        if (file) return `ไฟล์ ${file.slice('fileName: '.length)}`;
    }
    return kept.join(' · ');
}
const AI_FILL_TYPES = [
    'text',
    'textarea',
    'email',
    'number',
    'date',
    'month',
    'select',
    'lookup'
];
function aiFillable(fields) {
    return fields.filter((f)=>AI_FILL_TYPES.includes(f.type));
}
/** 2569 -> 2026: Thai papers print Buddhist-era years. */ const ceYear = (y)=>y > 2400 ? y - 543 : y;
function toIsoDate(raw) {
    const s = String(raw ?? '').trim();
    let y, m, d;
    let r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (r) [y, m, d] = [
        Number(r[1]),
        Number(r[2]),
        Number(r[3])
    ];
    else if (r = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)) [d, m, y] = [
        Number(r[1]),
        Number(r[2]),
        Number(r[3])
    ];
    else return undefined;
    y = ceYear(y);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
    return `${y}-${pad2(m)}-${pad2(d)}`;
}
function cleanAiValue(field, raw) {
    if (raw === undefined || raw === null || raw === '') return undefined;
    switch(field.type){
        case 'number':
            {
                const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[,\s]|บาท|฿/g, ''));
                const unit = 10 ** (field.format || field.step !== undefined ? (0, __TURBOPACK__imported__module__$5b$project$5d2f$packages$2f$ui$2d$schema$2f$src$2f$number$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["numberSpec"])(field).decimals : 2);
                return Number.isFinite(n) ? Math.round(n * unit) / unit : undefined;
            }
        case 'date':
            return toIsoDate(raw);
        case 'month':
            {
                const r = String(raw).trim().match(/^(\d{4})-(\d{1,2})/);
                if (!r || Number(r[2]) < 1 || Number(r[2]) > 12) return undefined;
                return `${ceYear(Number(r[1]))}-${pad2(Number(r[2]))}`;
            }
        case 'select':
            {
                const s = String(raw).trim();
                return field.options?.find((o)=>o.value === s || o.label === s)?.value;
            }
        case 'lookup':
        case 'text':
        case 'textarea':
        case 'email':
            {
                const s = String(raw).trim().slice(0, field.type === 'textarea' ? 2000 : 500);
                return s || undefined;
            }
        default:
            return undefined;
    }
}
function cleanListFilters(filters, raw) {
    const out = {};
    for (const f of filters ?? []){
        const v = f.type === 'boolean' ? raw[f.name] === true || raw[f.name] === 'true' ? 'true' : undefined : cleanAiValue(f, raw[f.name]);
        if (v !== undefined) out[f.name] = String(v);
    }
    return out;
}
const emptyValue = (v)=>v === undefined || v === null || v === '' || Array.isArray(v) && v.length === 0;
function isBlankLine(line, blank = {}) {
    return Object.entries(line).every(([k, v])=>k.startsWith('__') || emptyValue(v) || v === blank[k]);
}
function mergeAiFill(current, proposal, blankLine = {}) {
    const values = {
        ...current.values
    };
    let filled = 0;
    for (const [k, v] of Object.entries(proposal.values)){
        if (k.startsWith('__') || emptyValue(v) || !emptyValue(values[k])) continue;
        values[k] = v;
        filled++;
        if (proposal.values[`__label.${k}`] !== undefined) values[`__label.${k}`] = proposal.values[`__label.${k}`];
    }
    const kept = current.lines.filter((l)=>!isBlankLine(l, blankLine));
    const added = proposal.lines.filter((l)=>!isBlankLine(l)).map((l)=>({
            ...blankLine,
            ...l
        }));
    filled += added.length;
    const lines = added.length ? [
        ...kept,
        ...added
    ] : current.lines;
    return {
        values,
        lines,
        filled
    };
}
const THAI_MONTHS = [
    'มกราคม',
    'กุมภาพันธ์',
    'มีนาคม',
    'เมษายน',
    'พฤษภาคม',
    'มิถุนายน',
    'กรกฎาคม',
    'สิงหาคม',
    'กันยายน',
    'ตุลาคม',
    'พฤศจิกายน',
    'ธันวาคม'
];
const THAI_MONTHS_SHORT = [
    'ม.ค.',
    'ก.พ.',
    'มี.ค.',
    'เม.ย.',
    'พ.ค.',
    'มิ.ย.',
    'ก.ค.',
    'ส.ค.',
    'ก.ย.',
    'ต.ค.',
    'พ.ย.',
    'ธ.ค.'
];
const THAI_WEEKDAYS_SHORT = [
    'อา',
    'จ',
    'อ',
    'พ',
    'พฤ',
    'ศ',
    'ส'
];
/**
 * Year as typed → Christian year. 4 digits ≥ 2400 = พ.ศ. (−543); other 4 digits = ค.ศ.;
 * 2 digits = the last two digits of a พ.ศ. year ("69" → 2569 → 2026), the way Thai forms abbreviate it.
 */ function typedYear(text) {
    if (/^\d{4}$/.test(text)) {
        const y = Number(text);
        return y >= 2400 ? y - 543 : y;
    }
    if (/^\d{2}$/.test(text)) return 2500 + Number(text) - 543;
    return null;
}
/** "ตุลาคม" / "ต.ค." / "ต.ค" → 9 (0-based), unknown → -1. */ function thaiMonthIndex(name) {
    const full = THAI_MONTHS.indexOf(name);
    if (full >= 0) return full;
    const bare = name.replace(/\.$/, '');
    return THAI_MONTHS_SHORT.findIndex((x)=>x.replace(/\.$/, '') === bare);
}
const validDate = (y, m, d)=>{
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return null;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d > last ? null : `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};
function dateInputText(isoDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? '');
    return m ? `${m[3]}/${m[2]}/${Number(m[1]) + 543}` : '';
}
function parseDateInput(text) {
    const t = text.trim().replace(/\s+/g, ' ');
    if (!t) return null;
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
    if (m) {
        const y = typedYear(m[1]);
        return y === null ? null : validDate(y, Number(m[2]), Number(m[3]));
    }
    m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(t) ?? /^(\d{2})(\d{2})(\d{4})$/.exec(t);
    if (m) {
        const y = typedYear(m[3]);
        return y === null ? null : validDate(y, Number(m[2]), Number(m[1]));
    }
    m = /^(\d{1,2}) ?([ก-๙.]+) ?(\d{2}|\d{4})$/.exec(t);
    if (m) {
        const idx = thaiMonthIndex(m[2]);
        const y = typedYear(m[3]);
        return idx < 0 || y === null ? null : validDate(y, idx + 1, Number(m[1]));
    }
    return null;
}
function monthInputText(period) {
    const m = /^(\d{4})-(\d{2})$/.exec(period ?? '');
    return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${THAI_MONTHS[Number(m[2]) - 1]} ${Number(m[1]) + 543}` : '';
}
function parseMonthInput(text) {
    const t = text.trim().replace(/\s+/g, ' ');
    let m = /^(\d{4})-(\d{1,2})$/.exec(t);
    let month, y;
    if (m) {
        y = typedYear(m[1]);
        month = Number(m[2]);
    } else if (m = /^(\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(t)) {
        y = typedYear(m[2]);
        month = Number(m[1]);
    } else if (m = /^([ก-๙.]+) ?(\d{2}|\d{4})$/.exec(t)) {
        y = typedYear(m[2]);
        month = thaiMonthIndex(m[1]) + 1;
    } else return null;
    if (y === null || y < 1900 || y > 2200 || month < 1 || month > 12) return null;
    return `${y}-${String(month).padStart(2, '0')}`;
}
function calendarWeeks(year, month) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const start = new Date(first.getTime() - first.getUTCDay() * 86_400_000);
    const weeks = [];
    for(let w = 0; w < 6; w++){
        const row = [];
        for(let d = 0; d < 7; d++){
            const day = new Date(start.getTime() + (w * 7 + d) * 86_400_000);
            row.push({
                iso: day.toISOString().slice(0, 10),
                inMonth: day.getUTCMonth() === month - 1
            });
        }
        weeks.push(row);
    }
    return weeks;
}
const PLAN_REMIND_DAYS = 7;
function planNotice(p) {
    if (!p || p.daysLeft === null) return null;
    if (p.status === 'trial') {
        return {
            text: p.daysLeft > 0 ? `ทดลองใช้แพ็กเกจ ${p.planName} เหลือ ${p.daysLeft} วัน` : `ทดลองใช้แพ็กเกจ ${p.planName} วันสุดท้าย`,
            urgent: p.daysLeft <= 3
        };
    }
    if (p.status === 'active' && p.daysLeft <= PLAN_REMIND_DAYS) return {
        text: `ใกล้ครบกำหนดชำระค่าบริการ — ใช้งานได้อีก ${p.daysLeft} วัน`,
        urgent: p.daysLeft <= 3
    };
    return null;
}
;
;
const openingDocColumns = (side)=>[
        {
            key: 'partnerCode',
            label: side === 'customer' ? 'รหัสลูกค้า' : 'รหัสผู้ขาย',
            required: true
        },
        {
            key: 'docNo',
            label: side === 'customer' ? 'เลขที่ใบแจ้งหนี้เดิม' : 'เลขที่ใบแจ้งหนี้ของผู้ขาย',
            required: true
        },
        {
            key: 'docDate',
            label: 'วันที่เอกสาร',
            required: true
        },
        {
            key: 'dueDate',
            label: 'ครบกำหนดชำระ'
        },
        {
            key: 'amount',
            label: 'ยอดค้าง (รวม VAT)',
            required: true
        },
        {
            key: 'note',
            label: 'หมายเหตุ'
        }
    ];
const OPENING_PARTNER_RESOLVE = {
    module: 'master-data',
    endpoint: '/partners/resolve',
    column: 'partnerCode',
    into: {
        partnerId: 'id',
        partnerName: 'name',
        partnerKind: 'kind',
        taxId: 'tax_id',
        branch: 'branch',
        address: 'address'
    }
};
function checkOpeningDocs(rows, side, today) {
    const errors = [];
    const valid = [];
    const seen = new Map();
    const who = side === 'customer' ? 'ลูกค้า' : 'ผู้ขาย';
    rows.forEach((raw, i)=>{
        const row = i + 1;
        const str = (k)=>String(raw[k] ?? '').trim();
        const before = errors.length;
        const code = str('partnerCode');
        const kind = str('partnerKind');
        if (!code) errors.push({
            row,
            field: 'partnerCode',
            message: `กรอกรหัส${who}`
        });
        else if (!/^[0-9a-f-]{36}$/i.test(str('partnerId'))) errors.push({
            row,
            field: 'partnerCode',
            message: `ไม่พบรหัส${who} ${code} ในข้อมูลหลัก — นำเข้าคู่ค้าก่อน`
        });
        else if (kind && kind !== side && kind !== 'both') errors.push({
            row,
            field: 'partnerCode',
            message: `${code} ไม่ได้ตั้งเป็น${who} — แก้ "เป็น" ในข้อมูลคู่ค้า`
        });
        const docNo = str('docNo');
        if (!docNo) errors.push({
            row,
            field: 'docNo',
            message: 'กรอกเลขที่เอกสาร'
        });
        else if (docNo.length > 50) errors.push({
            row,
            field: 'docNo',
            message: 'เลขที่เอกสารยาวเกิน 50 ตัวอักษร'
        });
        const docDate = parseDateInput(str('docDate'));
        if (!docDate) errors.push({
            row,
            field: 'docDate',
            message: 'วันที่ไม่ถูกต้อง — ใช้ วัน/เดือน/ปี เช่น 15/10/2569'
        });
        else if (docDate > today) errors.push({
            row,
            field: 'docDate',
            message: 'วันที่เอกสารอยู่ในอนาคต'
        });
        const dueRaw = str('dueDate');
        const dueDate = dueRaw ? parseDateInput(dueRaw) : docDate;
        if (dueRaw && !dueDate) errors.push({
            row,
            field: 'dueDate',
            message: 'วันครบกำหนดไม่ถูกต้อง'
        });
        else if (docDate && dueDate && dueDate < docDate) errors.push({
            row,
            field: 'dueDate',
            message: 'ครบกำหนดก่อนวันที่เอกสาร'
        });
        const amount = Number(str('amount').replace(/,/g, ''));
        if (!str('amount') || !Number.isFinite(amount) || amount <= 0) errors.push({
            row,
            field: 'amount',
            message: 'ยอดค้างต้องเป็นตัวเลขมากกว่า 0'
        });
        else if (Math.round(amount * 100) !== amount * 100 && Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) errors.push({
            row,
            field: 'amount',
            message: 'ยอดเงินมีทศนิยมได้ 2 ตำแหน่ง'
        });
        if (errors.length > before) return;
        const key = side === 'customer' ? docNo.toLowerCase() : `${code.toLowerCase()}|${docNo.toLowerCase()}`;
        if (seen.has(key)) return void errors.push({
            row,
            field: 'docNo',
            message: `เลขที่ ${docNo} ซ้ำกับแถวที่ ${seen.get(key)}`
        });
        seen.set(key, row);
        valid.push({
            row,
            partnerId: str('partnerId'),
            partnerCode: code,
            partnerName: str('partnerName') || code,
            taxId: str('taxId') || null,
            branch: str('branch') || null,
            address: str('address') || null,
            docNo,
            docDate: docDate,
            dueDate: dueDate,
            amount: Math.round(amount * 100) / 100,
            note: str('note').slice(0, 500) || null
        });
    });
    return {
        valid,
        errors
    };
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/ui-schema/src/number.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/**
 * Numbers as the company writes them: thousands comma, decimals of money and decimals of quantities.
 * The setting lives in the company profile (identity `GET /company`: `number_comma`, `money_decimals`, `qty_decimals`),
 * the apps load it once and put it here; `formatValue` (display) and the number inputs (typing) both read it.
 *
 * What a form keeps and what goes to the API is always a plain number ("1250.5") — commas are only on screen.
 * Pure and browser-safe, like the rest of this package.
 */ __turbopack_context__.s([
    "DEFAULT_NUMBER_FORMAT",
    ()=>DEFAULT_NUMBER_FORMAT,
    "NUMBER_DECIMALS_MAX",
    ()=>NUMBER_DECIMALS_MAX,
    "caretAfterTyping",
    ()=>caretAfterTyping,
    "formatNumber",
    ()=>formatNumber,
    "getNumberFormat",
    ()=>getNumberFormat,
    "numberFormatOf",
    ()=>numberFormatOf,
    "numberSpec",
    ()=>numberSpec,
    "plainNumber",
    ()=>plainNumber,
    "setNumberFormat",
    ()=>setNumberFormat,
    "showNumber",
    ()=>showNumber,
    "stepDecimals",
    ()=>stepDecimals,
    "subscribeNumberFormat",
    ()=>subscribeNumberFormat,
    "typeNumber",
    ()=>typeNumber
]);
const DEFAULT_NUMBER_FORMAT = Object.freeze({
    comma: true,
    moneyDecimals: 2,
    qtyDecimals: 2
});
const NUMBER_DECIMALS_MAX = 4;
/** Decimals a plain number may carry (a field without `format` and without `step`). */ const PLAIN_DECIMALS_TYPED = 6;
/** Decimals a plain number is shown with at most (as `qty` was before the company setting existed). */ const PLAIN_DECIMALS_SHOWN = 4;
const decimalsOr = (v, fallback)=>{
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    return Number.isInteger(n) && n >= 0 && n <= NUMBER_DECIMALS_MAX ? n : fallback;
};
function numberFormatOf(company) {
    return {
        comma: typeof company?.number_comma === 'boolean' ? company.number_comma : DEFAULT_NUMBER_FORMAT.comma,
        moneyDecimals: decimalsOr(company?.money_decimals, DEFAULT_NUMBER_FORMAT.moneyDecimals),
        qtyDecimals: decimalsOr(company?.qty_decimals, DEFAULT_NUMBER_FORMAT.qtyDecimals)
    };
}
let current = DEFAULT_NUMBER_FORMAT;
const listeners = new Set();
function getNumberFormat() {
    return current;
}
function setNumberFormat(next) {
    const nf = {
        comma: typeof next?.comma === 'boolean' ? next.comma : DEFAULT_NUMBER_FORMAT.comma,
        moneyDecimals: decimalsOr(next?.moneyDecimals, DEFAULT_NUMBER_FORMAT.moneyDecimals),
        qtyDecimals: decimalsOr(next?.qtyDecimals, DEFAULT_NUMBER_FORMAT.qtyDecimals)
    };
    if (nf.comma === current.comma && nf.moneyDecimals === current.moneyDecimals && nf.qtyDecimals === current.qtyDecimals) return;
    current = nf;
    for (const tell of [
        ...listeners
    ])tell();
}
function subscribeNumberFormat(listener) {
    listeners.add(listener);
    return ()=>{
        listeners.delete(listener);
    };
}
const formatters = new Map();
/** "1,250.50": between `min` and `max` decimals, grouped or not. A value that rounds to zero never shows a minus sign. */ function write(n, min, max, comma) {
    const id = `${min}:${max}:${comma ? 1 : 0}`;
    let f = formatters.get(id);
    if (!f) {
        // en-US = Latin digits, "," thousands and "." decimals on every engine (browsers, Node, Hermes)
        f = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: min,
            maximumFractionDigits: max,
            useGrouping: comma
        });
        formatters.set(id, f);
    }
    const text = f.format(n);
    return /^-[0.,]*$/.test(text) ? text.slice(1) : text;
}
function formatNumber(value, kind = 'number', nf = current) {
    if (kind === 'money') return write(value, nf.moneyDecimals, nf.moneyDecimals, nf.comma);
    if (kind === 'qty') return write(value, nf.qtyDecimals, nf.qtyDecimals, nf.comma);
    return write(value, 0, PLAIN_DECIMALS_SHOWN, nf.comma);
}
function stepDecimals(step) {
    if (!Number.isFinite(step) || step <= 0) return PLAIN_DECIMALS_TYPED;
    const frac = step.toFixed(8).replace(/0+$/, '').split('.')[1] ?? '';
    return frac.length;
}
function numberSpec(field, nf = current) {
    const comma = field.comma === false ? false : nf.comma;
    if (field.format === 'money') return {
        decimals: nf.moneyDecimals,
        pad: nf.moneyDecimals,
        fixed: true,
        comma
    };
    if (field.format === 'qty') return {
        decimals: nf.qtyDecimals,
        pad: nf.qtyDecimals,
        fixed: true,
        comma
    };
    return {
        decimals: field.step !== undefined ? stepDecimals(field.step) : PLAIN_DECIMALS_TYPED,
        pad: 0,
        fixed: false,
        comma
    };
}
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
function typeNumber(text, spec) {
    const s = String(text ?? '').replace(/[๐-๙]/g, (d)=>String(THAI_DIGITS.indexOf(d)));
    const negative = /^[^0-9.]*-/.test(s);
    const kept = s.replace(/[^0-9.]/g, '');
    const dot = kept.indexOf('.');
    let whole = (dot < 0 ? kept : kept.slice(0, dot)).replace(/^0+(?=\d)/, '');
    const frac = dot < 0 ? '' : kept.slice(dot + 1).replace(/\./g, '').slice(0, spec.decimals);
    const point = dot >= 0 && spec.decimals > 0;
    if (point && whole === '') whole = '0';
    if (spec.comma) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${negative ? '-' : ''}${whole}${point ? `.${frac}` : ''}`;
}
function plainNumber(text) {
    const s = String(text ?? '').replace(/[,\s]/g, '').replace(/\.$/, '');
    return s === '-' ? '' : s;
}
function showNumber(value, spec) {
    if (value === null || value === undefined || value === '') return '';
    const plain = plainNumber(value);
    const n = plain === '' ? NaN : Number(plain);
    if (!Number.isFinite(n)) return String(value);
    return spec.fixed ? write(n, spec.pad, spec.decimals, spec.comma) : write(n, 0, PLAIN_DECIMALS_TYPED, spec.comma);
}
/** Digits, the decimal point and the minus sign: the characters of a number that stay when it is regrouped. */ const SIGNIFICANT = /[0-9๐-๙.\-]/;
function caretAfterTyping(before, caret, after) {
    let wanted = 0;
    for(let i = 0; i < Math.min(caret, before.length); i++)if (SIGNIFICANT.test(before[i])) wanted++;
    if (wanted === 0) return 0;
    let seen = 0;
    for(let i = 0; i < after.length; i++){
        if (SIGNIFICANT.test(after[i]) && ++seen === wanted) return i + 1;
    }
    return after.length;
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/packages/ui-schema/src/xlsx.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "XlsxError",
    ()=>XlsxError,
    "columnIndex",
    ()=>columnIndex,
    "isDateFormat",
    ()=>isDateFormat,
    "looksLikeXlsx",
    ()=>looksLikeXlsx,
    "readXlsx",
    ()=>readXlsx,
    "serialToIso",
    ()=>serialToIso,
    "unzip",
    ()=>unzip,
    "xlsxTemplate",
    ()=>xlsxTemplate,
    "xmlText",
    ()=>xmlText,
    "zip",
    ()=>zip
]);
/**
 * Excel files for the bulk imports, with no library: an .xlsx is a ZIP of XML files. Customers keep their item lists, customers
 * and stock counts in Excel; saving as CSV garbles Thai in Excel's default encoding and loses leading zeros, so the import screens
 * read .xlsx directly and hand out the template as .xlsx.
 *
 *   readXlsx(bytes)          first worksheet → string[][] (same shape as parseCsv), dates as YYYY-MM-DD
 *   xlsxTemplate(headers)    a workbook with one header row (bold, frozen, every column text so codes keep their zeros)
 *
 * Browser-safe and dependency-free like the rest of this package: only Uint8Array, TextDecoder/TextEncoder and
 * DecompressionStream('deflate-raw') (every current browser, Node ≥ 18). No formulas are evaluated: a formula cell gives the value
 * Excel saved with it.
 */ const u16 = (b, o)=>b[o] | b[o + 1] << 8;
const u32 = (b, o)=>(b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
class XlsxError extends Error {
}
async function unzip(bytes) {
    let eocd = -1;
    for(let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--){
        if (u32(bytes, i) === 0x06054b50) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new XlsxError('ไฟล์นี้ไม่ใช่ไฟล์ Excel (.xlsx) — ถ้าเป็นไฟล์ .xls รุ่นเก่า ให้เปิดใน Excel แล้วบันทึกเป็น .xlsx');
    const count = u16(bytes, eocd + 10);
    let p = u32(bytes, eocd + 16);
    const out = new Map();
    const dec = new TextDecoder();
    for(let n = 0; n < count; n++){
        if (u32(bytes, p) !== 0x02014b50) throw new XlsxError('ไฟล์ Excel เสียหาย อ่านไม่ได้');
        const method = u16(bytes, p + 10);
        const size = u32(bytes, p + 20);
        const nameLen = u16(bytes, p + 28);
        const extraLen = u16(bytes, p + 30);
        const commentLen = u16(bytes, p + 32);
        const local = u32(bytes, p + 42);
        const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;
        const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
        const data = bytes.subarray(start, start + size);
        if (method === 0) out.set(name, data);
        else if (method === 8) out.set(name, await inflate(data));
        else throw new XlsxError('ไฟล์ Excel ถูกบีบอัดแบบที่ระบบไม่รองรับ — บันทึกใหม่เป็น .xlsx');
    }
    return out;
}
async function inflate(data) {
    const stream = new Blob([
        data
    ]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
function xmlText(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h)=>String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d)=>String.fromCodePoint(Number(d))).replace(/&amp;/g, '&').replace(/_x([0-9A-F]{4})_/g, (_, h)=>String.fromCharCode(parseInt(h, 16)));
}
const attr = (tag, name)=>new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
/** all <t> texts inside one element (rich text runs are joined; phonetic <rPh> runs are skipped) */ const texts = (xml)=>[
        ...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)
    ].map((m)=>xmlText(m[1] ?? '')).join('');
function columnIndex(ref) {
    let n = 0;
    for (const ch of ref.replace(/\d+$/, '').toUpperCase())n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}
const BUILTIN_DATE_FORMATS = new Set([
    14,
    15,
    16,
    17,
    22,
    27,
    30,
    36,
    45,
    46,
    47,
    50,
    57
]);
function isDateFormat(code) {
    const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
    return /[dy]/i.test(bare) || /m{3,}/i.test(bare);
}
function serialToIso(serial, date1904 = false) {
    const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const days = Math.floor(serial + 1e-9);
    return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}
/** a number as the user typed it (no 0.30000000000000004) */ const plainNumber = (v)=>{
    const n = Number(v);
    return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : v;
};
async function readXlsx(bytes) {
    const files = await unzip(bytes);
    const dec = new TextDecoder();
    const file = (name)=>{
        const f = files.get(name);
        return f ? dec.decode(f) : undefined;
    };
    const workbook = file('xl/workbook.xml');
    if (!workbook) throw new XlsxError('ไฟล์นี้ไม่ใช่ไฟล์ Excel (.xlsx)');
    const date1904 = /<workbookPr\b[^>]*\sdate1904="(1|true)"/.test(workbook);
    const firstSheet = /<sheet\b[^>]*>/.exec(workbook)?.[0] ?? '';
    const rid = attr(firstSheet, 'r:id');
    const rels = file('xl/_rels/workbook.xml.rels') ?? '';
    const rel = [
        ...rels.matchAll(/<Relationship\b[^>]*>/g)
    ].map((m)=>m[0]).find((r)=>attr(r, 'Id') === rid);
    let target = rel && attr(rel, 'Target') || 'worksheets/sheet1.xml';
    target = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const sheet = file(target);
    if (!sheet) throw new XlsxError('ไม่พบแผ่นงานในไฟล์ Excel');
    const shared = [
        ...(file('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)
    ].map((m)=>texts(m[1]));
    const styles = file('xl/styles.xml') ?? '';
    const customFormats = new Map([
        ...styles.matchAll(/<numFmt\b[^>]*>/g)
    ].map((m)=>[
            Number(attr(m[0], 'numFmtId')),
            xmlText(attr(m[0], 'formatCode') ?? '')
        ]));
    const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
    const dateStyle = [
        ...cellXfs.matchAll(/<xf\b[^>]*\/?>/g)
    ].map((m)=>{
        const id = Number(attr(m[0], 'numFmtId') ?? 0);
        return BUILTIN_DATE_FORMATS.has(id) || customFormats.has(id) && isDateFormat(customFormats.get(id));
    });
    const rows = [];
    for (const r of sheet.matchAll(/<row\b([^>]*)(?:\/>|>([\s\S]*?)<\/row>)/g)){
        const rowNo = Number(attr(r[1], 'r') ?? rows.length + 1);
        while(rows.length < rowNo - 1)rows.push([]);
        const cells = [];
        for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
            const a = c[1];
            const body = c[2] ?? '';
            const ref = attr(a, 'r');
            const col = ref ? columnIndex(ref) : cells.length;
            const type = attr(a, 't') ?? 'n';
            const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
            let value = '';
            if (type === 's') value = shared[Number(v)] ?? '';
            else if (type === 'inlineStr') value = texts(body);
            else if (type === 'str' || type === 'e') value = xmlText(v ?? '');
            else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
            else if (v !== undefined) value = dateStyle[Number(attr(a, 's') ?? 0)] ? serialToIso(Number(v), date1904) : plainNumber(v);
            while(cells.length < col)cells.push('');
            cells[col] = value.trim();
        }
        while(cells.length && cells[cells.length - 1] === '')cells.pop();
        rows.push(cells);
    }
    while(rows.length && !rows[rows.length - 1].length)rows.pop();
    return rows;
}
const looksLikeXlsx = (bytes)=>bytes.length > 4 && u32(bytes, 0) === 0x04034b50;
/* ------------------------------------------------------------------ writing the template ------------------------------------------------------------------ */ const CRC_TABLE = (()=>{
    const t = new Uint32Array(256);
    for(let n = 0; n < 256; n++){
        let c = n;
        for(let k = 0; k < 8; k++)c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(b) {
    let c = 0xffffffff;
    for(let i = 0; i < b.length; i++)c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ c >>> 8;
    return (c ^ 0xffffffff) >>> 0;
}
function zip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [name, content] of files){
        const nameBytes = enc.encode(name);
        const data = enc.encode(content);
        const crc = crc32(data);
        const local = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true);
        lv.setUint16(4, 20, true);
        lv.setUint16(6, 0x0800, true); // UTF-8 names
        lv.setUint32(14, crc, true);
        lv.setUint32(18, data.length, true);
        lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true);
        local.set(nameBytes, 30);
        const cd = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(cd.buffer);
        cv.setUint32(0, 0x02014b50, true);
        cv.setUint16(4, 20, true);
        cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true);
        cv.setUint32(16, crc, true);
        cv.setUint32(20, data.length, true);
        cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true);
        cv.setUint32(42, offset, true);
        cd.set(nameBytes, 46);
        parts.push(local, data);
        central.push(cd);
        offset += local.length + data.length;
    }
    const cdSize = central.reduce((s, x)=>s + x.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    const all = [
        ...parts,
        ...central,
        end
    ];
    const out = new Uint8Array(all.reduce((s, x)=>s + x.length, 0));
    let p = 0;
    for (const x of all){
        out.set(x, p);
        p += x.length;
    }
    return out;
}
const esc = (s)=>s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i)=>(i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + i % 26);
function xlsxTemplate(headers, examples = [], sheetName = 'นำเข้า') {
    const row = (cells, r, style)=>`<row r="${r}">${cells.map((v, i)=>`<c r="${colName(i)}${r}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join('')}</row>`;
    const widths = headers.map((h, i)=>Math.min(60, Math.max(12, h.length + 4, ...examples.map((e)=>(e[i] ?? '').length + 2))));
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i)=>`<col min="${i + 1}" max="${i + 1}" width="${w}" style="2" customWidth="1"/>`).join('')}</cols>
<sheetData>${row(headers, 1, 1)}${examples.map((e, i)=>row(e, i + 2, 2)).join('')}</sheetData>
</worksheet>`;
    return zip([
        [
            '[Content_Types].xml',
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
        ],
        [
            '_rels/.rels',
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
        ],
        [
            'xl/workbook.xml',
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`
        ],
        [
            'xl/_rels/workbook.xml.rels',
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
        ],
        [
            'xl/styles.xml',
            `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`
        ],
        [
            'xl/worksheets/sheet1.xml',
            sheet
        ]
    ]);
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=packages_ui-schema_src_164__nn._.js.map