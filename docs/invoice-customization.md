# Freelancer invoice customisation

Freelancers open **Dashboard → Invoice settings** to save business details,
logo, colour, typeface, layout, document heading, payment terms and footer.
They can also choose an invoice prefix, payment window and default notes.
The default accent is Viewrr orange (`#FF5A1F`); saved custom colours stay in use.

**Create invoice** in a one-off project opens the live editor. Details, line
items and branding are editable before sending. The project title is read-only,
with an asterisk explaining that it comes from the linked project. The server
uses that project's current title when issuing the invoice, ignoring any title
override in the request. The settings preview explains its sample title in the
same way. The document preview uses the same component as the client's invoice
and print view. Per-invoice changes do
not overwrite saved defaults. A failed send keeps the entered details open.
Sending waits until a logo upload is ready.

The invoice stores its presentation when issued. Updating saved defaults later
does not rewrite the branding, address, terms or other details on old invoices.
Amounts are calculated on the server, participants come from the project and
payment status remains controlled by the existing payment flow. Agreed estimate
totals and VAT must match; pricing changes require a revised agreement. Legacy
projects also retain their agreed subtotal cap. Retainers keep their cycle
invoicing flow.

## Deployment

1. Apply `migrations/0020_invoice_customization.sql` to the target database
   **before deploying this code**. It adds the two JSONB columns read by the
   new editor and snapshots the currently available branding for older invoices.
   Historical branding changes made before this migration cannot be reconstructed.
2. Deploy the web/server change to Render.
3. Verify a freelancer can save defaults, create a project invoice and preview
   the same details from the client's account. Check A4 printing and phone widths.

No new environment variables, dependencies or iOS build are required for this
web editor. This change does not add a native invoice editor.

## Verification

- Eleven server tests cover migration replay, saved presentation, ownership,
  numbering, defaults, financial agreement and retry/immutability behaviour.
- JSDOM checks exercise actual React controls for defaults, per-invoice edits,
  preview updates, price validation, failed sends and failed-load recovery.
- Production build passes. Repository type checking has existing failures;
  this change introduces no new diagnostics by file and error code.
- Browser layout and print pagination need a real browser check before release;
  JSDOM does not validate either.
