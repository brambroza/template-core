/**
 * Attachments — files (receipts, medical certificates, machine photos, quotations…) stored in the module's OWN database
 * (`_attachments`, tenant-isolated with row-level security like every business table).
 *
 * A module opts in through `ServiceDefinition.attachments`; the kernel then mounts
 *   GET    /_attachments?ref=<entity>:<id>          list (no content)
 *   POST   /_attachments { ref, fileName, contentType?, dataBase64 }
 *   GET    /_attachments/:id/content                the file (bearer token, or a short-lived signed link)
 *   GET    /_attachments/:id/link                   a signed link for clients that cannot send headers (mobile "open")
 *   DELETE /_attachments/:id                        uploader (with write perm) or `<module>.attachment.delete`
 * Modules that do not opt in have none of these routes (404).
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { hasPerm, verifyToken, type AuthContext } from './auth.ts';
import type { Client, Db } from './db.ts';
import { badRequest, conflict, forbidden, HttpError, notFound, parse, unauthorized } from './errors.ts';

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MAX_PER_RECORD = 30;
/** lifetime of a signed content link (`GET /_attachments/:id/link`) */
export const ATTACHMENT_LINK_TTL_SECONDS = 5 * 60;

/** one permission, or a list where any one is enough */
export type PermSpec = string | string[];

export interface AttachmentEntity {
  /** this module's table holding the record; `ref` ids are checked against `<table>.id` inside the tenant transaction */
  table: string;
  /** override the module-wide perms for this entity */
  read?: PermSpec;
  write?: PermSpec;
  /**
   * Row-level visibility (e.g. "staff only see their own claims"): load the record as this user and THROW to deny
   * (403/404). Reuse the module's own loader, e.g. `access: (c, a, id) => loadClaim(c, id, a)`.
   * When given, it replaces the plain existence check on `table`.
   */
  access?: (c: Client, a: AuthContext, id: string) => Promise<unknown>;
  /**
   * May files still be added to / removed from this record by this user? THROW (e.g. 409) to refuse — evidence of a paid claim is frozen.
   * Runs after `access` on upload and on a delete by the uploader; holders of `<module>.attachment.delete` may always delete.
   */
  writable?: (c: Client, a: AuthContext, id: string) => Promise<unknown>;
}

export interface AttachmentsSpec {
  /** who may list and open files (any of) */
  read: PermSpec;
  /** who may upload (any of); the uploader may also delete their own file */
  write: PermSpec;
  /** entity name used in `ref` ("claim" in "claim:<uuid>") -> table name or full spec */
  entities: Record<string, string | AttachmentEntity>;
}

/* ---------------- file types ---------------- */

interface FileType {
  ext: string[];
  type: string;
  /** shown in the browser (image/pdf) vs. always downloaded */
  inline: boolean;
  check: (b: Buffer) => boolean;
}

const at = (b: Buffer, offset: number, text: string) => b.subarray(offset, offset + text.length).toString('latin1') === text;
const isZip = (b: Buffer) => at(b, 0, 'PK\x03\x04');
/** plain text: no NUL bytes (binary files nearly always contain one) */
const isText = (b: Buffer) => !b.includes(0);
const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'];

