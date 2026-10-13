# Mobile dependency review — 11 October 2026

Scope: mobile/package-lock.json (Expo SDK 57), not a full backend or native SDK security audit.

## Changes

- Pin shell-quote 1.11.0 and brace-expansion 5.0.12 through npm overrides.
- Scope uuid 11.1.1 to xcode; verify its v4 project-ID format, uniqueness and fixed buffer checks.
- Pin decode-uri-component 0.5.0 (upstream security fix).
- Keep Expo Router 57 and query-string 7.1.3. A version-checked, idempotent postinstall patch lets the CommonJS caller consume the fixed decoder's ESM default export. Unexpected source/version drift fails installation. No new patching dependency is added.
- Dependency regression tests are included in release:preflight. Do not skip install scripts. Use a supported modern Node version with synchronous ESM require support (Node 22.13+ or 24; validation used 24.19.0).

## Audit outcome

Before: 32 affected packages (1 critical, 20 high, 11 moderate), from 8 advisories across 6 underlying packages.
After initial fixes: 27 affected packages. After the scoped xcode/uuid update: 19 affected packages (0 critical, 19 high, 0 moderate), from 2 underlying advisories. Parent-package findings are not independent vulnerabilities.

Remaining tooling risks require a tracked decision before release; this is not a clean security bill:

| Root dependency | Context and follow-up |
| --- | --- |
| braces 3.0.3 | Metro/micromatch build and file-watching tooling. No patched release listed at review. Keep development servers private and only build trusted source/configuration; reassess upstream before release. |
| node-forge 1.4.0 | Expo certificate/signing tooling. No patched release listed at review. Only use trusted signing material; reassess upstream before release. This review does not establish a defect in native iOS signature verification. |


Remaining advisories: GHSA-vfj7-8cjw-p6xm and GHSA-86w9-cpqp-85rv. GHSA-w5hq-g745-h8pq is fixed by the scoped uuid update. Fixed advisories include GHSA-pqg4-j6r4-53mv, GHSA-vcc3-ghjq-m6fr and the brace-expansion advisories in the npm audit report.

## Validation

Clean npm ci applied the patch automatically. Production release:preflight passed (configuration, dependency regression checks, mobile TypeScript, Expo package compatibility). Regression checks cover normal URL/query semantics, malformed input with a subprocess timeout, shell quoting, build globs and Babel-transformed ESM interop. No native build, Metro release export, EAS build or submission was started.

## Required before App Store submission

- [ ] Merge the dependency fixes after review.
- [ ] Recheck the remaining advisories and record the release decision.
- [ ] Create a NEW production TestFlight build from the final main commit. Build 4 does not contain the video-dismissal fix or these dependency updates.
- [ ] Install that build on a physical iPhone. Check profile video playback and Back to profile; project links before/after login; messages and stage controls; payment handoff.
- [ ] Verify the selected App Store Connect build is the newly tested build, not build 4.

Keep these gates open until verified. A passing preflight does not authorize App Store submission.

## Retainer grace-period test — 12 October follow-up (superseded below)

Read-only staging inspection confirmed the first cycle remains unpaid after the due time and has an overdue marker. The subsequent cycle is unstarted and its planned end date has elapsed. The previous inspection found reminder/overdue delivery jobs for both participants completed without errors; this is not proof of device receipt.

Remaining manual checks:
- [ ] Observe overdue blocking in the freelancer view.
- [ ] Pay the overdue sandbox invoice using the client test account.
- [ ] Confirm the financial freeze lifts but the elapsed-date gate remains.
- [ ] Mutually agree revised future-cycle dates.
- [ ] Submit and approve the final-cycle deliverable, then pay its invoice.
- [ ] Confirm overall completion and history on both accounts, including notifications.

Do not edit payment status in SQL or silently extend the agreed schedule. A new production TestFlight build and phone smoke test remain required before App Store submission; build 4 lacks the recent fixes.

Dependency follow-up validation (12 October): installation applied the compatibility patch; six regression tests and mobile TypeScript passed. The online Expo compatibility check timed out at the proxy; the offline check is informational only. The prior online preflight passed before this scoped transitive UUID change. No iOS build was started.


## Completed dependency review — 13 October 2026

Reviewed branch head 88bfb133fa1bb25fa3082aeca9f307dfb4020701.

Fresh clean installation applied the decoder compatibility patch. All six dependency regression tests, mobile TypeScript and production release configuration passed. A production iOS Metro JavaScript export (no native archive, no Hermes bytecode) also passed: 3,676 modules. Its source map contains the patched query-string/decode-uri-component modules and contains no braces, node-forge or @expo/code-signing-certificates sources. This establishes the observed JavaScript bundle boundary, not a full native security audit.

Fresh npm audit remains 19 high, zero critical/moderate/low findings. These are propagated package findings from two root advisories:

- braces 3.0.3, GHSA-vfj7-8cjw-p6xm: introduced through micromatch -> metro-file-map (Metro build/file-watching). Registry latest remains 3.0.3; advisory lists no patched version.
- node-forge 1.4.0, GHSA-86w9-cpqp-85rv: direct parents @expo/code-signing-certificates and @expo/cli. Registry latest remains 1.4.0; advisory lists no patched version.

Engineering recommendation: merge the tested dependency updates with the final release changes, then proceed to a fresh TestFlight candidate under controlled build/signing conditions. Keep Metro private, build reviewed source/configuration and only use trusted signing material. Do not downgrade Expo to the incompatible versions suggested by audit --force, suppress the findings, or introduce an unreviewed cryptography fork. Keep both advisories open and recheck before public submission; they are not remediated by this review. Final native build and device validation remain mandatory.

Sources rechecked 13 October:
- https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- https://github.com/advisories/GHSA-86w9-cpqp-85rv

## Updated readiness and tonight's sequence

User confirmed the overdue freeze, verified Cycle 1 payment, remaining schedule gate, mutually accepted Cycle 2 dates, final-cycle payment and overall completion/paid on both client and freelancer accounts. Client screenshots show 2/2 cycles and GBP 2.00 received. Actual receipt of completion notifications is still unconfirmed; job processing is not proof of delivery to a device/inbox.

- [x] Dependency review and available compatible fixes prepared in PR #10.
- [x] Portfolio dismissal fix PR #9 already merged into main; absent from installed build 4.
- [x] Retainer paid/completed on both accounts.
- [ ] Connect private R2 and FFmpeg on staging; activate/test PR #11 (includes payment confirmation UI).
- [ ] Audit staging UI and protected uploads/previews/downloads, including slow payment confirmation and notification receipt.
- [ ] Recheck privacy disclosures and privacy policy against the final storage/SDK behaviour.
- [ ] Merge the final reviewed changes, including PR #10 and PR #11, and verify production deployment.
- [ ] Create a NEW production TestFlight build from that final main commit. Do not reuse build 4. PR #8 is already in build 4; PR #9 and PR #10 are not.
- [ ] Smoke-test that build: portfolio playback/closing, project management, messages/notifications, payment links, login/logout, account deletion and Help.
- [ ] Select the newly tested build in App Store Connect and complete reviewer access/metadata.

No TestFlight build, App Store submission, merge or production deployment was performed during this review. Payment UI/R2 work is held for tonight per the user's instruction.

