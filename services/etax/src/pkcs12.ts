/**
 * Minimal PKCS#12 (.p12 / .pfx, RFC 7292) reader built on node:crypto only — Node has no PKCS#12 parser, and this module
 * may not add npm dependencies. It reads what certificate authorities and Windows / OpenSSL exports produce in practice:
 *
 *   - DER and BER (indefinite lengths, constructed OCTET STRINGs — Windows exports use them)
 *   - PBES2 (PBKDF2 with HMAC-SHA1/256/384/512 + AES-128/192/256-CBC or DES-EDE3-CBC) — OpenSSL 3 default
 *   - PKCS#12 PBE pbeWithSHAAnd3-KeyTripleDES-CBC (legacy Windows / OpenSSL 1.x exports)
 *   - the MAC (HMAC with the RFC 7292 Appendix B key derivation) — a wrong password fails here with a clear Thai message
 *
 * Not supported (clear error): RC2 / RC4 encryption (OpenSSL 3 without the legacy provider cannot decrypt them;
 * re-export the file with AES), public-key-protected (non-password) PFX.
 *
 * The password is only used in memory for the duration of the call and is never stored.
 */
import { createDecipheriv, createHash, createHmac, createPrivateKey, pbkdf2Sync, X509Certificate, type KeyObject } from 'node:crypto';

/* ---------------- ASN.1 BER/DER reader ---------------- */

export interface Asn1 {
  /** first identifier octet (class + constructed bit + tag number for tags < 31) */
  tag: number;
  constructed: boolean;
  /** content octets; for a constructed OCTET STRING, the concatenated content of its parts */
  value: Buffer;
  children: Asn1[];
  /** the complete encoding of this element (header + content) — needed for MAC / signatures */
  raw: Buffer;
}

export class Pkcs12Error extends Error {}

function readLength(b: Buffer, pos: number): { len: number | null; pos: number } {
  if (pos >= b.length) throw new Pkcs12Error('ไฟล์ใบรับรองไม่สมบูรณ์ (ASN.1 สั้นเกินไป)');
  const first = b[pos++];
  if (first < 0x80) return { len: first, pos };
  if (first === 0x80) return { len: null, pos }; // indefinite (BER)
  const n = first & 0x7f;
  if (n > 4) throw new Pkcs12Error('ไฟล์ใบรับรองไม่ถูกต้อง (ความยาว ASN.1)');
  let len = 0;
  for (let i = 0; i < n; i++) len = len * 256 + b[pos++];
  return { len, pos };
}

function readElement(b: Buffer, start: number): { el: Asn1; end: number } {
  let pos = start;
  const tag = b[pos++];
  if ((tag & 0x1f) === 0x1f) throw new Pkcs12Error('ไฟล์ใบรับรองไม่ถูกต้อง (tag ASN.1 แบบยาว)');
  const constructed = (tag & 0x20) !== 0;
  const l = readLength(b, pos);
  pos = l.pos;
  const children: Asn1[] = [];
  let end: number;
  let contentEnd: number;
  if (l.len === null) {
    if (!constructed) throw new Pkcs12Error('ไฟล์ใบรับรองไม่ถูกต้อง (ความยาวไม่จำกัดใน primitive)');
    while (!(b[pos] === 0 && b[pos + 1] === 0)) {
      if (pos >= b.length) throw new Pkcs12Error('ไฟล์ใบรับรองไม่สมบูรณ์');
      const c = readElement(b, pos);
      children.push(c.el);
      pos = c.end;
    }
    contentEnd = pos;
    end = pos + 2;
  } else {
    end = pos + l.len;
    contentEnd = end;
    if (end > b.length) throw new Pkcs12Error('ไฟล์ใบรับรองไม่สมบูรณ์ (ข้อมูลขาด)');
    if (constructed) {
      let p = pos;
      while (p < end) {
        const c = readElement(b, p);
        children.push(c.el);
        p = c.end;
      }
    }
  }
  const content = b.subarray(pos, contentEnd);
  // constructed OCTET STRING (0x24) or context tag holding octets: value = concatenation of the primitive parts
  const value = constructed && (tag === 0x24 || tag === 0xa0) && children.length && children.every((c) => c.tag === 0x04 || c.tag === 0x24)
    ? Buffer.concat(children.map((c) => c.value))
    : content;
  return { el: { tag, constructed, value, children, raw: b.subarray(start, end) }, end };
}

