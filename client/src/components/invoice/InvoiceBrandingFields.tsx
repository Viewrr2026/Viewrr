import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MediaUpload } from '@/components/MediaUpload';
import type { InvoiceBranding } from '@shared/invoice-presentation';

export function InvoiceBrandingFields({value, onChange, defaults = false, onUploadBusy}: {value: InvoiceBranding; onChange:(v: InvoiceBranding)=>void; defaults?:boolean; onUploadBusy?:(busy:boolean)=>void}) {
  const set = (key:keyof InvoiceBranding, v:any) => onChange({...value,[key]:v});
  const custom = (key:keyof InvoiceBranding['customization'], v:any) => set('customization',{...value.customization,[key]:v});
  const field = (title:string,key:keyof Omit<InvoiceBranding,'customization'>,multi=false,type='text') => <label key={key}>{title}{multi ? <Textarea value={value[key]} onChange={e=>set(key,e.target.value)} rows={3}/> : <Input type={type} value={value[key]} onChange={e=>set(key,e.target.value)}/>}</label>;
  return <div className="invoice-fields">
    {field('Business / trading name','businessName')}
    {field('Business address','businessAddress',true)}
    <div className="invoice-two-fields">{field('Business email','businessEmail',false,'email')}{field('Business phone','businessPhone')}</div>
    <div className="invoice-two-fields">{field('VAT number','vatNumber')}<label>Company number<Input value={value.customization.companyNumber} onChange={e=>custom('companyNumber',e.target.value)}/></label></div>
    <fieldset className="space-y-2"><legend className="text-sm font-semibold mb-2">Your logo</legend><MediaUpload scope="profile" imagesOnly onBusyChange={onUploadBusy} publicUsageText="Your logo is stored as a public image for use on invoices." onUploaded={url=>set('logoUrl',url)}/>
      {field('Logo image URL','logoUrl')}{value.logoUrl && <button type="button" className="text-sm underline" onClick={()=>set('logoUrl','')}>Remove logo</button>}</fieldset>
    <div className="invoice-two-fields"><label>Layout<select value={value.customization.layout} onChange={e=>custom('layout',e.target.value)}><option value="classic">Classic letterhead</option><option value="minimal">Minimal</option><option value="band">Colour band</option></select></label>
      <label>Typeface<select value={value.customization.font} onChange={e=>custom('font',e.target.value)}><option value="modern">Modern</option><option value="serif">Serif</option><option value="mono">Monospace</option></select></label></div>
    <div className="invoice-two-fields"><label>Logo position<select value={value.customization.logoPosition} onChange={e=>custom('logoPosition',e.target.value)}><option value="left">Left</option><option value="right">Right</option></select></label>
      {field('Accent colour','accentColor',false,'color')}</div>
    <label>Document heading<Input value={value.customization.heading} onChange={e=>custom('heading',e.target.value)}/></label>
    {field('Payment terms','paymentTerms',true)}{field('Footer message','footerNote',true)}
    <label className="!flex items-center gap-2"><input type="checkbox" checked={value.customization.showViewrrBranding} onChange={e=>custom('showViewrrBranding',e.target.checked)}/>Show “Powered by Viewrr” in the footer</label>
    {defaults && <><div className="invoice-two-fields"><label>Invoice number prefix<Input value={value.customization.invoicePrefix} onChange={e=>custom('invoicePrefix',e.target.value)}/></label>
      <label>Default payment window (days)<Input type="number" min="0" max="365" value={value.customization.dueDays} onChange={e=>custom('dueDays',Number(e.target.value))}/></label></div>
      <label>Default invoice notes<Textarea rows={3} value={value.customization.defaultNotes} onChange={e=>custom('defaultNotes',e.target.value)}/></label></>}
  </div>;
}
