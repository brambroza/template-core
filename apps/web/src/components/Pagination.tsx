'use client';
/**
 * The bar under a list: "แสดง 21–40 จาก 135 รายการ" · แถวต่อหน้า [20] · ‹ 1 … 3 4 5 … 7 ›
 * Stateless: ListView owns the page and the size.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PAGE_SIZES, pageCount, pageItems, pageRange } from '@/lib/paging';

const n = (v: number) => v.toLocaleString('th-TH');

/**
 * @param total rows in the list
 * @param page current page, 1-based
 * @param size rows per page
 * @param onPage called with the new page
 * @param onSize called with the new rows-per-page
 */
export function Pagination({ total, page, size, onPage, onSize }: { total: number; page: number; size: number; onPage: (page: number) => void; onSize: (size: number) => void }) {
  const count = pageCount(total, size);
  const { from, to } = pageRange(page, total, size);
  return (
    <nav className="pager no-print" aria-label="แบ่งหน้า">
      <p className="pager-count" role="status">แสดง {n(from)}–{n(to)} จาก {n(total)} รายการ</p>
      <label className="pager-size">
        <span>แถวต่อหน้า</span>
        <select value={size} onChange={(e) => onSize(Number(e.target.value))}>
          {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      {count > 1 && (
        <div className="pager-pages">
          <button type="button" className="pager-btn" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="หน้าก่อน">
            <ChevronLeft size={16} aria-hidden />
          </button>
          {pageItems(page, count).map((p, i) => (p === 'gap'
            ? <span key={`gap${i}`} className="pager-gap" aria-hidden>…</span>
            : (
              <button type="button" key={p} className={`pager-btn${p === page ? ' is-current' : ''}`} onClick={() => onPage(p)}
                aria-current={p === page ? 'page' : undefined} aria-label={`หน้า ${p}`}>
                {n(p)}
              </button>
            )))}
          <button type="button" className="pager-btn" onClick={() => onPage(page + 1)} disabled={page >= count} aria-label="หน้าถัดไป">
            <ChevronRight size={16} aria-hidden />
          </button>
        </div>
      )}
    </nav>
  );
}
