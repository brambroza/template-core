'use client';

import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { paginate, PAGE_SIZES } from '@erp/ui-schema';
import { SPRING } from '@/lib/motion';

/**
 * Page controls under a list: "แสดง 26–50 จาก 340 รายการ", ‹ 1 … 4 5 6 … 14 ›, and rows per page.
 * The current page's highlight slides to the new page (Motion layoutId). Phones keep ‹ current › only.
 */
export function Pager({ total, page, size, capped, onPage, onSize }: {
  total: number; page: number; size: number; capped?: boolean; onPage: (page: number) => void; onSize: (size: number) => void;
}) {
  const pg = paginate(total, page, size);
  const fmt = (n: number) => n.toLocaleString('th-TH');
  return (
    <nav className="pager no-print" aria-label="แบ่งหน้า">
      <p className="pager-info" role="status">
        แสดง <b>{fmt(total ? pg.start + 1 : 0)}–{fmt(pg.end)}</b> จาก <b>{fmt(total)}</b> รายการ
        {capped && <span className="pager-more"> · แสดงสูงสุด {fmt(total)} รายการ ใช้ตัวกรองเพื่อหารายการที่เก่ากว่า</span>}
      </p>
      {pg.pages > 1 && (
        <div className="pager-pages">
          <button type="button" className="pager-btn" aria-label="หน้าก่อน" disabled={pg.page === 1} onClick={() => onPage(pg.page - 1)}><ChevronLeft size={16} aria-hidden /></button>
          {pg.items.map((it, i) => (it === '…'
            ? <span key={`gap-${i}`} className="pager-gap" aria-hidden>…</span>
            : (
              <button key={it} type="button" className="pager-btn pager-num" aria-label={`หน้า ${it}`} aria-current={it === pg.page ? 'page' : undefined} onClick={() => onPage(it)}>
                {it === pg.page && <motion.span layoutId="pager-pill" className="pager-pill" transition={SPRING.snappy} aria-hidden />}
                <span>{it}</span>
              </button>
            )))}
          <button type="button" className="pager-btn" aria-label="หน้าถัดไป" disabled={pg.page === pg.pages} onClick={() => onPage(pg.page + 1)}><ChevronRight size={16} aria-hidden /></button>
        </div>
      )}
      <label className="pager-size">
        ต่อหน้า
        <select value={size} onChange={(e) => onSize(Number(e.target.value))} aria-label="จำนวนรายการต่อหน้า">
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
    </nav>
  );
}
