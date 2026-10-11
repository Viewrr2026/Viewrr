# Mobile dependency review — 11 October 2026

Scope: mobile/package-lock.json (Expo SDK 57), not a full backend or native SDK security audit.

## Changes

- Pin shell-quote 1.11.0 and brace-expansion 5.0.12 through npm overrides.
- Pin decode-uri-component 0.5.0 (upstream security fix).
- Keep Expo Router 57 and query-string 7.1.3. A version-checked, idempotent postinstall patch lets the CommonJS caller consume the fixed decoder's ESM default export. Unexpected source/version drift fails installation. No new patching dependency is added.
- Dependency regression tests are included in release:preflight. Do not skip install scripts. Use a supported modern Node version with synchronous ESM require support (Node 22.13+ or 24; validation used 24.19.0).

## Audit outcome

Before: 32 affected packages (1 critical, 20 high, 11 moderate), from 8 advisories across 6 underlying packages.
After: 27 affected packages (0 critical, 19 high, 8 moderate), from 3 underlying advisories. Parent-package findings are not independent vulnerabilities.

Remaining tooling risks require a tracked decision before release; this is not a clean security bill:

| Root dependency | Context and follow-up |
| --- | --- |
| braces 3.0.3 | Metro/micromatch build and file-watching tooling. No patched release listed at review. Keep development servers private and only build trusted source/configuration; reassess upstream before release. |
| node-forge 1.4.0 | Expo certificate/signing tooling. No patched release listed at review. Only use trusted signing material; reassess upstream before release. This review does not establish a defect in native iOS signature verification. |
| uuid 7.0.3 | Xcode project-generation tooling calls v4; the advisory concerns v3/v5/v6 buffer handling. The affected API was not found in this consumer. Prefer an upstream xcode update rather than a blind major override. |

Advisories: GHSA-vfj7-8cjw-p6xm, GHSA-86w9-cpqp-85rv, GHSA-w5hq-g745-h8pq. Fixed advisories include GHSA-pqg4-j6r4-53mv, GHSA-vcc3-ghjq-m6fr and the brace-expansion advisories in the npm audit report.

## Validation

Clean npm ci applied the patch automatically. Production release:preflight passed (configuration, dependency regression checks, mobile TypeScript, Expo package compatibility). Regression checks cover normal URL/query semantics, malformed input with a subprocess timeout, shell quoting, build globs and Babel-transformed ESM interop. No native build, Metro release export, EAS build or submission was started.

## Required before App Store submission

- [ ] Merge the dependency fixes after review.
- [ ] Recheck the remaining advisories and record the release decision.
- [ ] Create a NEW production TestFlight build from the final main commit. Build 4 does not contain the video-dismissal fix or these dependency updates.
- [ ] Install that build on a physical iPhone. Check profile video playback and Back to profile; project links before/after login; messages and stage controls; payment handoff.
- [ ] Verify the selected App Store Connect build is the newly tested build, not build 4.

Keep these gates open until verified. A passing preflight does not authorize App Store submission.
