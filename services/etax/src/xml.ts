/**
 * A tiny XML toolkit for the documents this module generates itself. No dependencies.
 *
 * `serialize()` writes an element tree directly in its **Exclusive XML Canonicalization** form
 * (https://www.w3.org/TR/xml-exc-c14n/, without InclusiveNamespaces):
 *   - a namespace is declared on an element only where it is *visibly used* (the element's prefix or a prefixed attribute)
 *     and no output ancestor already declared it — so `xmlns:ram` appears on each top-level `ram:` child, not on the root;
 *   - namespace declarations sorted by prefix, then attributes sorted by (namespace URI, local name);
 *   - empty elements as start/end tag pairs; c14n character escaping for text and attribute values;
 *   - no XML declaration, comments, PIs, CDATA, default namespace or insignificant whitespace (the output is compact).
 * Because the generator only ever emits that form, "exclusive c14n of our own document" is the identity function, and
 * signing does not need a general-purpose canonicalizer. LIMITATION (documented in CLAUDE.md): this is NOT a general
 * c14n implementation — XML produced elsewhere (pretty-printed, with comments, default namespaces, DTDs…) must first be
 * canonicalized by a real library before its digest can be compared.
 *
 * `parseXml()` is a minimal non-validating parser (elements, attributes, text, entity/char references, CDATA; skips
 * the XML declaration, comments, PIs and a DOCTYPE without internal subset). It exists to *check* our own output
 * (structure tests, signature verification) — it is not a hardened parser for untrusted input.
 */

export interface XmlElement {
  /** qualified name, e.g. "ram:ID" */
  name: string;
  /** attributes in document order (xmlns declarations are kept separately in `ns`) */
  attrs: Record<string, string>;
  children: XmlNode[];
  /** namespace declarations written on this element (prefix -> URI); only filled by the parser */
  ns?: Record<string, string>;
}
export type XmlNode = XmlElement | string;

/** Build an element: `el('ram:ID', { schemeID: 'TXID' }, '0105…')`. `null`/`undefined`/`false` children are dropped. */
export function el(name: string, attrs: Record<string, string | number | null | undefined> | null, ...children: (XmlNode | XmlNode[] | null | undefined | false)[]): XmlElement {
  const a: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs ?? {})) if (v !== null && v !== undefined) a[k] = String(v);
  const kids: XmlNode[] = [];
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) kids.push(typeof c === 'string' ? c : c);
  return { name, attrs: a, children: kids };
}

/** Text that is not allowed in XML 1.0 at all (C0 controls other than tab/LF/CR) is removed before escaping. */
const INVALID = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g;

export function escapeText(s: string): string {
  return s.replace(INVALID, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

export function escapeAttr(s: string): string {
  return s.replace(INVALID, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');
}

const prefixOf = (qname: string) => (qname.includes(':') ? qname.slice(0, qname.indexOf(':')) : '');
const localOf = (qname: string) => (qname.includes(':') ? qname.slice(qname.indexOf(':') + 1) : qname);

/**
 * Serialize `node` in exclusive-c14n form. `namespaces` maps every prefix used to its URI. `rendered` = namespaces already
 * declared by output ancestors (empty for an apex: the whole document, or the subtree being digested — SignedInfo,
 * SignedProperties).
 */
export function serialize(node: XmlNode, namespaces: Record<string, string>, rendered: ReadonlyMap<string, string> = new Map()): string {
  if (typeof node === 'string') return escapeText(node);
  const used = new Set<string>([prefixOf(node.name)]);
  for (const k of Object.keys(node.attrs)) if (k.includes(':')) used.add(prefixOf(k));
  used.delete('');
  const next = new Map(rendered);
  const decls: string[] = [];
  for (const p of [...used].sort()) {
    if (p === 'xml') continue;
    const uri = namespaces[p];
    if (uri === undefined) throw new Error(`XML: namespace prefix "${p}" is not declared`);
    if (next.get(p) === uri) continue;
    next.set(p, uri);
    decls.push(` xmlns:${p}="${escapeAttr(uri)}"`);
  }
  const attrKey = (k: string) => [k.includes(':') ? namespaces[prefixOf(k)] ?? '' : '', localOf(k)] as const;
  const attrs = Object.keys(node.attrs)
    .sort((a, b) => {
      const [ua, la] = attrKey(a);
      const [ub, lb] = attrKey(b);
      return ua < ub ? -1 : ua > ub ? 1 : la < lb ? -1 : la > lb ? 1 : 0;
    })
    .map((k) => ` ${k}="${escapeAttr(node.attrs[k])}"`);
  return `<${node.name}${decls.join('')}${attrs.join('')}>${node.children.map((c) => serialize(c, namespaces, next)).join('')}</${node.name}>`;
}

/* ---------------- minimal parser ---------------- */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e]);
}

export class XmlParseError extends Error {}

