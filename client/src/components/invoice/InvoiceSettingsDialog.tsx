import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/AuthProvider';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { createInvoicePresentation, invoiceBrandingSchema, invoiceError, normalizeInvoiceBranding } from '@shared/invoice-presentation';
import { InvoiceBrandingFields } from './InvoiceBrandingFields';
import { InvoiceDocument } from './InvoiceDocument';

export function InvoiceSettingsDialog({open,onClose}:{open:boolean;onClose:()=>void}) {
  return <Dialog open={open} onOpenChange={v=>!v&&onClose()}><DialogContent className="invoice-editor-content"><div className="invoice-editor-header"><DialogTitle>Invoice Settings</DialogTitle><DialogDescription>Save your branding and defaults for future invoices. You can also customise each invoice before sending it.</DialogDescription></div>{open && <LoadSettings onClose={onClose}/>}</DialogContent></Dialog>;
}
function LoadSettings({onClose}:{onClose:()=>void}) {
  const {user}=useAuth();
  const query=useQuery({queryKey:['/api/invoice-template',user?.id],queryFn:async()=> (await apiRequest('GET','/api/invoice-template')).json(),retry:false,refetchOnWindowFocus:false});
  if(query.isPending) return <p className="p-6" role="status">Loading your invoice settings…</p>;
  if(query.isError) return <div className="p-6"><p role="alert">Your invoice settings could not be loaded.</p><Button onClick={()=>query.refetch()}>Retry</Button></div>;
  return <SettingsForm existing={query.data} name={user?.name||''} onClose={onClose}/>;
}
function SettingsForm({existing,name,onClose}:{existing:any;name:string;onClose:()=>void}) {
  const [branding,setBranding]=useState(()=>normalizeInvoiceBranding(existing,name));
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const [uploadBusy,setUploadBusy]=useState(false);
  const queryClient=useQueryClient(); const {toast}=useToast();
  const safeBranding=normalizeInvoiceBranding(branding,name);
  const presentation=createInvoicePresentation(safeBranding,'Your project title *');
  presentation.details.invoiceNumber=`${safeBranding.customization.invoicePrefix}-00001`;
  const sample={clientName:'Example Client',clientEmail:'client@example.com',notes:branding.customization.defaultNotes,
    lineItems:[{description:'Creative production',quantity:1,unitPricePence:80000,totalPence:80000}],subtotalPence:80000,vatPence:0,totalPence:80000};
  async function save() {
    if(uploadBusy)return;setSaving(true);setError('');
    try {await apiRequest('POST','/api/invoice-template',invoiceBrandingSchema.parse(branding));await queryClient.invalidateQueries({queryKey:['/api/invoice-template']});toast({title:'Invoice settings saved'});onClose();}
    catch(e){setError(invoiceError(e));} finally {setSaving(false);}
  }
  return <><div className="invoice-editor-body"><div className="invoice-editor-form"><InvoiceBrandingFields value={branding} onChange={setBranding} onUploadBusy={setUploadBusy} defaults/>{error&&<p role="alert" className="invoice-editor-error">{error}</p>}</div><div className="invoice-editor-preview"><h3>Live preview · sample details</h3><p className="text-xs text-muted-foreground mb-3">* Automatically uses the title of the project you're invoicing.</p><InvoiceDocument invoice={sample} presentation={presentation} preview/></div></div><div className="invoice-editor-footer"><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={save} disabled={saving||uploadBusy}>{saving?'Saving…':'Save invoice settings'}</Button></div></>;
}
