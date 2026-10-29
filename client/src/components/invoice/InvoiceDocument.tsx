import type { CSSProperties } from 'react';
import { resolveInvoicePresentation, type InvoicePresentation } from '@shared/invoice-presentation';
import './invoice.css';

export const money = (pence: number) => new Intl.NumberFormat('en-GB', {style:'currency', currency:'GBP'}).format((Number(pence)||0)/100);
const displayDate = (value: string) => value ? new Date(`${value.slice(0,10)}T12:00:00Z`).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '';
export function InvoiceDocument({invoice, template, presentation: override, preview = false}: {invoice: any; template?: any; presentation?: InvoicePresentation; preview?: boolean}) {
  const presentation = override || resolveInvoicePresentation(invoice, template);
  const {branding: b, details: d} = presentation;
  const {customization: x} = b;
  let items: any[] = [];
  try {items = Array.isArray(invoice.lineItems) ? invoice.lineItems : JSON.parse(invoice.lineItems || '[]');} catch {}
  const accent = /^#[0-9a-f]{6}$/i.test(b.accentColor) ? b.accentColor : '#1F6255';
  const font = {modern:"'Satoshi',system-ui,sans-serif",serif:'Georgia,serif',mono:'ui-monospace,monospace'}[x.font];
  return <article aria-label={preview ? 'Invoice preview' : 'Invoice document'} className={`invoice-document invoice-${x.layout}`} style={{'--invoice-accent':accent,fontFamily:font} as CSSProperties}>
    <header className={`invoice-brand invoice-logo-${x.logoPosition}`}>
      {b.logoUrl && <img src={b.logoUrl} alt={`${b.businessName || 'Business'} logo`} referrerPolicy="no-referrer" />}
      <div><h2>{b.businessName || 'Your business name'}</h2>{b.businessEmail && <p>{b.businessEmail}</p>}</div>
    </header>
    <section className="invoice-columns invoice-heading">
      <div><h1>{x.heading}</h1><h3>Bill to</h3><strong>{invoice.clientName || (preview ? 'Client name' : '')}</strong>
        {d.clientAddress && <p className="invoice-multiline">{d.clientAddress}</p>}{invoice.clientEmail && <p>{invoice.clientEmail}</p>}</div>
      <div><h2>{d.invoiceTitle || invoice.projectTitle}</h2><h3>Invoice number</h3><strong>{d.invoiceNumber || invoice.invoiceNumber || 'Assigned when sent'}</strong>
        <div className="invoice-columns invoice-meta"><div><h3>Invoice date</h3><p>{displayDate(d.invoiceDate)}</p></div>
          {d.purchaseOrder && <div><h3>Reference / PO</h3><p>{d.purchaseOrder}</p></div>}</div></div>
    </section>
    <section className="invoice-payment"><div><h3>{invoice.status === 'paid' ? 'Payment confirmed' : d.dueDate ? 'Due by' : 'Payment due'}</h3>
      <strong>{invoice.status === 'paid' ? 'Paid' : displayDate(d.dueDate) || 'On receipt'}</strong></div>
      <div><h3>{invoice.status === 'paid' ? 'Invoice total' : 'Amount due'}</h3><strong className="invoice-amount">{money(invoice.totalPence)}</strong></div></section>
    <table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead>
      <tbody>{items.map((item,i) => <tr key={i}><td className="invoice-multiline">{item.description || 'Item description'}</td><td>{item.quantity}</td><td>{money(item.unitPricePence)}</td><td>{money(item.totalPence ?? Math.round(item.quantity*item.unitPricePence))}</td></tr>)}</tbody></table>
    <section className="invoice-columns invoice-summary"><div>
      {invoice.notes && <><h3>Notes</h3><p className="invoice-multiline">{invoice.notes}</p></>}
      {b.paymentTerms && <><h3>Payment terms</h3><p className="invoice-multiline">{b.paymentTerms}</p></>}
      <p className="invoice-secure">Pay securely through Viewrr.</p>
      {preview && <p className="invoice-draft">Preview only. This invoice has not been sent.</p>}</div>
      <dl><div><dt>Subtotal</dt><dd>{money(invoice.subtotalPence)}</dd></div><div><dt>VAT</dt><dd>{money(invoice.vatPence)}</dd></div><div className="invoice-total"><dt>Total</dt><dd>{money(invoice.totalPence)}</dd></div></dl></section>
    <footer><div className="invoice-columns"><div><h3>Business details</h3><strong>{b.businessName}</strong><p className="invoice-multiline">{b.businessAddress}</p>
      {x.companyNumber && <p>Company: {x.companyNumber}</p>}{b.vatNumber && <p>VAT: {b.vatNumber}</p>}</div><div><h3>Contact</h3><p>{b.businessEmail}</p><p>{b.businessPhone}</p></div></div>
      {b.footerNote && <p className="invoice-multiline invoice-footer-note">{b.footerNote}</p>}
      {x.showViewrrBranding && <p className="invoice-powered">Powered by Viewrr</p>}</footer>
  </article>;
}