/** Parse a document and return its root element. Throws XmlParseError when the text is not well-formed (for our subset). */
export function parseXml(text: string): XmlElement {
  let i = 0;
  const s = text.replace(/\r\n?/g, '\n');
  const fail = (m: string): never => { throw new XmlParseError(`${m} (ตำแหน่ง ${i})`); };
  const skipMisc = () => {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith('<?', i)) { const e = s.indexOf('?>', i); if (e < 0) fail('PI ไม่ปิด'); i = e + 2; }
      else if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i); if (e < 0) fail('comment ไม่ปิด'); i = e + 3; }
      else if (s.startsWith('<!DOCTYPE', i)) { const e = s.indexOf('>', i); if (e < 0) fail('DOCTYPE ไม่ปิด'); i = e + 1; }
      else return;
    }
  };
  const NAME = /[A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?/y;
  const readName = () => { NAME.lastIndex = i; const m = NAME.exec(s); if (!m) fail('ชื่อ element/attribute ไม่ถูกต้อง'); i += m![0].length; return m![0]; };

  const readElement = (): XmlElement => {
    if (s[i] !== '<') fail('คาดว่าเป็น <');
    i++;
    const name = readName();
    const attrs: Record<string, string> = {};
    const ns: Record<string, string> = {};
    for (;;) {
      while (/\s/.test(s[i] ?? '')) i++;
      if (s[i] === '/' && s[i + 1] === '>') { i += 2; return { name, attrs, children: [], ns }; }
      if (s[i] === '>') { i++; break; }
      if (i >= s.length) fail('tag ไม่ปิด');
      const an = readName();
      while (/\s/.test(s[i])) i++;
      if (s[i] !== '=') fail('คาดว่าเป็น =');
      i++;
      while (/\s/.test(s[i])) i++;
      const q = s[i];
      if (q !== '"' && q !== "'") fail('ค่า attribute ต้องอยู่ในเครื่องหมายคำพูด');
      const e = s.indexOf(q, i + 1);
      if (e < 0) fail('ค่า attribute ไม่ปิด');
      const raw = s.slice(i + 1, e);
      if (raw.includes('<')) fail('ค่า attribute มี <');
      // attribute value normalization (XML 1.0 §3.3.3): literal whitespace -> space, references keep their character
      const v = decode(raw.replace(/[\t\n]/g, ' '));
      i = e + 1;
      if (an.startsWith('xmlns:')) ns[an.slice(6)] = v;
      else if (an === 'xmlns') ns[''] = v;
      else if (an in attrs) fail(`attribute ซ้ำ ${an}`);
      else attrs[an] = v;
    }
    const children: XmlNode[] = [];
    for (;;) {
      if (i >= s.length) fail(`element ${name} ไม่ปิด`);
      if (s.startsWith('</', i)) {
        i += 2;
        const end = readName();
        if (end !== name) fail(`ปิด ${end} แต่เปิด ${name}`);
        while (/\s/.test(s[i])) i++;
        if (s[i] !== '>') fail('คาดว่าเป็น >');
        i++;
        return { name, attrs, children, ns };
      }
      if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i); if (e < 0) fail('comment ไม่ปิด'); i = e + 3; continue; }
      if (s.startsWith('<![CDATA[', i)) {
        const e = s.indexOf(']]>', i);
        if (e < 0) fail('CDATA ไม่ปิด');
        pushText(children, s.slice(i + 9, e));
        i = e + 3;
        continue;
      }
      if (s.startsWith('<?', i)) { const e = s.indexOf('?>', i); if (e < 0) fail('PI ไม่ปิด'); i = e + 2; continue; }
      if (s[i] === '<') { children.push(readElement()); continue; }
      const e = s.indexOf('<', i);
      const raw = s.slice(i, e < 0 ? s.length : e);
      if (/&(?!(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);)/.test(raw)) fail('มี & ที่ไม่ใช่ entity');
      pushText(children, decode(raw));
      i = e < 0 ? s.length : e;
    }
  };
  skipMisc();
  const root = readElement();
  skipMisc();
  if (i < s.length) fail('มีข้อมูลหลัง root element');
  return root;
}

function pushText(children: XmlNode[], t: string) {
  if (!t) return;
  const last = children[children.length - 1];
  if (typeof last === 'string') children[children.length - 1] = last + t;
  else children.push(t);
}

/* ---------------- helpers for checks ---------------- */

/** Namespace declarations in scope for every element of a parsed tree, merged into one map (first declaration wins). */
export function collectNamespaces(root: XmlElement, into: Record<string, string> = {}): Record<string, string> {
  for (const [p, u] of Object.entries(root.ns ?? {})) {
    if (p in into && into[p] !== u) throw new Error(`XML: prefix "${p}" is bound to two namespaces`);
    into[p] = u;
  }
  for (const c of root.children) if (typeof c !== 'string') collectNamespaces(c, into);
  return into;
}

export const elements = (e: XmlElement, name?: string): XmlElement[] =>
  e.children.filter((c): c is XmlElement => typeof c !== 'string' && (!name || c.name === name));

/** First descendant element by a path of qualified names: `find(root, 'rsm:ExchangedDocument', 'ram:ID')`. */
export function find(e: XmlElement, ...path: string[]): XmlElement | undefined {
  let cur: XmlElement | undefined = e;
  for (const p of path) cur = cur && elements(cur, p)[0];
  return cur;
}

export function findAll(e: XmlElement, ...path: string[]): XmlElement[] {
  if (!path.length) return [e];
  return elements(e, path[0]).flatMap((c) => findAll(c, ...path.slice(1)));
}

export const textOf = (e: XmlElement | undefined): string | undefined =>
  e ? e.children.filter((c): c is string => typeof c === 'string').join('') : undefined;

/** Depth-first search for the first element with this qualified name. */
export function findDeep(e: XmlElement, name: string): XmlElement | undefined {
  for (const c of e.children) {
    if (typeof c === 'string') continue;
    if (c.name === name) return c;
    const d = findDeep(c, name);
    if (d) return d;
  }
  return undefined;
}
