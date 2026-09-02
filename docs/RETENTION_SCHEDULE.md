# Viewrr Data Retention Schedule

**Version 1.0 · Effective 2 September 2026 · Controller: Viewrr Limited (England & Wales)**

This document states, per category of data, exactly what happens when you delete
your Viewrr account: what is **deleted**, what is **anonymised**, and what we are
**required to keep** and for how long.

It is written to be accurate rather than reassuring. Some of your data cannot be
erased on request, because UK tax and company law requires us to keep it. Where
that is the case it says so, with the reason.

**Canonical implementation:** `server/services/privacy-service.ts` —
`RETENTION_SCHEDULE` and `anonymiseUserAccount()`. The table in this document and
that constant are the same schedule and must be changed together.
`GET /api/me/deletion-status` returns it to the app so you never have to take our
word for it.

---

## 1. The three outcomes

| Outcome | What it means |
|---|---|
| **Deleted** | The row is removed from the database. It is gone from backups within 30 days as backups roll over. |
| **Anonymised** | The row survives, but every field that identifies you is overwritten. Your name becomes `[deleted-<id>]` and your email becomes `deleted-<id>@viewrr-deleted.invalid`. Neither is reversible and neither can receive mail. |
| **Retained** | The row and its contents survive for the stated period, keyed to a user id that no longer identifies you. |

"Anonymised" is used, rather than "deleted", wherever a record belongs to
**someone else as well as you** — the other side of a project, an invoice, a
review or a message thread. Deleting those rows outright would destroy another
user's records, and in the case of reviews would silently rewrite a freelancer's
public rating.

---

## 2. The schedule

### 2.1 Deleted immediately

| Category | Tables | Notes |
|---|---|---|
| Password hash | `users.password_hash` | Set to NULL. `password_algo` is set to the sentinel `'deleted'` — it is a `NOT NULL` column, so it cannot be nulled. |
| Password reset tokens | `password_reset_tokens` | Live tokens for an account whose address you no longer control are an account-takeover route. |
| Login sessions | `auth_sessions` | All sessions revoked with reason `user_deleted`, before anything else changes. |
| Push device tokens and push preferences | `push_tokens`, `push_preferences` | Deleted explicitly, not left to a foreign-key cascade — your user row is anonymised, not deleted, so no cascade fires. |
| Outstanding verification codes | `verification_codes` | Invalidated. Only a hash of the address was ever stored. |
| Profile content | `profiles` | Specialisms, skills, rates, reel, portfolio, social links, badges, accreditation cleared; rating and counts zeroed. |
| Likes and saved profiles | `post_likes`, `saved` | |
| Connection requests | `connection_requests` | Both directions. |
| Notifications addressed to you | `notifications` (recipient) | |
| Email notification preferences | `notification_preferences` | |
| Analytics of profiles you viewed | `profile_views` (as viewer) | Views **of** your profile keep their row as an aggregate count, with the viewer IP removed. |
| Personal planning data | `tasks`, `calendar_events` | |
| Pending project invitations | `project_invitations` (status `pending`) | Accepted/declined invitations become part of a work record and are anonymised instead. |
| Your own retainer templates | `retainer_templates` | System templates are unaffected. |
| Data export requests | `data_export_requests` | |
| Blocks | `user_blocks` | Both directions. |
| Legacy web session store | `session` | Rows whose payload references your user id. |
| Uploaded file metadata | `upload_objects` | Marked `deleted` and the original filename cleared (user-supplied filenames very often contain a real name). The stored objects themselves are purged by the storage lifecycle rule **within 30 days**. |

### 2.2 Anonymised immediately (row survives, identity does not)

