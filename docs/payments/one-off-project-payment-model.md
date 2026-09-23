# One-off project payment model

Status: Product model agreed with founder; implementation gaps and Apple classification remain open.
Owner: Viewrr product team.
Last reviewed: 23 September 2026.
Code baseline: `b534de86990388bd8939165a7381079cc5b16217` on `main`.

## Purpose and scope

This is the internal reference for one-off commissioned-service payments across Viewrr web and mobile. It records the intended commercial model, evidence in the current implementation, and what must be verified before using this explanation in Apple review notes.

It covers projects with `isRetainer = 0`. Retainer billing, Pro subscriptions, paid visibility and reusable digital-product sales require separate specifications. No payment behaviour or customer terms are changed by this document.

## Agreed product model

A client commissions a named freelancer to perform a defined piece of creative work. The parties agree the brief, price and bespoke deliverables. Viewrr supports discovery, communication, project coordination, invoicing, payment processing and delivery access.

The intended service is useful outside Viewrr: for example, a freelancer creates a promotional video that the client publishes on its own website. Viewing or retrieving the result through Viewrr is part of coordinating and delivering that commission.

This is the agreed product model, not a claim that every existing project is verified to meet it. An agreed category label, a downloadable file or the word “service” alone does not establish its payment-policy classification.

## Supported types and examples

Examples below illustrate the model; they are not verified customer transactions.

| Type | Current code evidence | Example of intended external use | Qualification |
|---|---|---|---|
| Videography | Brief category, marketplace specialism and stage template | Film a client's event and deliver a promotional video for its website | Confirm the actual scope and usage |
| Video editing | Brief category and marketplace specialism | Edit client-supplied footage into an advert for the client's channels | Asynchronous work; do not claim the real-time service exception |
| Photography | Brief category, marketplace specialism and stage template | Photograph products for a client's online shop | Confirm commission and delivery terms |
| Marketing | Brief category and Marketer specialism; Marketing Campaign stage template | Produce bespoke campaign strategy and assets for external channels | Broad category; inspect what is actually sold |
| Graphic design | Stage template | Create bespoke packaging artwork for client production | Template presence is not proof of a dedicated marketplace category |
| Website design | Stage template | Design and build a client's own website | Confirm scope, hosting and any ongoing services separately |
| Other / Custom | Other brief category and Custom stage template | Individually scoped creative service | No blanket classification; review the particular purchase |

Sources: [PostBrief.tsx](../../client/src/pages/PostBrief.tsx), [Marketplace.tsx](../../client/src/pages/Marketplace.tsx), [schema.ts](../../shared/schema.ts).

## How closely the implementation matches

| Model statement | Evidence | Remaining limitation |
|---|---|---|
| A project has an identified client and freelancer | Required `clientId` and `freelancerId`; project creation checks distinct existing users | Does not prove a separately signed service contract |
| Work has a brief and scope | Project title/description, optional source brief, stages and deliverables | Source brief is optional; scope completeness is not universally enforced |
| The parties agree a price | Proposal/counteroffer acceptance paths populate `agreedAmountPence` | The field is nullable; direct project creation does not require it |
| Checkout charges a server-held amount | `createPayment` uses `invoice.totalPence` | Invoice creation derives totals from submitted line items; no comparison with `agreedAmountPence` was found in that route |
| Work is bespoke and used outside Viewrr | Categories and workflows support this use case | No dedicated external-use classification was identified; free text and Other permit broader uses |
| Payment controls client delivery access | Deliverables endpoint omits URLs while project is unpaid | Legacy paid-status mutation routes can undermine this gate |

The agreed-price statement must not be represented as uniformly enforced until invoice totals and accepted scope changes are validated against the agreed project amount. The current Terms page already makes a stronger agreed-price claim; reconcile behaviour and terms before release.

Sources: [routes.ts](../../server/routes.ts), [payment-service.ts](../../server/payment-service.ts), [Terms.tsx](../../client/src/pages/Terms.tsx).

## Current payment responsibilities

