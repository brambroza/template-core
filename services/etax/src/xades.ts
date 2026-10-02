/**
 * XAdES-BES enveloped signature (ETSI TS 101 903 v1.3.2 / XML-DSig 1.0) over an e-Tax document — node:crypto only.
 *
 *   <ds:Signature Id="…">                                   last child of the document root
 *     <ds:SignedInfo>  exc-c14n · RSA-SHA256
 *       <ds:Reference URI="">          transforms: enveloped-signature, exc-c14n · SHA-256 of the document
 *       <ds:Reference URI="#…-signedprops" Type="…#SignedProperties">  exc-c14n · SHA-256
 *     <ds:SignatureValue>             RSA-SHA256 (PKCS#1 v1.5) of c14n(SignedInfo)
 *     <ds:KeyInfo><ds:X509Data>       signer certificate (+ chain from the .p12)
 *     <ds:Object><xades:QualifyingProperties Target="#…"><xades:SignedProperties Id="…-signedprops">
 *       SigningTime, SigningCertificate/Cert (CertDigest SHA-256, IssuerSerial)
 *
 * Canonicalization: every element we sign is produced by `serialize()` (xml.ts), which writes exclusive-c14n form directly.
 * So c14n(document without Signature) is exactly the unsigned serialization, and c14n(SignedInfo) / c14n(SignedProperties) are
 * those subtrees serialized as an apex. LIMITATION: we can only sign XML this module generated (see xml.ts).
 * `verifyXadesSignature()` re-parses the signed file and re-canonicalizes it with the same serializer — a self-check, not a
 * substitute for ETDA's validator (tests additionally cross-check c14n with libxml2 / lxml when available).
 *
 * Not done (honest scope): no timestamp (XAdES-T), no OCSP/CRL check of the certificate, no long-term validation data.
 * ETDA / the Revenue Department accept XAdES-BES signed with a certificate from a CA licensed in Thailand — the certificate
 * itself (e.g. from TDID, INET, Thai Digital ID, CAT) is the customer's to obtain.
 */
import { createHash, createSign, createVerify, randomUUID, X509Certificate, type KeyObject } from 'node:crypto';
import { NS, XML_DECL } from './etda.ts';
import { collectNamespaces, el, elements, findDeep, parseXml, serialize, textOf, type XmlElement } from './xml.ts';

export const ALG = {
  c14n: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  enveloped: 'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
  rsaSha256: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  sha256: 'http://www.w3.org/2001/04/xmlenc#sha256',
  signedProps: 'http://uri.etsi.org/01903#SignedProperties',
};

/** Pluggable so a customer can swap in an HSM / cloud KMS / service-provider signer without touching the routes. */
export interface DocumentSigner {
  readonly method: 'xades-bes';
  /** sign an unsigned document produced by buildEtaxXml (root element + its namespace map) */
  sign(root: XmlElement, namespaces: Record<string, string>, opts: { signingTime: string }): SignedDocument;
}

export interface SignedDocument {
  /** complete file: XML declaration + signed document */
  xml: string;
  certificate: CertificateInfo;
  signatureId: string;
}

export interface CertificateInfo {
  subject: string;
  issuer: string;
  /** decimal, as written in X509SerialNumber */
  serial: string;
  notBefore: string;
  notAfter: string;
  fingerprint256: string;
}

const sha256b64 = (s: string | Buffer) => createHash('sha256').update(s).digest('base64');