export function parseAsn1(b: Buffer): Asn1 {
  return readElement(b, 0).el;
}

function oid(el: Asn1): string {
  if (el.tag !== 0x06) throw new Pkcs12Error('ไฟล์ใบรับรองไม่ถูกต้อง (คาดว่าเป็น OID)');
  const v = el.value;
  const parts = [Math.floor(v[0] / 40), v[0] % 40];
  let n = 0;
  for (let i = 1; i < v.length; i++) {
    n = n * 128 + (v[i] & 0x7f);
    if (!(v[i] & 0x80)) { parts.push(n); n = 0; }
  }
  return parts.join('.');
}

function int(el: Asn1): number {
  if (el.tag !== 0x02) throw new Pkcs12Error('ไฟล์ใบรับรองไม่ถูกต้อง (คาดว่าเป็น INTEGER)');
  let n = 0;
  for (const x of el.value) n = n * 256 + x;
  return n;
}

const child = (el: Asn1, i: number): Asn1 => {
  const c = el.children[i];
  if (!c) throw new Pkcs12Error('ไฟล์ใบรับรองไม่ถูกต้อง (โครงสร้างไม่ครบ)');
  return c;
};

/* ---------------- OIDs ---------------- */

const OID = {
  data: '1.2.840.113549.1.7.1',
  encryptedData: '1.2.840.113549.1.7.6',
  keyBag: '1.2.840.113549.1.12.10.1.1',
  shroudedKeyBag: '1.2.840.113549.1.12.10.1.2',
  certBag: '1.2.840.113549.1.12.10.1.3',
  x509Certificate: '1.2.840.113549.1.9.22.1',
  localKeyId: '1.2.840.113549.1.9.21',
  pbes2: '1.2.840.113549.1.5.13',
  pbkdf2: '1.2.840.113549.1.5.12',
  pbeSha3Des: '1.2.840.113549.1.12.1.3',
  pbeSha2Des: '1.2.840.113549.1.12.1.4',
};
const HMAC_PRF: Record<string, string> = {
  '1.2.840.113549.2.7': 'sha1', '1.2.840.113549.2.8': 'sha224', '1.2.840.113549.2.9': 'sha256', '1.2.840.113549.2.10': 'sha384', '1.2.840.113549.2.11': 'sha512',
};
const CIPHERS: Record<string, { name: string; keyLen: number }> = {
  '2.16.840.1.101.3.4.1.2': { name: 'aes-128-cbc', keyLen: 16 },
  '2.16.840.1.101.3.4.1.22': { name: 'aes-192-cbc', keyLen: 24 },
  '2.16.840.1.101.3.4.1.42': { name: 'aes-256-cbc', keyLen: 32 },
  '1.2.840.113549.3.7': { name: 'des-ede3-cbc', keyLen: 24 },
};
const DIGESTS: Record<string, { name: string; v: number }> = {
  '1.3.14.3.2.26': { name: 'sha1', v: 64 },
  '2.16.840.1.101.3.4.2.4': { name: 'sha224', v: 64 },
  '2.16.840.1.101.3.4.2.1': { name: 'sha256', v: 64 },
  '2.16.840.1.101.3.4.2.2': { name: 'sha384', v: 128 },
  '2.16.840.1.101.3.4.2.3': { name: 'sha512', v: 128 },
};

/* ---------------- key derivation + decryption ---------------- */

/** Password as BMPString (UTF-16BE) with a two-byte NUL terminator — the PKCS#12 KDF input (RFC 7292 B.1). */
function bmpPassword(password: string): Buffer {
  const b = Buffer.alloc((password.length + 1) * 2);
  for (let i = 0; i < password.length; i++) b.writeUInt16BE(password.charCodeAt(i), i * 2);
  return b;
}

/** RFC 7292 Appendix B.2 key derivation. id 1 = key, 2 = IV, 3 = MAC key. */
export function pkcs12Kdf(hash: string, v: number, password: Buffer, salt: Buffer, id: number, iterations: number, n: number): Buffer {
  const u = createHash(hash).digest().length;
  const D = Buffer.alloc(v, id);
  const fill = (x: Buffer) => {
    if (!x.length) return Buffer.alloc(0);
    const out = Buffer.alloc(v * Math.ceil(x.length / v));
    for (let i = 0; i < out.length; i++) out[i] = x[i % x.length];
    return out;
  };
  const I = Buffer.concat([fill(salt), fill(password)]);
  const out: Buffer[] = [];
  for (let produced = 0; produced < n; produced += u) {
    let A = createHash(hash).update(D).update(I).digest();
    for (let r = 1; r < iterations; r++) A = createHash(hash).update(A).digest();
    out.push(A);
    const B = Buffer.alloc(v);
    for (let i = 0; i < v; i++) B[i] = A[i % u];
    for (let j = 0; j < I.length; j += v) {
      let carry = 1;
      for (let k = v - 1; k >= 0; k--) {
        const sum = I[j + k] + B[k] + carry;
        I[j + k] = sum & 0xff;
        carry = sum >> 8;
      }
    }
  }
  return Buffer.concat(out).subarray(0, n);
}

