# LEGAL_REVIEW_REQUIRED.md
# Viewrr — Issues Requiring UK Solicitor / Privacy Professional Review
*PRD-021 WS-A — Produced: 2026-08-31*
*This document identifies legal/compliance gaps found during a technical code review.*
*It is NOT legal advice and does not constitute solicitor approval.*

---

## 1. Legal Document Consistency

### 1.1 Platform Terms & Conditions
**Found in:** `/client/src/pages/Terms.tsx` (if exists), linked from Landing.tsx and PostBrief.tsx
- [ ] Terms must accurately describe Viewrr's 11% platform fee (`VIEWRR_FEE_PERCENT = 11` in payment-service.ts)
- [ ] Terms must describe the Stripe Connect payment model (escrow-then-transfer architecture)
- [ ] Terms must describe refund policy (refund window and approval flow exist in code: `REFUND_THRESHOLD_HIGH_VALUE`)
- [ ] Terms must accurately reflect project completion workflow (stage-by-stage approval via project_stages)
- [ ] Terms must describe retainer billing (multi-cycle retainer contracts exist)
- [ ] Terms must address account suspension/termination (now implemented in PRD-021)
- [ ] Terms must describe Pro Viewrr subscription (£49.99/mo; founding pro at fixed rate)

### 1.2 Privacy Policy
**Found in:** `/client/src/pages/Privacy.tsx`
- [ ] Privacy Policy must name all data categories actually collected (see COOKIE_PRIVACY_INVENTORY.md)
- [ ] Privacy Policy states "analytics and usage data" but NO analytics is currently active — either remove or qualify
- [ ] Privacy Policy must describe IP address collection (collected for legal acceptance records: terms_acceptances.ip_address)
- [ ] Privacy Policy must describe data retention periods for: messages, financial records, auth sessions, deleted accounts
- [ ] Privacy Policy must describe right to erasure and the anonymisation approach (now implemented)
- [ ] Privacy Policy must describe right to data portability and the export mechanism (now implemented at /api/me/export)
- [ ] Privacy Policy must name the data controller (Viewrr entity name, registered address, contact)
- [ ] Privacy Policy must describe lawful basis for each processing activity under UK GDPR
- [ ] Privacy Policy must describe transfers outside the UK (Neon database region: eu-west-2; Stripe US-hosted; Render infrastructure)
- [ ] Privacy Policy must describe third-party sub-processors: Neon, Stripe, Render, Cloudflare

### 1.3 Cookie Policy
- [ ] Cookie Policy must accurately match COOKIE_PRIVACY_INVENTORY.md
- [ ] Cookie Policy must clarify that analytics is not currently active
- [ ] Cookie Policy must describe localStorage usage (not technically "cookies" but equivalent under ePrivacy)

---

## 2. Marketplace Role Clarity

- [ ] Confirm whether Viewrr operates as: (a) agent of the freelancer, (b) agent of the client, or (c) neutral marketplace. The fee structure and payment flow suggest Viewrr acts as a payment intermediary.
- [ ] Stripe Connect custom account model means Viewrr is the "merchant of record" for payment processing — confirm this is correctly described in terms.
- [ ] Freelancer/client relationship: Terms must clearly state this is NOT an employment relationship.
- [ ] Agency accounts (multi-member agencies billing through Viewrr) may require separate commercial terms.

---

## 3. Intellectual Property

- [ ] Intellectual property ownership of creative deliverables is not currently defined in platform terms. Who owns work-in-progress before final payment?
- [ ] Portfolio content (Vimeo/YouTube URLs, uploaded media) — does Viewrr claim any licence over content posted to the platform?
- [ ] User-generated content (feed posts, reviews, messages) — licence grant to Viewrr for display/moderation purposes needs to be stated.

---

## 4. Financial / Payment

- [ ] Refund policy: current implementation has a "high value" approval threshold (`REFUND_THRESHOLD_HIGH_VALUE`). The exact threshold and process must be disclosed to users.
- [ ] Payout timing: Stripe Connect payout schedule (auto daily payout implemented) must be disclosed.
- [ ] Stripe fee pass-through: `stripeFeePence` is tracked in payments table — clarify whether Stripe fees are included in the platform fee or charged separately.
- [ ] Financial record retention: confirm retention period meets HMRC requirements (typically 6 years).

---

## 5. Account Deletion & Data Retention

- [ ] The anonymisation approach (PII cleared, financial records retained) is now implemented. This must be documented in the Privacy Policy.
- [ ] Define and document the exact data retention schedule for each data category.
- [ ] Confirm that auth_sessions and terms_acceptances are retained for security/legal reasons even after deletion — this must be disclosed.
- [ ] Define whether anonymised accounts can be restored (current implementation: no).

---

## 6. Reviews & Reputation

- [ ] Reviews are currently only creatable for completed projects (`verifiedProjectReview`). Confirm this accurately reflects the Terms.
- [ ] Terms must state Viewrr's policy on removal of defamatory/false reviews.
- [ ] Moderation/report resolution must be reflected in terms (now implemented via user_reports).

---

## 7. Mobile Application

- [ ] Mobile app (React Native/Expo) uses Bearer token authentication — confirm Terms/Privacy cover mobile-specific data handling.
- [ ] Push notifications (if implemented) require a separate consent flow under PECR.
- [ ] App Store / Play Store privacy declarations must match actual data collection.

---

## 8. Moderation & Suspension

- [ ] Terms must describe grounds for account suspension/termination (now technically implemented).
- [ ] Terms must describe appeal process for suspended accounts.
- [ ] Moderation report categories (spam, harassment, fake, inappropriate) must match disclosed community standards.

---

## 9. Complaints

- [ ] Viewrr must have a documented complaints process (a `complaints` document type exists in terms_versions schema — content not yet created).
- [ ] Under Consumer Rights Act 2015 and DSA obligations: consider whether Viewrr requires a formal disputes process.

---

*End of legal review document.*
*This document should be reviewed with a UK-qualified solicitor experienced in marketplace/platform law and UK GDPR compliance before Viewrr scales beyond early-stage usage.*