| Category | Tables / fields | Why the row survives |
|---|---|---|
| Account identifiers | `users`: name, email, phone, avatar, banner, headline, bio, location; `account_status` → `anonymised` | Foreign keys across ~50 tables point at this id. |
| Feed posts | `posts`: caption replaced, media URL and type cleared, tags emptied | Other users' comments on your post would otherwise be orphaned. |
| Comments | `post_comments`: content replaced | Threads stay readable for the people who replied. |
| Removed-post audit log | `deleted_posts`: `owner_name`, `owner_email`, caption, media, tags | This table stored your email in plaintext. |
| Messages you sent | `messages`: content → `[message deleted]` | The recipient's thread would otherwise break. |
| Your name in other people's notifications | `notifications`: `actor_name`, `actor_avatar` | |
| Briefs you posted | `briefs`: `client_name`, `client_avatar` | Freelancers' interest records reference them. |
| Interests you sent or received | `brief_interests`: freelancer and client display names, avatars | |
| Projects | `projects`: `client_name`, `freelancer_name` | The project itself is the counterparty's contractual record. |
| Reviews you wrote | `reviews`: `client_name`, `client_avatar` | The rating and comment are **kept** — see §3.2. |
| Time entries | `time_entries`: description cleared | Minutes and billability are billing evidence. |
| Agency records | `agencies` (branding), `agency_members` (deleted), `agency_activity.actor_name`, `agency_briefs.client_name` | An agency you solely own with other members blocks deletion until ownership moves — see §4. |
| Invoices | `invoices`: `client_name`, `client_email` | The financial content is retained — see §3.1. |
| Invoice template | `invoice_templates`: business name, address, email, phone, VAT number, logo, footer | Sole-trader business details are personal data in practice. |
| Retainer agreements | `retainer_agreements`: free-text description | Two-party contract; retained. |
| Terms acceptance metadata | `terms_acceptances`: `ip_address`, `user_agent` | The acceptance itself is retained — see §3.4. |
| Reports you filed | `user_reports`: description | Free text can name third parties. The report is retained — see §3.5. |
| Content flags against your content | `content_flags`: excerpt | Retained — see §3.5. |
| Scheduled meetings you created | `meetings`: link cleared, status → `cancelled` | |

### 2.3 Retained, and for how long

| Category | Tables | Period | Legal or operational basis |
|---|---|---|---|
| Invoices and invoice records | `invoices`, `invoice_templates` | **6 years** from the end of the financial year they relate to | Company and tax records. See §3.1. |
| Payments, transfers, refunds, payouts | `payments`, `payment_transfers`, `payment_refunds`, `payment_payouts`, `payment_audit_log`, `payment_timeline_events` | **6 years** | Same basis; also fraud prevention and chargeback defence. |
| Stripe records | `stripe_connect_accounts`, `stripe_events` | **6 years** | Payment-service records; Stripe is a separate controller for its own copies. |
| Pro subscription records | `pro_subscriptions`, `pro_subscription_events`, `founding_pro_allocations` | **6 years** | Billing record. |
| Retainer agreements and cycles | `retainer_agreements`, `retainer_agreement_versions`, `retainer_cycles`, `retainer_amendments`, and the rest of the `retainer_*` family | **6 years** | Contractual records between two parties. |
| Terms and policy acceptances | `terms_acceptances`, `terms_versions` | **6 years** | Evidence of what you agreed to and when — the record that protects both of us in a dispute. |
| Project and stage history | `projects`, `project_stages`, `project_stage_events`, `project_updates`, `deliverables`, `agency_proposals` | **6 years** | Record of the work, needed by the counterparty and to defend claims. |
| Messages you received | `messages` | **6 years** | Also the other party's record. Your identity in them is anonymised. |
| Reviews | `reviews` | Indefinitely | Public rating integrity. See §3.2. |
| Moderation reports and content flags | `user_reports`, `content_flags` | **2 years** | Safety and repeat-abuse detection. |
| Admin and moderation audit log | `moderation_audit_log`, `payment_audit_log` | **6 years** | Append-only. Records that an action was taken, by whom, when and why. Never rewritten, including by this process. |
| Accreditation history | `accreditation_history` | **6 years** | Record of badge decisions. |

**Reconciliation note.** `RETENTION_SCHEDULE` in `privacy-service.ts` is the
user-facing summary returned by the API: it groups these tables into 20
categories and reports the *primary* action for each. §2 above is the per-table
detail behind it. Where the two differ in wording — for example the code lists
project and brief history as `anonymised` while §2.3 lists the underlying rows as
retained for 6 years — both are true: your identifiers are anonymised
immediately and the de-identified work record is what is retained. Periods are
expressed in the code as days: `2190` = ~6 years, `730` = 2 years, `0` =
immediate.

---

## 3. Why some things cannot be erased

### 3.1 Invoices and financial records — 6 years

This is the one that surprises people, so it is stated plainly: **we cannot
delete your invoices or payment records when you ask us to.**

