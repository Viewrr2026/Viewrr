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

## Retainer grace-period test — 12 October follow-up

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
