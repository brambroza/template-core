/**
 * Cost formulas kept as data: a small, safe arithmetic language so a company can change how a print job is costed without a
 * programmer. Never `eval` — the text is parsed into a tree and only the operations below exist.
 *
 *   numbers       1250   0.125
 *   variables     qty  ups  paperSheetCost  (inputs of the job, or the result of an earlier formula)
 *   operators     + - * /   ( )   comparisons < <= > >= = <> (give 1 or 0)
 *   functions     ceil(x) floor(x) round(x, digits) roundup(x, digits) min(a, b, …) max(a, b, …) abs(x) if(condition, then, else)
 *
 * Function names are not case sensitive (IF, MAX … as in Excel); variable names are.
 */

/** A problem in a formula, worded in Thai for the person editing it. */
export class FormulaError extends Error {}

export type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] };

interface Token { kind: 'num' | 'id' | 'op'; text: string; pos: number }

const OPERATORS = ['<=', '>=', '<>', '!=', '==', '+', '-', '*', '/', '(', ')', ',', '<', '>', '='];

/** Number of arguments each function takes: [min, max]. */
const FUNCTIONS: Record<string, [number, number]> = {
  ceil: [1, 1], floor: [1, 1], abs: [1, 1], round: [1, 2], roundup: [1, 2], min: [1, 20], max: [1, 20], if: [3, 3],
};

export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

/** Tolerance for binary noise: 100 × 1.1 is 110.00000000000001 and must still be 110 sheets, not 111. */
const EPS = 1e-9;

/** Split formula text into numbers, names and operators. */
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    const num = /^\d+(\.\d+)?|^\.\d+/.exec(text.slice(i));
    if (num) { out.push({ kind: 'num', text: num[0], pos: i }); i += num[0].length; continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
    if (id) { out.push({ kind: 'id', text: id[0], pos: i }); i += id[0].length; continue; }
    const op = OPERATORS.find((o) => text.startsWith(o, i));
    if (op) { out.push({ kind: 'op', text: op, pos: i }); i += op.length; continue; }
    throw new FormulaError(`สูตรมีอักขระที่ใช้ไม่ได้ "${ch}" (ตำแหน่งที่ ${i + 1})`);
  }
  return out;
}

/** Parse formula text into a tree. Throws FormulaError with a Thai message when the text is not a valid formula. */
export function parseFormula(text: string): Node {
  const tokens = tokenize(text);
  if (!tokens.length) throw new FormulaError('สูตรว่าง');
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (...ops: string[]) => peek()?.kind === 'op' && ops.includes(peek()!.text);
  const fail = (): never => {
    const t = peek();
    throw new FormulaError(t ? `สูตรผิดรูปแบบที่ "${t.text}" (ตำแหน่งที่ ${t.pos + 1})` : 'สูตรจบไม่สมบูรณ์ — ตรวจวงเล็บและเครื่องหมาย');
  };
  const expect = (op: string) => { if (!isOp(op)) fail(); p++; };

  const primary = (): Node => {
    const t = peek();
    if (!t) return fail();
    if (t.kind === 'num') { p++; return { t: 'num', v: Number(t.text) }; }
    if (t.kind === 'id') {
      p++;
      if (!isOp('(')) return { t: 'var', name: t.text };
      const fn = t.text.toLowerCase();
      const arity = Object.hasOwn(FUNCTIONS, fn) ? FUNCTIONS[fn] : undefined;
      if (!arity) throw new FormulaError(`ไม่รู้จักฟังก์ชัน "${t.text}" — ใช้ได้: ${FUNCTION_NAMES.join(', ')}`);
      p++;
      const args: Node[] = [];
      if (!isOp(')')) {
        args.push(compare());
        while (isOp(',')) { p++; args.push(compare()); }
      }
      expect(')');
      if (args.length < arity[0] || args.length > arity[1]) {
        throw new FormulaError(`ฟังก์ชัน ${fn} ต้องมี ${arity[0] === arity[1] ? arity[0] : `${arity[0]}–${arity[1]}`} ค่าในวงเล็บ (ใส่มา ${args.length})`);
      }
      return { t: 'call', fn, args };
    }
    if (t.text === '(') { p++; const inner = compare(); expect(')'); return inner; }
    return fail();
  };
  const unary = (): Node => {
    if (isOp('-')) { p++; return { t: 'neg', a: unary() }; }
    if (isOp('+')) { p++; return unary(); }
    return primary();
  };
  const term = (): Node => {
    let a = unary();
    while (isOp('*', '/')) { const op = tokens[p++]!.text; a = { t: 'bin', op, a, b: unary() }; }
    return a;
  };
  const sum = (): Node => {
    let a = term();
    while (isOp('+', '-')) { const op = tokens[p++]!.text; a = { t: 'bin', op, a, b: term() }; }
    return a;
  };
  function compare(): Node {
    const a = sum();
    if (!isOp('<', '<=', '>', '>=', '=', '==', '<>', '!=')) return a;
    const op = tokens[p++]!.text;
    return { t: 'bin', op, a, b: sum() };
  }

  const tree = compare();
  if (p < tokens.length) fail();
  return tree;
}

