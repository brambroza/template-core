'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { flowPosition, formatValue, get, type Action, type DetailScreen } from '@erp/ui-schema';
import { SPRING, STAGGER } from '@/lib/motion';
import { Value } from './Value';

const blank = (v: unknown) => v === undefined || v === null || v === '' || v === false;

/**
 * "บันทึกแล้ว" — shown at the top of a document right after it was created (FormView opens the detail with `?saved=1`).
 * A check draws in, then the date tile, the key facts and "ขั้นต่อไป" (the actions now open on this document) blur in one
 * by one. Inline, never an overlay: it does not block anything and closes with ×.
 */
export function SavedPanel({ screen, record, docNo, next, onClose }: {
  screen: DetailScreen; record: Record<string, unknown>; docNo: string; next: Action[]; onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  useEffect(() => { if (!open) { const t = setTimeout(onClose, 320); return () => clearTimeout(t); } }, [open]);

  const dateField = screen.fields.find((f) => f.format === 'date' && !blank(get(record, f.key)));
  const facts = screen.fields
    .filter((f) => f !== dateField && f.format !== 'status' && !blank(get(record, f.key)) && f.format !== 'boolean')
    .slice(0, 4);
  const step = screen.flow ? flowPosition(screen.flow, record) : null;
  const stepLabel = step && screen.flow ? (step.exit?.label ?? screen.flow.steps[step.index]?.label) : undefined;
  const [day, month, year] = dateField ? formatValue(get(record, dateField.key), 'date').split(' ') : [];

  return (
    <AnimatePresence>
      {open && (
        <motion.section className="saved-panel no-print" role="status" aria-label={`บันทึก ${docNo} แล้ว`}
          initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={SPRING.soft}>
          <motion.div variants={STAGGER.parent} initial="hidden" animate="show" className="saved-body">
            <motion.header variants={STAGGER.item} className="saved-head">
              <svg className="saved-check" width="40" height="40" viewBox="0 0 40 40" aria-hidden>
                <motion.circle cx="20" cy="20" r="17" fill="none" strokeWidth="2.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, ease: 'easeOut' }} />
                <motion.path d="M12.5 20.5l5 5 10-11" fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.4, ease: 'easeOut' }} />
              </svg>
              <div>
                <h2>บันทึกแล้ว</h2>
                <p>{screen.title} {docNo}{stepLabel ? ` · สถานะ ${stepLabel}` : ''}</p>
              </div>
              <button type="button" className="icon-btn" aria-label="ปิด" onClick={() => setOpen(false)}><X size={16} aria-hidden /></button>
            </motion.header>

            {(dateField || facts.length > 0) && (
              <motion.div variants={STAGGER.item} className="saved-card">
                {dateField && (
                  <div className="saved-date">
                    <motion.div className="date-tile" initial={{ scale: 0.6, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ ...SPRING.pop, delay: 0.25 }}>
                      <small>{month}</small><b>{day}</b>
                    </motion.div>
                    <div><small>{dateField.label}</small><b>{day} {month} {year}</b></div>
                  </div>
                )}
                {facts.length > 0 && (
                  <motion.dl variants={STAGGER.parent} initial="hidden" animate="show">
                    {facts.map((f) => (
                      <motion.div key={f.key} variants={STAGGER.item}><dt>{f.label}</dt><dd><Value value={get(record, f.key)} format={f.format} /></dd></motion.div>
                    ))}
                  </motion.dl>
                )}
              </motion.div>
            )}

            {next.length > 0 && (
              <motion.div variants={STAGGER.item} className="saved-next">
                <p className="saved-next-title">ขั้นต่อไป</p>
                <motion.ul variants={STAGGER.parent} initial="hidden" animate="show">
                  {next.slice(0, 4).map((a, i) => (
                    <motion.li key={a.id} variants={STAGGER.item}>
                      <span className={`saved-step${i === 0 ? ' is-next' : ''}`} aria-hidden>{i + 1}</span>
                      <span>{a.label}</span>
                      <motion.span className={`pill ${i === 0 ? 'tone-progress' : 'tone-neutral'}`} initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                        transition={{ ...SPRING.pop, delay: 0.45 + i * 0.08 }}>
                        {i === 0 ? 'ถัดไป' : 'ทำได้'}
                      </motion.span>
                    </motion.li>
                  ))}
                </motion.ul>
              </motion.div>
            )}
          </motion.div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