/** Decrypt `data` encrypted with the AlgorithmIdentifier `alg` (PBES2 or PKCS#12 PBE). */
function decrypt(alg: Asn1, data: Buffer, password: string): Buffer {
  const algOid = oid(child(alg, 0));
  const params = alg.children[1];
  try {
    if (algOid === OID.pbes2) {
      const kdf = child(params!, 0);
      const enc = child(params!, 1);
      if (oid(child(kdf, 0)) !== OID.pbkdf2) throw new Pkcs12Error('ไม่รองรับวิธีสร้างกุญแจของไฟล์นี้ (ต้องเป็น PBKDF2)');
      const kp = child(kdf, 1);
      const salt = child(kp, 0).value;
      const iterations = int(child(kp, 1));
      let prf = 'sha1';
      for (const c of kp.children.slice(2)) if (c.tag === 0x30) prf = HMAC_PRF[oid(child(c, 0))] ?? '';
      if (!prf) throw new Pkcs12Error('ไม่รองรับ PRF ของ PBKDF2 ในไฟล์นี้');
      const cipher = CIPHERS[oid(child(enc, 0))];
      if (!cipher) throw new Pkcs12Error('ไม่รองรับการเข้ารหัสของไฟล์นี้ — export ใหม่ด้วย AES-256');
      const key = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, cipher.keyLen, prf);
      const d = createDecipheriv(cipher.name, key, child(enc, 1).value);
      return Buffer.concat([d.update(data), d.final()]);
    }
    if (algOid === OID.pbeSha3Des || algOid === OID.pbeSha2Des) {
      const salt = child(params!, 0).value;
      const iterations = int(child(params!, 1));
      const pw = bmpPassword(password);
      let key = pkcs12Kdf('sha1', 64, pw, salt, 1, iterations, 24);
      if (algOid === OID.pbeSha2Des) key = Buffer.concat([key.subarray(0, 16), key.subarray(0, 8)]);
      const iv = pkcs12Kdf('sha1', 64, pw, salt, 2, iterations, 8);
      const d = createDecipheriv('des-ede3-cbc', key, iv);
      return Buffer.concat([d.update(data), d.final()]);
    }
  } catch (e) {
    if (e instanceof Pkcs12Error) throw e;
    throw new Pkcs12Error('ถอดรหัสไฟล์ใบรับรองไม่ได้ — รหัสผ่านไม่ถูกต้อง');
  }
  throw new Pkcs12Error(`ไม่รองรับการเข้ารหัสแบบเก่าของไฟล์นี้ (${algOid}) — export ใบรับรองใหม่เป็น .p12 แบบ AES-256 (เช่น openssl pkcs12 -export โดยไม่ใส่ -legacy)`);
}

function verifyMac(pfx: Asn1, authSafeContent: Buffer, password: string): void {
  const macData = pfx.children[2];
  if (!macData) return; // no MAC: integrity is still protected by the encryption, password errors surface on decryption
  const digestInfo = child(macData, 0);
  const algOid = oid(child(child(digestInfo, 0), 0));
  const expected = child(digestInfo, 1).value;
  const salt = child(macData, 1).value;
  const iterations = macData.children[2] ? int(macData.children[2]) : 1;
  const d = DIGESTS[algOid];
  if (!d) throw new Pkcs12Error('ไม่รองรับวิธีตรวจ MAC ของไฟล์นี้');
  const len = createHash(d.name).digest().length;
  // OpenSSL / Windows differ on an empty password: try the BMP form with terminator, then the empty octet string
  const candidates = password === '' ? [bmpPassword(''), Buffer.alloc(0)] : [bmpPassword(password)];
  for (const pw of candidates) {
    const key = pkcs12Kdf(d.name, d.v, pw, salt, 3, iterations, len);
    const mac = createHmac(d.name, key).update(authSafeContent).digest();
    if (mac.equals(expected)) return;
  }
  throw new Pkcs12Error('รหัสผ่านไฟล์ใบรับรองไม่ถูกต้อง');
}

