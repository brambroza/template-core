'use client';

import { History } from 'lucide-react';
import { useState } from 'react';
import { auditActionLabel, auditPerm, formatDate, hasPerm, type AuditRow } from '@erp/ui-schema';
import { api } from '@/lib/api';
import { loadSession } from '@/lib/session';

/**
 * "ประวัติการแก้ไข" of one record on every detail page: who did what and when, from the module's kernel audit log
 * (`GET /_audit?ref=<id>`). Shown only to users with `<module>.audit.read`; loaded when opened.
 */
export function AuditTrail({ module, recordId }: { module: string; recordId: string }) {
  const perms = loadSession()?.permissions ?? [];
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState('');
  if (!hasPerm(perms, auditPerm(module))) return null;

  const load = () => {
    if (rows) return;
    api<AuditRow[]>(module, '/_audit', { query: { ref: recordId, limit: 200 } }).then(setRows).catch((e) => { setRows([]); setError(e.message); });
  };

  return (
    <details className="detail-lines audit-trail no-print" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) load(); }}>
      <summary><History size={16} aria-hidden /> ประวัติการแก้ไข</summary>
      {error && <p className="form-error" role="alert">{error}</p>}
      {!rows && <p className="muted">กำลังโหลด…</p>}
      {rows && rows.length === 0 && !error && <p className="muted">ยังไม่มีประวัติ (บันทึกตั้งแต่เปิดใช้ระบบประวัติการแก้ไข)</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap stack">
          <table className="data stack" role="table">
            <thead role="rowgroup"><tr role="row"><th role="columnheader">เวลา</th><th role="columnheader">ผู้ทำรายการ</th><th role="columnheader">รายการ</th><th role="columnheader">ข้อมูลที่ส่ง</th></tr></thead>
            <tbody role="rowgroup">
              {rows.map((r) => (
                <tr role="row" key={r.id}>
                  <td role="cell" data-label="เวลา" className="nowrap">{formatDate(r.at, true)}</td>
                  <td role="cell" data-label="ผู้ทำรายการ">{r.user_name ?? r.user_id ?? '—'}</td>
                  <td role="cell" data-label="รายการ" title={r.action}>{auditActionLabel(r)}</td>
                  <td role="cell" data-label="ข้อมูลที่ส่ง" className="audit-summary">{r.summary_text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
