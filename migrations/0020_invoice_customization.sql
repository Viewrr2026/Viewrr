-- Apply before deploying the invoice editor. Re-running preserves issued snapshots.
BEGIN;
ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS customization JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS presentation JSONB;
-- Older branding was not saved per invoice. Freeze the currently available details.
UPDATE invoices i SET presentation = jsonb_build_object(
  'version', 1,
  'branding', jsonb_build_object(
    'businessName', COALESCE(NULLIF(t.business_name,''),u.name),
    'businessAddress',COALESCE(t.business_address,''),'businessEmail',COALESCE(t.business_email,''),
    'businessPhone',COALESCE(t.business_phone,''),'logoUrl',COALESCE(t.logo_url,''),
    'vatNumber',COALESCE(t.vat_number,''),'paymentTerms',COALESCE(t.payment_terms,''),
    'footerNote',COALESCE(t.footer_note,''),'accentColor',COALESCE(t.accent_color,'#1F6255'),
    'customization',COALESCE(t.customization,'{}'::jsonb)),
  'details',jsonb_build_object('invoiceTitle',i.project_title,'invoiceNumber',i.invoice_number,
    'invoiceDate',LEFT(i.issued_at,10),'dueDate','','clientAddress','','purchaseOrder',''))
FROM users u LEFT JOIN invoice_templates t ON t.user_id=u.id
WHERE i.freelancer_id=u.id AND i.presentation IS NULL;
COMMIT;