/* ---------------- PFX ---------------- */

export interface Pkcs12Contents {
  privateKey: KeyObject;
  /** the certificate matching the private key */
  certificate: X509Certificate;
  /** other certificates in the file (CA chain), issuer order as found */
  chain: X509Certificate[];
}

/** Parse a PKCS#12 file and return the signing key + its certificate. Throws Pkcs12Error (Thai message) on any problem. */
export function readPkcs12(file: Buffer, password: string): Pkcs12Contents {
  let pfx: Asn1;
  try {
    pfx = parseAsn1(file);
  } catch (e) {
    throw e instanceof Pkcs12Error ? e : new Pkcs12Error('ไฟล์ไม่ใช่ใบรับรอง .p12 / .pfx');
  }
  if (pfx.tag !== 0x30 || pfx.children.length < 2 || child(pfx, 0).tag !== 0x02) throw new Pkcs12Error('ไฟล์ไม่ใช่ใบรับรอง .p12 / .pfx');
  if (int(child(pfx, 0)) !== 3) throw new Pkcs12Error('ไม่รองรับ PKCS#12 รุ่นนี้');
  const authSafe = child(pfx, 1);
  if (oid(child(authSafe, 0)) !== OID.data) throw new Pkcs12Error('ไม่รองรับไฟล์ PFX ที่ป้องกันด้วยกุญแจสาธารณะ (ต้องเป็นแบบรหัสผ่าน)');
  const authSafeContent = child(child(authSafe, 1), 0).value;
  verifyMac(pfx, authSafeContent, password);

  const keys: { key: KeyObject; localKeyId: string | null }[] = [];
  const certs: { cert: X509Certificate; localKeyId: string | null }[] = [];

  const readBags = (safeContents: Buffer) => {
    for (const bag of parseAsn1(safeContents).children) {
      const bagId = oid(child(bag, 0));
      const value = child(child(bag, 1), 0);
      let localKeyId: string | null = null;
      const attrs = bag.children[2];
      if (attrs) for (const attr of attrs.children) if (oid(child(attr, 0)) === OID.localKeyId) localKeyId = child(child(attr, 1), 0).value.toString('hex');
      if (bagId === OID.keyBag) {
        keys.push({ key: createPrivateKey({ key: value.raw, format: 'der', type: 'pkcs8' }), localKeyId });
      } else if (bagId === OID.shroudedKeyBag) {
        const pki = decrypt(child(value, 0), child(value, 1).value, password);
        keys.push({ key: createPrivateKey({ key: pki, format: 'der', type: 'pkcs8' }), localKeyId });
      } else if (bagId === OID.certBag) {
        if (oid(child(value, 0)) !== OID.x509Certificate) continue;
        certs.push({ cert: new X509Certificate(child(child(value, 1), 0).value), localKeyId });
      }
    }
  };

  for (const ci of parseAsn1(authSafeContent).children) {
    const type = oid(child(ci, 0));
    if (type === OID.data) readBags(child(child(ci, 1), 0).value);
    else if (type === OID.encryptedData) {
      const encInfo = child(child(child(ci, 1), 0), 1);
      const content = encInfo.children[2];
      if (!content) continue;
      readBags(decrypt(child(encInfo, 1), content.value, password));
    }
  }

  if (!keys.length) throw new Pkcs12Error('ไม่พบกุญแจส่วนตัว (private key) ในไฟล์ — ต้อง export พร้อมกุญแจส่วนตัว');
  if (!certs.length) throw new Pkcs12Error('ไม่พบใบรับรอง (certificate) ในไฟล์');
  const key = keys[0];
  if (key.key.asymmetricKeyType !== 'rsa') throw new Pkcs12Error('รองรับเฉพาะกุญแจ RSA (ลายมือชื่อ RSA-SHA256)');
  const match = certs.find((c) => c.cert.checkPrivateKey(key.key)) ?? certs.find((c) => key.localKeyId && c.localKeyId === key.localKeyId);
  if (!match) throw new Pkcs12Error('ใบรับรองในไฟล์ไม่ตรงกับกุญแจส่วนตัว');
  return { privateKey: key.key, certificate: match.cert, chain: certs.filter((c) => c !== match).map((c) => c.cert) };
}
