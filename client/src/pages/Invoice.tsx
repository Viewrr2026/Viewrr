import { InvoiceDocument } from "@/components/invoice/InvoiceDocument";
import { resolveInvoicePresentation } from "@shared/invoice-presentation";
import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { ArrowLeft, Download, CreditCard, CheckCircle, Printer } from "lucide-react";
import { StripePaymentDialog } from "@/components/DeliverablesSection";

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
  const queryClient = useQueryClient();
  const [stripeOpen, setStripeOpen] = useState(false);

  const { data, isLoading, error } = useQuery<{ invoice: any; template: any; refunds: any[] }>({
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
        <Button variant="outline" onClick={() => window.history.back()}>Back to dashboard</Button>
      </div>
    );
  }

  const { invoice, template } = data;
  const lineItems: LineItem[] = (() => { try { return JSON.parse(invoice.lineItems || '[]'); } catch { return []; } })();
  const isClient = user?.id === invoice.clientId;
  const isFreelancer = user?.id === invoice.freelancerId;
  const isPaid = invoice.status === 'paid';
  const presentation = resolveInvoicePresentation(invoice, template);
  const accentColor = presentation.branding.accentColor;

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
        <Button variant="ghost" size="sm" className="gap-2" onClick={() => window.history.back()}>
          <ArrowLeft size={14} /> Back
        </Button>
        <div className="flex items-center gap-2">
          {isClient && !isPaid && (
            <Button
              size="sm"
              className="gap-2 text-white font-semibold"
              style={{ background: `linear-gradient(135deg,${accentColor},#FF8C42)` }}
              onClick={() => setStripeOpen(true)}
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
            <Download size={13} /> Print / save PDF
          </Button>
        </div>
      </div>

      {!!data.refunds?.length && <section className="no-print mx-auto max-w-3xl p-5 border rounded-xl my-4" aria-label="Refund history">
        <h2 className="font-semibold">Refund history</h2>
        <p className="text-sm text-muted-foreground">The original invoice is preserved. Refunds are recorded separately.</p>
        {data.refunds.map(refund => <div key={refund.stripe_refund_id} className="flex justify-between py-2 text-sm">
          <span>{new Date(refund.created_at).toLocaleDateString("en-GB")}</span>
          <span>£{(refund.amount_pence / 100).toFixed(2)} · {refund.status}</span>
        </div>)}
      </section>}
      {isClient && isPaid && <p className="text-center text-sm no-print my-4">
        <a className="underline" href={`mailto:support@viewrr.co.uk?subject=${encodeURIComponent(`Refund request — invoice ${invoice.invoiceNumber}`)}`}>Request help with a refund</a>
      </p>}
      <div className="bg-muted/30 py-8 px-3 print:p-0 print:bg-white">
        <InvoiceDocument invoice={invoice} presentation={presentation}/>
      </div>

      <StripePaymentDialog
        open={stripeOpen}
        onClose={() => setStripeOpen(false)}
        projectId={invoice.projectId}
        projectTitle={invoice.projectTitle || 'Invoice'}
        clientUserId={invoice.clientId}
        freelancerName={template?.businessName || "the freelancer"}
        agreedAmountPence={invoice.totalPence}
        onPaymentDone={() => {
          setStripeOpen(false);
          queryClient.invalidateQueries({ queryKey: ['/api/projects', projectId, 'invoice'] });
          queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
        }}
      />
    </>
  );
}