| Participant | Current role |
|---|---|
| Client | Commissions the freelancer and pays the project invoice |
| Freelancer | Provides the service, issues the invoice and connects a Stripe account |
| Viewrr backend | Checks parties/invoice, derives payment amounts, creates the Stripe payment and updates records |
| Stripe | Processes payment and destination-charge allocation; handles connected-account payouts |
| Viewrr administrators | Access refund, reconciliation and payment oversight functions |

The current Terms describe Viewrr as an intermediary. That description does not independently settle merchant, tax or other legal responsibilities.

### Website

1. Freelancer issues a project invoice. The route checks Stripe readiness when Stripe is configured, but currently allows invoice creation if the readiness lookup throws.
2. Client opens checkout. The web deliverables component calls `POST /api/stripe/create-payment-intent`, which delegates to `createPayment`. A newer `POST /api/projects/:projectId/payments` route also exists.
3. The backend checks the client and invoice and performs a further Connect readiness check.
4. A GBP PaymentIntent uses `transfer_data.destination`, `application_fee_amount` and `on_behalf_of`.
5. The client confirms through Stripe's web payment UI.
6. The normal success webhook validates the payment and updates invoice/project financial status. Project completion is a separate business event in this normal path.
7. Client deliverable URLs become accessible once the project is marked paid.

### Mobile

Mobile displays project/payment state and gated deliverables using the shared backend. Current payment buttons hand off to web; native Stripe checkout and Apple IAP are not implemented in the inspected mobile package.

The project handoff currently generates `/project/{id}`, which has no corresponding web route. Web also uses hash routing. This must be corrected before describing the handoff as working.

Sources: [DeliverablesSection.tsx](../../client/src/components/DeliverablesSection.tsx), [mobile webLinks.ts](../../mobile/src/components/work/webLinks.ts), [mobile package.json](../../mobile/package.json), [App.tsx](../../client/src/App.tsx).

### Commission, payout and refunds

- Current payment creation calculates an 11% standard fee or 8% for an eligible Pro freelancer. It derives the rate at payment creation and stores the resulting amounts. Do not claim this code locks the rate at invoice issuance.
- The normal one-off path is a destination charge. It does not wait for a separate Viewrr release approval.
- Payout configuration requests automatic daily payouts. Allocation, available Stripe balance and bank receipt are distinct; live account settings and settlement timing are not verified here.
- Admin refunds request transfer reversal. The inspected refund request does not request refunding the application fee. This needs explicit product review before promising fee treatment.

Source: [payout-service.ts](../../server/payout-service.ts) and payment service above.

## Apple assessment

Working position: commissioned services genuinely consumed outside Viewrr may fit guideline 3.1.3(e). This is a proposed classification, not Apple approval.

Guideline 3.1.3(d) addresses real-time one-to-one services; it should not be used as a blanket justification for asynchronous editing. Digital in-app content/features require separate consideration under 3.1.1. External purchase-link permissions vary by storefront. Native Stripe checkout and web checkout must both follow the applicable classification.

Reference: [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), checked 23 September 2026.

For Apple discussions, prepare representative project journeys showing the named parties, brief, price, bespoke output, intended external usage, payment and delivery screens. Include remote editing and the current file-access gate. Explain the actual build candidly; wording changes do not change the transaction.

Do not claim all project types are exempt. Pro benefits, boosts, stock assets, templates, paid media libraries, courses or other purchases must be assessed separately if offered.

## Outstanding work before submission

- [ ] Review representative projects, including Other/Custom, and record actual intended usage without exposing customer data.
- [ ] Specify how scope, agreed price, VAT and approved price changes are recorded; enforce invoice consistency.
- [ ] Remove or secure `POST /api/projects/:id/confirm-payment` and `PATCH /api/invoices/:id/paid`, which currently allow client-driven paid status without Stripe verification.
- [ ] Verify duplicate-payment handling and recovery after interrupted webhook fulfilment.
- [ ] Define refund allocation and align customer disclosures with actual Stripe behaviour.
- [ ] Resolve Apple's service classification for intended launch storefronts; retain any guidance and review outcome.
- [ ] Repair mobile web handoffs or implement eligible native checkout using the shared backend.
- [ ] Test the selected release build and reconcile review notes with its actual behaviour.

This document is the starting product specification. It is not customer-facing terms, a completed compliance certification or evidence of App Store approval.