/** RFC 4514 string of a node:crypto DN ("C=TH\nO=…\nCN=…", most significant first) — reversed and escaped. */
export function rfc4514(dn: string): string {
  return dn.split('\n').filter(Boolean).reverse().map((rdn) => {
    const i = rdn.indexOf('=');
    const value = rdn.slice(i + 1).replace(/([\\,+"<>;=])/g, '\\$1').replace(/^([ #])/, '\\$1').replace(/ $/, '\\ ');
    return `${rdn.slice(0, i)}=${value}`;
  }).join(',');
}

export function certificateInfo(c: X509Certificate): CertificateInfo {
  return {
    subject: rfc4514(c.subject), issuer: rfc4514(c.issuer), serial: BigInt(`0x${c.serialNumber}`).toString(10),
    notBefore: new Date(c.validFrom).toISOString(), notAfter: new Date(c.validTo).toISOString(), fingerprint256: c.fingerprint256,
  };
}

export function xadesBesSigner(key: KeyObject, certificate: X509Certificate, chain: X509Certificate[] = []): DocumentSigner {
  return {
    method: 'xades-bes',
    sign(root, namespaces, opts) {
      const ns = { ...namespaces, ds: NS.ds, xades: NS.xades };
      const id = `xmldsig-${randomUUID()}`;
      const spId = `${id}-signedprops`;
      const info = certificateInfo(certificate);

      // 1. document digest: enveloped-signature transform + exc-c14n = our serialization of the unsigned root
      const docDigest = sha256b64(serialize(root, ns));

      // 2. SignedProperties digest (c14n of the subtree as an apex)
      const signedProps = el('xades:SignedProperties', { Id: spId },
        el('xades:SignedSignatureProperties', null,
          el('xades:SigningTime', null, opts.signingTime),
          el('xades:SigningCertificate', null,
            el('xades:Cert', null,
              el('xades:CertDigest', null,
                el('ds:DigestMethod', { Algorithm: ALG.sha256 }),
                el('ds:DigestValue', null, sha256b64(certificate.raw))),
              el('xades:IssuerSerial', null,
                el('ds:X509IssuerName', null, info.issuer),
                el('ds:X509SerialNumber', null, info.serial))))));
      const propsDigest = sha256b64(serialize(signedProps, ns));

      // 3. SignedInfo, signed in its canonical form
      const signedInfo = el('ds:SignedInfo', null,
        el('ds:CanonicalizationMethod', { Algorithm: ALG.c14n }),
        el('ds:SignatureMethod', { Algorithm: ALG.rsaSha256 }),
        el('ds:Reference', { Id: `${id}-ref0`, URI: '' },
          el('ds:Transforms', null,
            el('ds:Transform', { Algorithm: ALG.enveloped }),
            el('ds:Transform', { Algorithm: ALG.c14n })),
          el('ds:DigestMethod', { Algorithm: ALG.sha256 }),
          el('ds:DigestValue', null, docDigest)),
        el('ds:Reference', { Type: ALG.signedProps, URI: `#${spId}` },
          el('ds:Transforms', null, el('ds:Transform', { Algorithm: ALG.c14n })),
          el('ds:DigestMethod', { Algorithm: ALG.sha256 }),
          el('ds:DigestValue', null, propsDigest)));
      const signatureValue = createSign('RSA-SHA256').update(serialize(signedInfo, ns)).sign(key, 'base64');

      const signature = el('ds:Signature', { Id: id },
        signedInfo,
        el('ds:SignatureValue', { Id: `${id}-sigvalue` }, signatureValue),
        el('ds:KeyInfo', null,
          el('ds:X509Data', null, [certificate, ...chain].map((c) => el('ds:X509Certificate', null, c.raw.toString('base64'))))),
        el('ds:Object', null,
          el('xades:QualifyingProperties', { Target: `#${id}` }, signedProps)));

      // enveloped: the Signature is the root's last child, with no whitespace around it, so removing it restores the digested bytes
      const signed = { ...root, children: [...root.children, signature] };
      return { xml: XML_DECL + serialize(signed, ns), certificate: info, signatureId: id };
    },
  };
}

/* ---------------- verification (self-check) ---------------- */

export interface VerifyResult {
  valid: boolean;
  errors: string[];
  certificate: CertificateInfo | null;
  signingTime: string | null;
}

/**
 * Verify a document signed by `xadesBesSigner` with node:crypto: both reference digests, the RSA-SHA256 signature value
 * against the certificate in KeyInfo, and that SigningCertificate matches that certificate. Optionally require a specific
 * certificate (by SHA-256 fingerprint).
 */
export function verifyXadesSignature(xml: string, opts: { fingerprint256?: string } = {}): VerifyResult {
  const errors: string[] = [];
  let root: XmlElement;
  try { root = parseXml(xml); } catch (e) { return { valid: false, errors: [`XML ไม่ well-formed: ${(e as Error).message}`], certificate: null, signingTime: null }; }
  const ns = collectNamespaces(root);
  const sigs = elements(root, 'ds:Signature');
  if (sigs.length !== 1) return { valid: false, errors: ['ต้องมี ds:Signature หนึ่งรายการเป็นลูกของ root'], certificate: null, signingTime: null };
  const sig = sigs[0];
  const signedInfo = elements(sig, 'ds:SignedInfo')[0];
  const sigValue = textOf(elements(sig, 'ds:SignatureValue')[0])?.replace(/\s+/g, '');
  const certB64 = textOf(findDeep(sig, 'ds:X509Certificate'))?.replace(/\s+/g, '');
  if (!signedInfo || !sigValue || !certB64) return { valid: false, errors: ['ลายเซ็นไม่ครบ (SignedInfo / SignatureValue / X509Certificate)'], certificate: null, signingTime: null };
  let cert: X509Certificate;
  try { cert = new X509Certificate(Buffer.from(certB64, 'base64')); } catch { return { valid: false, errors: ['ใบรับรองใน KeyInfo อ่านไม่ได้'], certificate: null, signingTime: null }; }

  const algo = (e: XmlElement | undefined, name: string) => elements(e ?? { name: '', attrs: {}, children: [] }, name)[0]?.attrs.Algorithm;
  if (algo(signedInfo, 'ds:CanonicalizationMethod') !== ALG.c14n) errors.push('CanonicalizationMethod ต้องเป็น exc-c14n');
  if (algo(signedInfo, 'ds:SignatureMethod') !== ALG.rsaSha256) errors.push('SignatureMethod ต้องเป็น rsa-sha256');

  for (const ref of elements(signedInfo, 'ds:Reference')) {
    const uri = ref.attrs.URI ?? '';
    const transforms = elements(elements(ref, 'ds:Transforms')[0] ?? { name: '', attrs: {}, children: [] }, 'ds:Transform').map((x) => x.attrs.Algorithm);
    if (algo(ref, 'ds:DigestMethod') !== ALG.sha256) errors.push(`Reference "${uri}": DigestMethod ต้องเป็น sha256`);
    const expected = textOf(elements(ref, 'ds:DigestValue')[0])?.replace(/\s+/g, '');
    let target: string;
    if (uri === '') {
      if (transforms.join(' ') !== `${ALG.enveloped} ${ALG.c14n}`) errors.push('Reference เอกสารต้องใช้ enveloped-signature + exc-c14n');
      target = serialize({ ...root, children: root.children.filter((c) => c !== sig) }, ns);
    } else if (uri.startsWith('#')) {
      const node = findById(root, uri.slice(1));
      if (!node) { errors.push(`ไม่พบ element Id="${uri.slice(1)}"`); continue; }
      target = serialize(node, ns);
    } else { errors.push(`ไม่รองรับ Reference URI "${uri}"`); continue; }
    if (sha256b64(target) !== expected) errors.push(`DigestValue ของ Reference "${uri || 'เอกสาร'}" ไม่ตรง — เอกสารถูกแก้ไขหลังลงลายมือชื่อ`);
  }
  if (!createVerify('RSA-SHA256').update(serialize(signedInfo, ns)).verify(cert.publicKey, sigValue, 'base64')) errors.push('SignatureValue ไม่ถูกต้อง');

  const sp = findDeep(sig, 'xades:SignedProperties');
  const certDigest = textOf(sp && findDeep(sp, 'ds:DigestValue'))?.replace(/\s+/g, '');
  if (!sp) errors.push('ไม่มี xades:SignedProperties (ไม่ใช่ XAdES-BES)');
  else if (certDigest !== sha256b64(cert.raw)) errors.push('SigningCertificate ไม่ตรงกับใบรับรองใน KeyInfo');
  if (sp && !elements(sig, 'ds:SignedInfo')[0]?.children.some((c) => typeof c !== 'string' && c.attrs.URI === `#${sp.attrs.Id}`)) errors.push('SignedProperties ไม่ได้ถูกอ้างอิงใน SignedInfo');
  if (opts.fingerprint256 && cert.fingerprint256 !== opts.fingerprint256) errors.push('ลงลายมือชื่อด้วยใบรับรองอื่น');
  const signingTime = textOf(sp && findDeep(sp, 'xades:SigningTime')) ?? null;
  return { valid: errors.length === 0, errors, certificate: certificateInfo(cert), signingTime };
}

function findById(e: XmlElement, id: string): XmlElement | undefined {
  if (e.attrs.Id === id) return e;
  for (const c of e.children) {
    if (typeof c === 'string') continue;
    const f = findById(c, id);
    if (f) return f;
  }
  return undefined;
}
