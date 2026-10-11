# Project workflow and mobile UX — 11 October 2026

- One-off freelancer stage confirmation immediately confirms the timeline, activates the project and starts its first stage. No separate client plan-approval prompt. Existing estimate acceptance remains required before work progresses.
- Project budget and estimate unit-price inputs show a pound prefix and two decimal places after editing; values remain numeric for calculation.
- Direct /help and /help/category links initialize the Help route.
- Mobile portfolio media opens in a dismissible in-app WebView, with embedded YouTube/Vimeo players and fullscreen controls. No Viewrr authentication is forwarded. Host privacy/embed restrictions still apply.
- Mobile one-off work supports messaging the counterparty, sharing delivery links, starting stages, submitting for review, requesting changes and approving/completing eligible stages. Original six-stage projects can also advance.
- Stage transitions are checked on the server and serialized per project. Client-required approval cannot be replaced with freelancer completion; earlier stages must finish first. Closed/paused projects cannot progress.
- Retainer cycle management and payment checkout remain on the web. This is not full native parity with every builder, invoice and retainer screen.

## Validation

14 focused stage/payment tests passed. Web/server build passed. Mobile TypeScript check passed. Root TypeScript still reports existing errors elsewhere in the application; no claim of a clean repository-wide typecheck.

## Release checks

Use a new iOS/TestFlight binary: react-native-webview adds native code. Validate YouTube/Vimeo playback and fullscreen/Done on a device, then stage review, messaging and delivery sharing as both roles. Verify direct Help URL on staging, then production after release approval. Publishing the branch or deploying Render does not update an installed mobile binary.

Staging branch only; production/main not released as part of this change. No migration needed. Previously paused privacy/release review and grace-period retainer test remain outstanding.
