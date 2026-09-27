# Viewrr App Store release gate

This is a local configuration gate, not certification or permission to submit. The September 2026 audit found unresolved payment, privacy, deletion and block-enforcement issues.

## Local verification

Run from `mobile/` after `npm ci`:

```bash
npm run release:preflight
APP_ENV=production npx expo-doctor
APP_ENV=production npx expo export --platform ios --output-dir /tmp/viewrr-ios-release-check
```

These commands do not sign an iOS archive, contact Apple, prove the backend is safe or exercise an iPhone. Do not run database integration tests against production.

## Required before a release candidate

- Confirm the intended GitHub commit includes all Mac changes.
- Repair project-specific checkout handoffs, including web login and return-to-project routing. The general workspace link is corrected; `webProjectUrl` remains a known blocker.
- Resolve Apple payment classification for every purchase type. Do not treat external checkout as a universal substitute for In-App Purchase.
- Remove client-authoritative paid-state changes. Reconcile signed Stripe events against the correct project, amount, currency and payment state.
- Enforce block rules on discovery/profile reads and fail safely when block lookup fails.
- Protect saved-list reads with caller authentication and ownership.
- Make deletion scheduling durable and prove deferred deletion completes, with actionable escalation for overdue requests.
- Update the published privacy policy for native data collection and reconcile App Privacy answers with the actual build and processors.
- Prove moderation operations, not only report/block buttons.
- Confirm commercial font embedding rights.
- Test both roles on a physical iPhone, including notifications, accessibility, backgrounding, network failures, checkout and deletion.
- Prepare review accounts and seeded fictional projects, accurate screenshots, support URL, age rating and reviewer notes.

## Build and account setup

Keep the existing Expo project and `uk.co.viewrr.app` identity. Never run bare `eas init` or create a replacement project to work around configuration prompts.

Before a build, confirm Developer Program membership, agreements, team, bundle registration, distribution credentials and APNs credentials in the owner's accounts. Confirm an App Store Connect app exists for the same bundle ID and obtain its numeric App Store app ID; this is not the EAS project UUID.

After engineering and device gates pass and the owner approves a build:

```bash
cd mobile
APP_ENV=production npx eas-cli@latest build --platform ios --profile production
```

Review the resolved native build image and logs, archive privacy report, export compliance and entitlements. As of the audit date, Apple requires Xcode 26 or later with the iOS 26 SDK or later; this is a build-SDK requirement, not a requirement to drop older supported iPhones ([Apple requirement](https://developer.apple.com/news/upcoming-requirements/?id=02032026a)).

There is deliberately no invented `ascAppId`, Apple team ID or automatic submit hook here. After those identities are confirmed, add an EAS Submit production profile with the verified numeric App Store app ID and approve the specific upload separately.

Patch upgrades to native Expo modules require a new native build. With `runtimeVersion.policy=appVersion`, never distribute a native-incompatible OTA update to existing binaries sharing the same app version; assign a new runtime/app version before doing so.

## Policy references

Apple requires functional review access, UGC safeguards, accessible privacy information and in-app account deletion where accounts are created. Payment rules vary by the nature of the goods/services and storefront, so review the actual shipping flow against [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

Complete App Privacy from actual collection and sharing, including third parties. A privacy manifest is not a substitute for the [App Privacy questionnaire](https://developer.apple.com/app-store/app-privacy-details/).