- HMRC guidance for limited companies is to keep company records for **6 years
  from the end of the last company financial year they relate to**, and longer if
  a transaction spans accounting periods, a return was filed late, or a
  compliance check is open ([GOV.UK, Company and accounting records](https://www.gov.uk/running-a-limited-company/company-and-accounting-records)).
- VAT records, including invoices, must be kept for **6 years from the date of
  issue** ([HMRC Compliance Handbook CH15200](https://www.gov.uk/hmrc-internal-manuals/compliance-handbook/ch15200)).
- The Companies Act 2006 sets a statutory floor of 3 years for a private
  company's accounting records and 6 years for a public one
  ([Companies Act 2006 s.388](https://www.legislation.gov.uk/ukpga/2006/46/section/388));
  the 6-year HMRC period is the longer of the two obligations and therefore the
  one we apply.
- UK GDPR permits this. The right to erasure does not apply where processing is
  necessary to comply with a legal obligation, or for the establishment,
  exercise or defence of legal claims
  ([ICO, Right to erasure](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/)).

What we do instead is remove your identity from those records: the client name
and client email on an invoice are anonymised, while the invoice number, dates,
line items and amounts are kept intact because those are the parts the law
requires.

### 3.2 Reviews you wrote

Your name and avatar are removed from a review, but the star rating and the text
stay. Deleting the rating would retroactively change another freelancer's public
average — they would be penalised or rewarded for an account closure they had no
part in. If a specific review contains something that should not be public,
report it and it will be reviewed on its own merits.

### 3.3 Messages

We clear the content of messages **you sent**. We do not delete messages you
**received**, because they were written by someone else and form part of their
record of the conversation.

### 3.4 Terms acceptances

We keep the fact that you accepted a specific version of the Terms, and when.
This is the evidence that protects both sides in a dispute. We delete the IP
address and browser user-agent captured at the time, because those identify you
and add nothing evidential once the account is closed.

### 3.5 Moderation records

Reports you filed and flags raised against your content are kept for 2 years.
Erasing them on request would let anyone reset their moderation history by
deleting and re-registering, which would make repeat-abuse detection impossible.

### 3.6 Backups

Deletion and anonymisation apply to the live database immediately. Encrypted
database backups roll over on a **30-day** cycle, so a deleted row can persist in
a backup for up to 30 days. Backups are only ever restored wholesale in a
disaster; they are never queried to look up an individual.

---

## 4. When deletion is scheduled rather than immediate

We will **never refuse a deletion request outright**. If something genuinely
prevents immediate erasure, the request is recorded and **scheduled**, and it
completes automatically once the obstacle clears.

`GET /api/me/deletion-status` returns the live list. The possible reasons:

| Reason | Clears by itself? | Maximum deferral |
|---|---|---|
| An open project with another user | No — complete or cancel it | 90 days |
| An unsettled invoice | No — settle or cancel it | 90 days |
| A payment transfer in progress | Yes, on settlement | 30 days |
| Earnings held on your account and not yet paid out | Yes, on the next payout | 30 days |
| A payout in transit to your bank | Yes, on arrival | 30 days |
| A live Pro subscription | No — cancel it in Pro settings so Stripe stops billing you | 30 days |
| You are the sole owner of an agency with other members | No — transfer ownership or remove the members | 90 days |

Two of these deserve an explanation. We will not anonymise an account that
Viewrr still **owes money to**, because we would be destroying the identity we
need to pay it. And we will not anonymise the sole owner of an agency that other
people belong to, because it would leave those members inside an agency nobody
can administer.

Once nothing is outstanding, you confirm with your password and anonymisation
runs **immediately** — not "within 30 days".

---

## 5. Your rights and how to exercise them

| Right | How |
|---|---|
| Access / portability | Settings → Export my data, or `GET /api/me/export`. Returns JSON immediately. |
| Erasure | Settings → Delete my account. Subject to this schedule. |
| Rectification | Edit your profile, or contact support. |
| Objection / restriction | [support@viewrr.co.uk](mailto:support@viewrr.co.uk) |

We respond to rights requests **without undue delay and within one month**, as
UK GDPR requires ([ICO, Right to erasure](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-erasure/)).

If you are unhappy with how we have handled your data you can complain to the
Information Commissioner's Office: <https://ico.org.uk/make-a-complaint/>.

---

## 6. Known limitations — stated on purpose

1. **Anonymisation is not deletion.** An anonymised row still shows that
   *someone* did something, when. Where a counterparty already knows who they
   worked with, they will still be able to infer it. We cannot honestly claim
   otherwise.
2. **Third-party processors keep their own copies.** Stripe (payments), Resend
   (transactional email) and our hosting and object-storage providers each hold
   data under their own retention policies. We instruct deletion where we can;
   Stripe's financial records are subject to the same statutory periods as ours.
3. **Backups lag by up to 30 days** (§3.6).
4. **The 6-year periods in §2.3 are enforced operationally, not automatically.**
   There is no scheduled job today that purges a record the day its 6 years are
   up; the period is applied as part of periodic review. This is a gap, it is
   known, and it is recorded here rather than hidden.

---

## 7. Changes

Material changes to this schedule will be announced in-app. The implementation
in `server/services/privacy-service.ts` and this document are changed together.

Questions: [support@viewrr.co.uk](mailto:support@viewrr.co.uk)
