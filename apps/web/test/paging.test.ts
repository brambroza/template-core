import { describe, expect, it } from 'vitest';
import { clampPage, DEFAULT_PAGE_SIZE, pageCount, pageItems, pageRange, validPageSize } from '../src/lib/paging.ts';

describe('list paging', () => {
  it('counts pages, an empty list still being one page', () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(21, 20)).toBe(2);
    expect(pageCount(135, 50)).toBe(3);
    expect(pageCount(5, 0)).toBe(5); // a broken size is treated as 1, never a division by zero
  });

  it('keeps the page inside the list when rows shrink or the input is odd', () => {
    expect(clampPage(7, 45, 20)).toBe(3);
    expect(clampPage(0, 45, 20)).toBe(1);
    expect(clampPage(-3, 45, 20)).toBe(1);
    expect(clampPage(Number.NaN, 45, 20)).toBe(1);
    expect(clampPage(2.7, 45, 20)).toBe(2);
    expect(clampPage(4, 0, 20)).toBe(1);
  });

  it('reports the rows shown on a page', () => {
    expect(pageRange(1, 135, 20)).toEqual({ from: 1, to: 20 });
    expect(pageRange(7, 135, 20)).toEqual({ from: 121, to: 135 });
    expect(pageRange(99, 135, 20)).toEqual({ from: 121, to: 135 });
    expect(pageRange(1, 0, 20)).toEqual({ from: 0, to: 0 });
  });

  it('draws first, last, the current page with its neighbours and gaps', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(1, 5)).toEqual([1, 2, 'gap', 5]);
    expect(pageItems(6, 12)).toEqual([1, 'gap', 5, 6, 7, 'gap', 12]);
    expect(pageItems(12, 12)).toEqual([1, 'gap', 11, 12]);
    expect(pageItems(3, 5)).toEqual([1, 2, 3, 4, 5]); // a gap over one page shows that page
    expect(pageItems(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('accepts only the offered page sizes', () => {
    expect(validPageSize(50)).toBe(50);
    expect(validPageSize(33)).toBe(DEFAULT_PAGE_SIZE);
    expect(validPageSize('100')).toBe(DEFAULT_PAGE_SIZE);
    expect(validPageSize(null)).toBe(DEFAULT_PAGE_SIZE);
  });
});
