import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { ArrowLeft, Download, CreditCard, CheckCircle, Printer } from "lucide-react";

interface LineItem {
  description: string;
  quantity: number;
  unitPricePence: number;
  totalPence: number;
}

export default function Invoice() {
  const { projectId } = useParams<{ projectId: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [payOpen, setPayOpen] = useState(false);

  const { data, isLoading, error } = useQuery<{ invoice: any; template: any }>({
    queryKey: ['/api/projects', projectId, 'invoice'],
    queryFn: () => apiRequest('GET', `/api/projects/${projectId}/invoice`).then(r => r.json()),
    enabled: !!projectId,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#FF5A1F] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error || !data?.invoice) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-muted-foreground">
        <p className="text-lg font-semibold">Invoice not found</p>
        <Button variant="outline" onClick={() => setLocation('/')}>Back to dashboard</Button>
      </div>
    );
  }

  const { invoice, template } = data;
  const lineItems: LineItem[] = (() => { try { return JSON.parse(invoice.lineItems || '[]'); } catch { return []; } })();
  const isClient = user?.id === invoice.clientId;
  const isFreelancer = user?.id === invoice.freelancerId;
  const isPaid = invoice.status === 'paid';
  const accentColor = template?.accentColor || '#FF5A1F';

  function handlePrint() {
    window.print();
  }

  return (
    <>
      {/* Print styles — hidden on screen, full page on print */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .invoice-card { box-shadow: none !important; border: none !important; margin: 0 !important; max-width: 100% !important; }
        }
      `}</style>

      {/* Toolbar */}
      <div className="no-print sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-border px-6 py-3 flex items-center justify-between">
        <Button variant="ghost" size="sm" className="gap-2" onClick={() => setLocation('/')}>
          <ArrowLeft size={14} /> Back
        </Button>
        <div className="flex items-center gap-2">
          {isClient && !isPaid && (
            <Button
              size="sm"
              className="gap-2 text-white font-semibold"
              style={{ background: `linear-gradient(135deg,${accentColor},#FF8C42)` }}
              onClick={() => setPayOpen(true)}
              data-testid="btn-pay-invoice"
            >
              <CreditCard size={13} /> Pay £{(invoice.totalPence / 100).toFixed(2)}
            </Button>
          )}
          {isPaid && (
            <Badge className="gap-1.5 bg-green-500/10 text-green-600 border-green-200">
              <CheckCircle size={11} /> Paid
            </Badge>
          )}
          <Button variant="outline" size="sm" className="gap-2 no-print" onClick={handlePrint}>
            <Download size={13} /> Download PDF
          </Button>
        </div>
      </div>

      {/* Invoice card */}
      <div className="min-h-screen bg-muted/30 py-10 px-4 print:py-0 print:px-0 print:bg-white">
        <div
          className="invoice-card max-w-3xl mx-auto bg-white dark:bg-card rounded-2xl shadow-xl border border-border overflow-hidden"
          style={{ fontFamily: "'Satoshi', system-ui, sans-serif" }}
        >
          {/* Header band */}
          <div className="px-10 py-8 flex items-start justify-between" style={{ borderBottom: `3px solid ${accentColor}` }}>
            {/* Left: freelancer branding */}
            <div className="flex flex-col gap-2">
              {template?.logoUrl && (
                <img src={template.logoUrl} alt="logo" className="h-12 w-auto object-contain mb-1" />
              )}
              <p className="text-xl font-bold text-foreground">{template?.businessName || 'Freelancer'}</p>
              {template?.businessAddress && (
                <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">{template.businessAddress}</p>
              )}
              {template?.businessEmail && <p className="text-xs text-muted-foreground">{template.businessEmail}</p>}
              {template?.businessPhone && <p className="text-xs text-muted-foreground">{template.businessPhone}</p>}
              {template?.vatNumber && <p className="text-xs text-muted-foreground">VAT: {template.vatNumber}</p>}
            </div>

            {/* Right: invoice meta */}
            <div className="text-right flex flex-col gap-1.5">
              <p className="text-3xl font-black tracking-tight" style={{ color: accentColor }}>INVOICE</p>
              <p className="text-sm font-bold text-foreground">{invoice.invoiceNumber}</p>
              <p className="text-xs text-muted-foreground">Issued: {new Date(invoice.issuedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
              <div className="mt-2">
                {isPaid
                  ? <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">✓ PAID</span>
                  : <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold" style={{ background: `${accentColor}18`, color: accentColor }}>DUE</span>
                }
              </div>
            </div>
          </div>

          {/* Bill to + project */}
          <div className="px-10 py-6 grid grid-cols-2 gap-8 bg-muted/20">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Bill To</p>
              <p className="font-semibold text-foreground">{invoice.clientName}</p>
              {invoice.clientEmail && <p className="text-xs text-muted-foreground">{invoice.clientEmail}</p>}
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Project</p>
              <p className="font-semibold text-foreground">{invoice.projectTitle}</p>
            </div>
          </div>

          {/* Line items table */}
          <div className="px-10 py-6">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: `2px solid ${accentColor}20` }}>
                  <th className="text-left py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground pb-3">Description</th>
                  <th className="text-right py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground pb-3 w-16">Qty</th>
                  <th className="text-right py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground pb-3 w-24">Rate</th>
                  <th className="text-right py-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground pb-3 w-24">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="py-3.5 text-foreground font-medium">{item.description}</td>
                    <td className="py-3.5 text-right text-muted-foreground">{item.quantity}</td>
                    <td className="py-3.5 text-right text-muted-foreground">£{(item.unitPricePence / 100).toFixed(2)}</td>
                    <td className="py-3.5 text-right font-semibold text-foreground">£{(item.totalPence / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totals */}
            <div className="mt-4 flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-8 text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium w-24 text-right">£{(invoice.subtotalPence / 100).toFixed(2)}</span>
              </div>
              {invoice.vatPence > 0 && (
                <div className="flex items-center gap-8 text-sm">
                  <span className="text-muted-foreground">VAT</span>
                  <span className="font-medium w-24 text-right">£{(invoice.vatPence / 100).toFixed(2)}</span>
                </div>
              )}
              <div
                className="flex items-center gap-8 text-base font-bold mt-1 pt-3"
                style={{ borderTop: `2px solid ${accentColor}`, minWidth: 220 }}
              >
                <span style={{ color: accentColor }}>Total</span>
                <span className="w-24 text-right" style={{ color: accentColor }}>£{(invoice.totalPence / 100).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Notes + payment terms */}
          {(invoice.notes || template?.paymentTerms) && (
            <div className="px-10 py-5 border-t border-border space-y-3">
              {invoice.notes && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Notes</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{invoice.notes}</p>
                </div>
              )}
              {template?.paymentTerms && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Payment Terms</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{template.paymentTerms}</p>
                </div>
              )}
            </div>
          )}

          {/* Footer with Viewrr stamp — LOCKED, cannot be removed */}
          <div className="px-10 py-5 border-t border-border flex items-center justify-between bg-muted/10">
            <p className="text-[10px] text-muted-foreground">{template?.footerNote || ''}</p>
            {/* Viewrr stamp — always present */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full border"
              style={{ background: 'rgba(255,90,31,0.06)', borderColor: 'rgba(255,90,31,0.3)' }}
            >
              <svg width="14" height="14" viewBox="0 0 32 32" fill="none">
                <circle cx="16" cy="16" r="14" fill="#FF5A1F" />
                <path d="M9 11l7 10 7-10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[10px] font-bold tracking-wide" style={{ color: '#FF5A1F' }}>Powered by Viewrr</span>
            </div>
          </div>
        </div>
      </div>

      {/* Stripe pay dialog — redirect to project */}
      {payOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setPayOpen(false); }}
        >
          <div className="bg-background rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <p className="font-bold text-lg mb-1">Pay Invoice {invoice.invoiceNumber}</p>
            <p className="text-sm text-muted-foreground mb-4">Amount: <strong>£{(invoice.totalPence / 100).toFixed(2)}</strong></p>
            <p className="text-xs text-muted-foreground mb-4">Please return to the project workspace to complete your payment securely via Stripe.</p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPayOpen(false)}>Cancel</Button>
              <Button
                className="flex-1 text-white"
                style={{ background: `linear-gradient(135deg,#FF5A1F,#FF8C42)` }}
                onClick={() => { setPayOpen(false); setLocation('/'); }}
              >
                Go to Project
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
