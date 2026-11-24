import { describe, expect, it } from 'vitest';
import { evaluate, FormulaError, parseFormula, variablesOf } from '../src/formula.ts';

const run = (text: string, vars: Record<string, number> = {}) => evaluate(parseFormula(text), vars);

describe('formula language', () => {
  it('follows arithmetic precedence, brackets and unary minus', () => {
    expect(run('2 + 3 * 4')).toBe(14);
    expect(run('(2 + 3) * 4')).toBe(20);
    expect(run('-2 * -(3 - 5)')).toBe(-4);
    expect(run('10 / 4')).toBe(2.5);
    expect(run('.5 + 1.25')).toBe(1.75);
  });

  it('reads variables and reports the ones it reads', () => {
    expect(run('qty / ups', { qty: 1000, ups: 4 })).toBe(250);
    expect(variablesOf(parseFormula('max(pressSheets, minImpressions) / 1000 * runCostPer1000 + pressSheets'))).toEqual(['pressSheets', 'minImpressions', 'runCostPer1000']);
  });

  it('has the functions an estimator knows from Excel, in any letter case', () => {
    expect(run('ceil(1001 / 4)')).toBe(251);
    expect(run('FLOOR(7.9)')).toBe(7);
    expect(run('Max(3, 9, 5) - min(3, 9, 5)')).toBe(6);
    expect(run('abs(-12.5)')).toBe(12.5);
    expect(run('round(12.345, 2)')).toBe(12.35);
    expect(run('round(12.5)')).toBe(13);
    expect(run('roundup(12.7208, 2)')).toBe(12.73);
    expect(run('roundup(12.72, 2)')).toBe(12.72);
    expect(run('IF(qty >= 5000, 800, 500)', { qty: 5000 })).toBe(800);
    expect(run('if(qty <> 1000, 1, 0) + if(qty = 1000, 10, 0)', { qty: 1000 })).toBe(10);
  });

  it('is not fooled by binary noise when it rounds sheets up', () => {
    // 100 × 1.1 is 110.00000000000001 in floating point: still 110 sheets, not 111
    expect(run('ceil(100 * 1.1)')).toBe(110);
    expect(run('floor(0.1 * 3 * 10)')).toBe(3);
    expect(run('round(1.005, 2)')).toBe(1.01);
  });

  it('works out only the chosen branch of if()', () => {
    expect(run('if(colorsBack > 0, total / colorsBack, total)', { colorsBack: 0, total: 80 })).toBe(80);
  });

  it.each([
    ['', 'สูตรว่าง'],
    ['qty *', 'สูตรจบไม่สมบูรณ์'],
    ['(qty + 1', 'สูตรจบไม่สมบูรณ์'],
    ['qty ups', 'สูตรผิดรูปแบบที่ "ups"'],
    ['qty $ 2', 'อักขระที่ใช้ไม่ได้ "$"'],
    ['sum(1, 2)', 'ไม่รู้จักฟังก์ชัน "sum"'],
    ['if(1, 2)', 'ฟังก์ชัน if ต้องมี 3 ค่า'],
    ['ceil()', 'ฟังก์ชัน ceil ต้องมี 1 ค่า'],
  ])('rejects %j in Thai', (text, message) => {
    expect(() => parseFormula(text)).toThrow(FormulaError);
    expect(() => parseFormula(text)).toThrow(message);
  });

  it('reports unknown variables and division by zero instead of giving a number', () => {
    expect(() => run('parentSheet * 2', { parentSheets: 10 })).toThrow('ไม่รู้จักตัวแปร "parentSheet"');
    expect(() => run('qty / ups', { qty: 100, ups: 0 })).toThrow('หารด้วยศูนย์');
  });

  it('cannot reach JavaScript: names are only variables, there is no property access or call on values', () => {
    expect(() => run('constructor')).toThrow('ไม่รู้จักตัวแปร');
    expect(() => parseFormula('process.exit(1)')).toThrow(FormulaError);
    expect(() => parseFormula('qty["x"]')).toThrow(FormulaError);
    expect(() => parseFormula('eval(1)')).toThrow('ไม่รู้จักฟังก์ชัน');
    expect(() => parseFormula('constructor(1)')).toThrow('ไม่รู้จักฟังก์ชัน');
    expect(() => run('toString + __proto__', {})).toThrow('ไม่รู้จักตัวแปร');
  });
});
