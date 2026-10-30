import { z } from 'zod';

export const DEFAULT_INVOICE_ACCENT_COLOR = '#FF5A1F';

const copy = (max: number) => z.string().trim().max(max).default('');
const email = z.union([z.literal(''), z.string().trim().email().max(254)]).default('');
const date = z.string().refine(v => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v), 'Enter a valid calendar date.').default('');
const logo = z.string().max(2000).refine(v => {
  if (!v || /^\/api\/media\/\d+\/[A-Za-z0-9._-]+\/original\.(?:jpg|png|webp)$/.test(v)) return true;
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; }
}, 'Use an HTTPS image URL or upload a logo.').nullish().transform(v => v || '');

export const invoiceCustomizationSchema = z.object({
  layout: z.enum(['classic', 'minimal', 'band']).default('classic'),
  font: z.enum(['modern', 'serif', 'mono']).default('modern'),
  logoPosition: z.enum(['left', 'right']).default('left'),
  heading: z.string().trim().min(1).max(50).default('Invoice'),
  companyNumber: copy(80),
  invoicePrefix: z.string().trim().regex(/^[A-Za-z0-9_-]{1,20}$/, 'Use letters, numbers, hyphens or underscores in the prefix.').default('INV'),
  dueDays: z.number().int().min(0).max(365).default(14),
  defaultNotes: copy(4000),
  showViewrrBranding: z.boolean().default(true),
}).default({});

export const invoiceBrandingSchema = z.object({
  businessName: copy(200), businessAddress: copy(1000), businessEmail: email,
  businessPhone: copy(60), logoUrl: logo, vatNumber: copy(80),
  paymentTerms: z.string().trim().max(4000).default('Payment processed securely through Viewrr'),
  footerNote: copy(1000),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, `Use a six-digit hex colour, such as ${DEFAULT_INVOICE_ACCENT_COLOR}.`).default(DEFAULT_INVOICE_ACCENT_COLOR),
  customization: invoiceCustomizationSchema,
});
export const invoiceDetailsSchema = z.object({
  invoiceNumber: z.string().trim().max(80).regex(/^[A-Za-z0-9_./-]*$/, 'Invoice numbers may contain letters, numbers, dots, hyphens, slashes and underscores.').default(''),
  invoiceTitle: copy(300), invoiceDate: date, dueDate: date,
  clientAddress: copy(1000), purchaseOrder: copy(120),
}).refine(v => !v.invoiceDate || !v.dueDate || v.dueDate >= v.invoiceDate, { path: ['dueDate'], message: 'The due date must be on or after the invoice date.' });
export const invoiceIssueDetailsSchema = z.object({
  branding: invoiceBrandingSchema.optional(),
  details: invoiceDetailsSchema.optional(),
  clientName: z.string().trim().max(300).optional(),
  clientEmail: email.optional(),
});
export const invoicePresentationSchema = z.object({version: z.literal(1), branding: invoiceBrandingSchema, details: invoiceDetailsSchema});
export type InvoiceBranding = z.infer<typeof invoiceBrandingSchema>;
export type InvoiceDetails = z.infer<typeof invoiceDetailsSchema>;
export type InvoicePresentation = z.infer<typeof invoicePresentationSchema>;

export function normalizeInvoiceBranding(raw: any, name = ''): InvoiceBranding {
  const source = raw || {};
  const result: any = {};
  for (const [key, schema] of Object.entries(invoiceBrandingSchema.shape)) {
    if (key === 'customization') continue;
    const parsed = schema.safeParse(source[key]);
    result[key] = parsed.success ? parsed.data : schema.parse(undefined);
  }
  const customization: any = {};
  for (const [key, schema] of Object.entries(invoiceCustomizationSchema.removeDefault().shape)) {
    const parsed = schema.safeParse(source.customization?.[key]);
    customization[key] = parsed.success ? parsed.data : schema.parse(undefined);
  }
  return {...result, businessName: result.businessName || name, customization};
}
export function dateAfterDays(value: string, days: number) {
  const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function createInvoicePresentation(branding: InvoiceBranding, title: string, input?: Partial<InvoiceDetails>, now = new Date().toISOString()): InvoicePresentation {
  const invoiceDate = input?.invoiceDate || now.slice(0, 10);
  // The project owns the title; an invoice request cannot replace it.
  const details = invoiceDetailsSchema.parse({...input, invoiceTitle: title, invoiceDate,
    dueDate: input?.dueDate ?? dateAfterDays(invoiceDate, branding.customization.dueDays)});
  return {version: 1, branding, details};
}
export function resolveInvoicePresentation(invoice: any, template?: any): InvoicePresentation {
  const saved = invoicePresentationSchema.safeParse(invoice.presentation);
  if (saved.success) return saved.data;
  // Legacy snapshots can contain old invalid fields. Keep the saved business
  // identity rather than silently replacing it with today's template.
  const historical = invoice.presentation?.version === 1 ? invoice.presentation : null;
  const branding = normalizeInvoiceBranding(historical?.branding ?? template);
  const historicalDetails = invoiceDetailsSchema.safeParse(historical?.details);
  if (historical && historicalDetails.success) return {version:1,branding,details:historicalDetails.data};
  return createInvoicePresentation(branding, invoice.projectTitle || '', {
    invoiceNumber: invoice.invoiceNumber, invoiceDate: String(invoice.issuedAt || '').slice(0,10), dueDate: '',
  });
}
export function invoiceError(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map(i => i.message).join(' ');
  const message = error instanceof Error ? error.message : 'Unable to save. Please try again.';
  try {
    const body = JSON.parse(message.replace(/^\d+:\s*/, ''));
    const value = body.message || body.error || message;
    try { const issues = JSON.parse(value); if (Array.isArray(issues)) return issues.map(i => i.message).join(' '); } catch {}
    return value;
  } catch { return message; }
}