/** Names of the variables a formula reads, in order of first use. */
export function variablesOf(node: Node): string[] {
  const seen = new Set<string>();
  const walk = (n: Node) => {
    if (n.t === 'var') seen.add(n.name);
    else if (n.t === 'neg') walk(n.a);
    else if (n.t === 'bin') { walk(n.a); walk(n.b); }
    else if (n.t === 'call') n.args.forEach(walk);
  };
  walk(node);
  return [...seen];
}

/** Round half up to `digits` decimals without binary noise (1.005 → 1.01). */
function roundTo(value: number, digits: number, up = false): number {
  const f = 10 ** Math.max(0, Math.min(8, Math.trunc(digits)));
  const scaled = Number((value * f).toPrecision(15));
  return (up ? Math.ceil(scaled - EPS) : Math.round(scaled)) / f;
}

/** Work out a parsed formula with the given variable values. Unknown variables, division by zero and overflow are FormulaErrors. */
export function evaluate(node: Node, vars: Record<string, number>): number {
  const run = (n: Node): number => {
    switch (n.t) {
      case 'num': return n.v;
      case 'var': {
        // own properties only: "constructor" or "toString" must not reach the object's prototype
        if (!Object.hasOwn(vars, n.name)) throw new FormulaError(`ไม่รู้จักตัวแปร "${n.name}"`);
        return vars[n.name]!;
      }
      case 'neg': return -run(n.a);
      case 'bin': {
        const a = run(n.a), b = run(n.b);
        switch (n.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/':
            if (b === 0) throw new FormulaError('หารด้วยศูนย์');
            return a / b;
          case '<': return a < b - EPS ? 1 : 0;
          case '<=': return a <= b + EPS ? 1 : 0;
          case '>': return a > b + EPS ? 1 : 0;
          case '>=': return a >= b - EPS ? 1 : 0;
          case '=': case '==': return Math.abs(a - b) <= EPS ? 1 : 0;
          default: return Math.abs(a - b) > EPS ? 1 : 0; // <> and !=
        }
      }
      case 'call': {
        // only the chosen branch of if() is worked out, so the other one may divide by zero
        if (n.fn === 'if') return run(n.args[0]!) !== 0 ? run(n.args[1]!) : run(n.args[2]!);
        const a = n.args.map(run);
        switch (n.fn) {
          case 'ceil': return Math.ceil(a[0]! - EPS);
          case 'floor': return Math.floor(a[0]! + EPS);
          case 'abs': return Math.abs(a[0]!);
          case 'round': return roundTo(a[0]!, a[1] ?? 0);
          case 'roundup': return roundTo(a[0]!, a[1] ?? 0, true);
          case 'min': return Math.min(...a);
          default: return Math.max(...a);
        }
      }
    }
  };
  const result = run(node);
  if (!Number.isFinite(result)) throw new FormulaError('ผลลัพธ์ไม่ใช่ตัวเลข');
  return result;
}