export const ATTACHMENT_TYPES: readonly FileType[] = [
  { ext: ['jpg', 'jpeg'], type: 'image/jpeg', inline: true, check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: ['png'], type: 'image/png', inline: true, check: (b) => at(b, 0, '\x89PNG\r\n\x1a\n') },
  { ext: ['webp'], type: 'image/webp', inline: true, check: (b) => at(b, 0, 'RIFF') && at(b, 8, 'WEBP') },
  { ext: ['heic', 'heif'], type: 'image/heic', inline: false, check: (b) => at(b, 4, 'ftyp') && HEIF_BRANDS.includes(b.subarray(8, 12).toString('latin1')) },
  { ext: ['pdf'], type: 'application/pdf', inline: true, check: (b) => at(b, 0, '%PDF-') },
  { ext: ['xlsx'], type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', inline: false, check: isZip },
  { ext: ['docx'], type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', inline: false, check: isZip },
  { ext: ['csv'], type: 'text/csv', inline: false, check: isText },
  { ext: ['txt'], type: 'text/plain', inline: false, check: isText },
];

/** Safe display name: no path parts, control or Windows-reserved characters, at most 200 characters (keeps the extension). */
export function cleanFileName(name: string): string {
  const base = name.normalize('NFC').split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\x00-\x1f\x7f:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return clean.length > 200 ? clean.slice(clean.length - 200) : clean;
}

/**
 * Decide the stored type of an upload from its extension AND its first bytes (the client's content type is not trusted).
 * Throws 400 with a Thai message when the file is not an allowed type or its content does not match the extension.
 */
export function detectFileType(fileName: string, data: Buffer): FileType {
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase() : '';
  const t = ATTACHMENT_TYPES.find((x) => x.ext.includes(ext));
  if (!t) throw badRequest(`ไม่รองรับไฟล์ประเภทนี้ (รองรับ ${ATTACHMENT_TYPES.flatMap((x) => x.ext).join(', ')})`);
  if (!t.check(data)) throw badRequest(`เนื้อไฟล์ไม่ตรงกับนามสกุล .${ext}`);
  return t;
}

/** Decode base64 (a `data:…;base64,` prefix is accepted), enforcing the size limit before allocating. */
export function decodeBase64(input: string, max = ATTACHMENT_MAX_BYTES): Buffer {
  const s = input.replace(/^data:[^,]*;base64,/, '').replace(/\s+/g, '');
  if (!s || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) throw badRequest('ข้อมูลไฟล์ (base64) ไม่ถูกต้อง');
  const size = (s.length / 4) * 3 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);
  if (size > max) throw new HttpError(413, 'payload_too_large', `ไฟล์ใหญ่เกิน ${Math.round(max / 1024 / 1024)} MB`);
  if (size === 0) throw badRequest('ไฟล์ว่างเปล่า');
  return Buffer.from(s, 'base64');
}

/** RFC 6266 header with a UTF-8 name (Thai file names) and an ASCII fallback. */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'file';
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/* ---------------- refs, perms, signed links ---------------- */

const REF = /^([a-z][a-z0-9_-]{0,40}):([A-Za-z0-9_-]{1,64})$/;
const asList = (p: PermSpec) => (Array.isArray(p) ? p : [p]);
const anyPerm = (a: AuthContext, p: PermSpec) => asList(p).some((x) => hasPerm(a, x));
const requireAnyPerm = (a: AuthContext, p: PermSpec) => {
  if (!anyPerm(a, p)) throw forbidden(`Missing permission: ${asList(p).join(' | ')}`);
};

interface ResolvedEntity extends AttachmentEntity {
  name: string;
  read: PermSpec;
  write: PermSpec;
}

/** every permission an attachments spec mentions (for "declared in module.json" checks) */
export function attachmentPerms(spec: AttachmentsSpec, deletePerm: string): string[] {
  const all = [...asList(spec.read), ...asList(spec.write), deletePerm];
  for (const e of Object.values(spec.entities)) if (typeof e !== 'string') all.push(...asList(e.read ?? []), ...asList(e.write ?? []));
  return [...new Set(all)];
}

function signLink(secret: string, moduleId: string, tenantId: string, id: string, exp: number): string {
  return createHmac('sha256', secret).update(`att|${moduleId}|${tenantId}|${id}|${exp}`).digest('base64url');
}

/* ---------------- routes ---------------- */

declare module 'fastify' {
  interface FastifyRequest {
    /** record id written to `_audit.entity_id` instead of the route param (set by routes whose param is not the record) */
    auditEntityId: string | null;
  }
}

const Upload = z.object({
  ref: z.string().regex(REF, 'ref ต้องเป็น <entity>:<id>'),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().max(200).optional(),
  // ~ 5 MB * 4/3 plus slack for a data: prefix; the exact limit is checked after decoding
  dataBase64: z.string().min(1).max(Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4 + 200),
});
const IdParam = z.object({ id: z.string().uuid() });
const COLUMNS = 'id, ref, file_name, content_type, size, sha256, uploaded_by, uploaded_by_name, created_at';

export interface MountAttachmentsOptions {
  db: Db;
  moduleId: string;
  /** permission prefix of the module, e.g. "master" for master-data */
  permPrefix: string;
  jwtSecret: string;
  spec: AttachmentsSpec;
}

export function mountAttachments(app: FastifyInstance, o: MountAttachmentsOptions): void {
  const deletePerm = `${o.permPrefix}.attachment.delete`;
  const entities = new Map<string, ResolvedEntity>();
  for (const [name, e] of Object.entries(o.spec.entities)) {
    if (!/^[a-z][a-z0-9_-]{0,40}$/.test(name)) throw new Error(`${o.moduleId}: attachment entity "${name}" must be lower-case`);
    const spec = typeof e === 'string' ? { table: e } : e;
    if (!/^[a-z_][a-z0-9_]*$/.test(spec.table)) throw new Error(`${o.moduleId}: attachment entity "${name}" has an invalid table "${spec.table}"`);
    entities.set(name, { ...spec, name, read: spec.read ?? o.spec.read, write: spec.write ?? o.spec.write });
  }

  const resolve = (ref: string) => {
    const m = REF.exec(ref);
    const ent = m ? entities.get(m[1]) : undefined;
    if (!m || !ent) throw badRequest(`แนบไฟล์กับ "${ref.split(':')[0]}" ไม่ได้ในโมดูลนี้`);
    return { ent, entityId: m[2] };
  };

  /** the record must exist for this tenant (RLS) and be visible to this user */
  const checkRecord = async (c: Client, a: AuthContext, ent: ResolvedEntity, entityId: string) => {
    try {
      if (ent.access) await ent.access(c, a, entityId);
      else if (!(await c.query(`select 1 from ${ent.table} where id::text = $1`, [entityId])).rowCount) throw notFound('Record');
    } catch (e) {
      // a malformed id for a uuid column is simply "not found"
      if ((e as { code?: string }).code === '22P02') throw notFound('Record');
      throw e;
    }
  };

  /** `frozen` = the record's `writable` hook refuses changes now, so only `<module>.attachment.delete` may remove files */
  const view = (a: AuthContext, frozen = false) => (r: Record<string, any>) => {
    const { ent } = resolve(r.ref);
    return { ...r, can_delete: hasPerm(a, deletePerm) || (!frozen && r.uploaded_by === a.userId && anyPerm(a, ent.write)) };
  };

  app.get('/_attachments', async (req) => {
    const a = req.authCtx!;
    const { ref } = parse(z.object({ ref: z.string().regex(REF, 'ref ต้องเป็น <entity>:<id>') }), req.query);
    const { ent, entityId } = resolve(ref);
    requireAnyPerm(a, ent.read);
    return o.db.tx(a.tenantId, async (c) => {
      await checkRecord(c, a, ent, entityId);
      const rows = (await c.query(`select ${COLUMNS} from _attachments where ref = $1 order by created_at, id`, [ref])).rows;
      let frozen = false;
      if (ent.writable && rows.length) {
        await c.query('savepoint att_writable');
        try { await ent.writable(c, a, entityId); await c.query('release savepoint att_writable'); } catch { frozen = true; await c.query('rollback to savepoint att_writable'); }
      }
      return rows.map(view(a, frozen));
    });
  });

  app.post('/_attachments', { bodyLimit: Math.ceil(ATTACHMENT_MAX_BYTES / 3) * 4 + 64 * 1024 }, async (req, reply) => {
    const a = req.authCtx!;
    const b = parse(Upload, req.body);
    const { ent, entityId } = resolve(b.ref);
    requireAnyPerm(a, ent.write);
    const fileName = cleanFileName(b.fileName);
    if (!fileName) throw badRequest('ชื่อไฟล์ไม่ถูกต้อง');
    const data = decodeBase64(b.dataBase64);
    const type = detectFileType(fileName, data);
    req.auditEntityId = entityId;
    return o.db.tx(a.tenantId, async (c) => {
      await checkRecord(c, a, ent, entityId);
      if (ent.writable) await ent.writable(c, a, entityId);
      // serialize uploads to one record so the per-record cap holds under concurrency
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`_attachments:${b.ref}`]);
      const count = Number((await c.query('select count(*)::int as n from _attachments where ref = $1', [b.ref])).rows[0].n);
      if (count >= ATTACHMENT_MAX_PER_RECORD) throw conflict(`แนบไฟล์ได้ไม่เกิน ${ATTACHMENT_MAX_PER_RECORD} ไฟล์ต่อเอกสาร`);
      const row = (await c.query(
        `insert into _attachments (id, ref, file_name, content_type, size, sha256, data, uploaded_by, uploaded_by_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${COLUMNS}`,
        [randomUUID(), b.ref, fileName, type.type, data.length, createHash('sha256').update(data).digest('hex'), data, a.userId, a.userName ?? null],
      )).rows[0];
      reply.code(201);
      return view(a)(row);
    });
  });

  /** Signed, short-lived URL of the content (relative to the module), for clients that cannot send an Authorization header. */
  app.get('/_attachments/:id/link', async (req) => {
    const a = req.authCtx!;
    const { id } = parse(IdParam, req.params);
    await o.db.tx(a.tenantId, async (c) => {
      const row = await oneRow(c, id);
      const { ent, entityId } = resolve(row.ref);
      requireAnyPerm(a, ent.read);
      await checkRecord(c, a, ent, entityId);
    });
    const exp = Math.floor(Date.now() / 1000) + ATTACHMENT_LINK_TTL_SECONDS;
    const qs = new URLSearchParams({ t: a.tenantId, exp: String(exp), sig: signLink(o.jwtSecret, o.moduleId, a.tenantId, id, exp) });
    return { url: `/_attachments/${id}/content?${qs}`, expiresAt: new Date(exp * 1000).toISOString() };
  });

  // public at the hook level: authenticates itself with a bearer token OR a valid signed link
  app.get('/_attachments/:id/content', { config: { public: true } }, async (req, reply) => {
    const { id } = parse(IdParam, req.params);
    const q = req.query as { t?: string; exp?: string; sig?: string };
    let tenantId: string;
    let a: AuthContext | null = null;
    if (q.sig) {
      const exp = Number(q.exp);
      if (!q.t || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) throw unauthorized('ลิงก์ไฟล์หมดอายุ');
      const expected = Buffer.from(signLink(o.jwtSecret, o.moduleId, q.t, id, exp));
      const given = Buffer.from(q.sig);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized('ลิงก์ไฟล์ไม่ถูกต้อง');
      tenantId = q.t;
    } else {
      const h = req.headers.authorization;
      if (!h?.startsWith('Bearer ')) throw unauthorized();
      a = verifyToken(o.jwtSecret, h.slice(7));
      req.authCtx = a;
      tenantId = a.tenantId;
    }
    const row = await o.db.tx(tenantId, async (c) => {
      const r = (await c.query(`select ${COLUMNS}, data from _attachments where id = $1`, [id])).rows[0];
      if (!r) throw notFound('File');
      if (a) {
        const { ent, entityId } = resolve(r.ref);
        requireAnyPerm(a, ent.read);
        await checkRecord(c, a, ent, entityId);
      }
      return r;
    });
    return sendFile(reply, row);
  });

  app.delete('/_attachments/:id', async (req) => {
    const a = req.authCtx!;
    const { id } = parse(IdParam, req.params);
    return o.db.tx(a.tenantId, async (c) => {
      const row = await oneRow(c, id);
      const { ent, entityId } = resolve(row.ref);
      req.auditEntityId = entityId;
      if (!hasPerm(a, deletePerm)) {
        if (row.uploaded_by !== a.userId || !anyPerm(a, ent.write)) throw forbidden(`ลบได้เฉพาะผู้แนบไฟล์ หรือผู้มีสิทธิ์ ${deletePerm}`);
        await checkRecord(c, a, ent, entityId);
        if (ent.writable) await ent.writable(c, a, entityId);
      }
      await c.query('delete from _attachments where id = $1', [id]);
      return { id, ref: row.ref, file_name: row.file_name, deleted: true };
    });
  });
}

async function oneRow(c: Client, id: string): Promise<Record<string, any>> {
  const r = (await c.query(`select ${COLUMNS} from _attachments where id = $1`, [id])).rows[0];
  if (!r) throw notFound('File');
  return r;
}

function sendFile(reply: FastifyReply, row: Record<string, any>) {
  const t = ATTACHMENT_TYPES.find((x) => x.type === row.content_type);
  const inline = !!t?.inline;
  reply.header('content-type', row.content_type);
  reply.header('content-disposition', contentDisposition(inline ? 'inline' : 'attachment', row.file_name));
  reply.header('x-content-type-options', 'nosniff');
  reply.header('cache-control', 'private, max-age=300');
  // a stored file never runs script, even if a browser opened it as a page
  if (row.content_type !== 'application/pdf') reply.header('content-security-policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  return reply.send(row.data as Buffer);
}

