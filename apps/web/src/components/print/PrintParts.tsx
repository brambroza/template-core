'use client';

import { branchText, buyerBranchText, companyContactLine, formatTaxId, type CompanyProfile, type PartyInfo } from '@erp/ui-schema';

/** Company letterhead + document title block, printed at the top of the first page. */
export function Letterhead({ company, title, docNo, copyLabel, subtitle }: { company: CompanyProfile | null; title: string; docNo: string; copyLabel?: string; subtitle?: string }) {
  const branch = company?.branch_text || company?.branch_label || branchText(company?.branch_code ?? '00000');
  const contact = companyContactLine(company);
  return (
    <header className="print-letterhead print-only">
      <div className="lh-company">
        {company?.logo && <img className="lh-logo" src={company.logo} alt="" />}
        <div className="lh-text">
          <p className="lh-name">{company?.legal_name || ''}</p>
          {company?.name_en && <p className="lh-name-en">{company.name_en}</p>}
          {company?.address && <p className="lh-address">{company.address}</p>}
          <p className="lh-meta">
            {company?.tax_id && <span>เลขประจำตัวผู้เสียภาษี {formatTaxId(company.tax_id)}</span>}
            {company?.tax_id && <span>{branch}</span>}
          </p>
          {contact && <p className="lh-meta">{contact}</p>}
        </div>
      </div>
      <div className="lh-doc">
        {copyLabel && <p className="lh-copy">{copyLabel}</p>}
        <h1 className="lh-title">{title}</h1>
        {docNo && <p className="lh-no">เลขที่ <b>{docNo}</b></p>}
        {subtitle && <p className="lh-period">{subtitle}</p>}
      </div>
    </header>
  );
}

/** Buyer block of a tax invoice / receipt: name, address, tax ID and branch (Revenue Code §86/4). */
export function BuyerBlock({ buyer, label = 'ลูกค้า / ผู้ซื้อ' }: { buyer: PartyInfo; label?: string }) {
  return (
    <section className="print-buyer print-only" aria-label={label}>
      <p className="pb-label">{label}</p>
      <p className="pb-name">{buyer.name}</p>
      {buyer.address && <p className="pb-address">{buyer.address}</p>}
      {(buyer.taxId || buyer.branch) && (
        <p className="pb-meta">
          {buyer.taxId && <span>เลขประจำตัวผู้เสียภาษี {formatTaxId(buyer.taxId)}</span>}
          {buyerBranchText(buyer) && <span>{buyerBranchText(buyer)}</span>}
        </p>
      )}
    </section>
  );
}

/** Signature boxes: a line to sign on, "( name )" or a blank name line, the role label and a date line. */
export function Signatures({ boxes }: { boxes: { label: string; name?: string }[] }) {
  if (!boxes.length) return null;
  return (
    <section className="print-signatures print-only" style={{ ['--sig-cols' as string]: Math.min(boxes.length, 4) }}>
      {boxes.map((b, i) => (
        <div key={`${b.label}-${i}`} className="sig">
          <div className="sig-line" />
          <p className="sig-name">({b.name ? <>&nbsp;{b.name}&nbsp;</> : '\u00a0'.repeat(2) + '.'.repeat(36) + '\u00a0'.repeat(2)})</p>
          <p className="sig-label">{b.label}</p>
          <p className="sig-date">วันที่ ......../......../........</p>
        </div>
      ))}
    </section>
  );
}

/**
 * The company's document note, printed under the signatures only on documents whose print spec asks for it
 * (`print.footer`); `payment` heads it as the payment terms. Page numbers come from the @page rule in globals.css.
 */
export function PrintFooter({ note, payment }: { note?: string | null; payment?: boolean }) {
  if (!note) return null;
  return (
    <footer className={payment ? 'print-footer print-only pf-payment' : 'print-footer print-only'}>
      {payment && <p className="pf-title">เงื่อนไขการชำระเงิน</p>}
      <p className="pf-note">{note}</p>
    </footer>
  );
}
