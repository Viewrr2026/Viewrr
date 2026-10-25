# Apple Pay release

This release adds Stripe Apple Pay and card checkout to one-off project invoices and retainer cycle invoices on the website and in the native app. Retainer cycle payments remain individual invoice payments, not automatic subscription charges. Pro purchases retain their existing website checkout.

The server supplies prices and payment references. The checkout UI waits for server verification before showing a paid receipt; protected originals continue to use the existing server access checks. Pending native payments can be checked after returning to the app or restarting it. The native build is version 0.1.1, giving the new Stripe module a separate OTA runtime from 0.1.0.

## Account activation

These settings require the Viewrr Stripe and Apple Developer accounts. Code/config checks do not establish that registration or signing is complete.

1. In the Viewrr platform Stripe account, enable Apple Pay and register `www.viewrr.co.uk` in [Payment method domains](https://dashboard.stripe.com/settings/payment_method_domains). Also register `viewrr.co.uk` if it serves checkout without redirecting to `www`. Register `viewrr-staging.onrender.com` in the Stripe test environment used by staging. Confirm the domains are enabled and Apple Pay is active. The current integration uses destination charges, so domain registration belongs to the platform account.
2. In [Apple Developer identifiers](https://developer.apple.com/account/resources/identifiers/add/merchant), register the merchant identifier `merchant.uk.co.viewrr.app` for Viewrr. If an existing merchant ID must be used, change both the Expo plugin and runtime value together before building.
3. In [Stripe iOS certificate settings](https://dashboard.stripe.com/settings/ios_certificates), add the application and obtain Stripe's certificate signing request. Use that CSR to create the Apple Pay payment processing certificate for the same merchant ID, then complete Stripe's certificate setup. Use Stripe's CSR; do not generate an unrelated one.
4. Associate that merchant ID with Apple Pay on the production App ID `uk.co.viewrr.app`. The Expo config plugin supplies the app entitlement. EAS must use a provisioning profile containing it. Also configure the staging App ID when testing a staging build on a device.

Existing Stripe secret/publishable keys remain server configuration. The mobile client receives only the publishable key and its authenticated invoice's client secret. No secret key is added to Expo settings or the app bundle.

Official setup references: [Stripe web domains](https://docs.stripe.com/payments/payment-methods/pmd-registration), [Stripe React Native Apple Pay](https://docs.stripe.com/apple-pay?platform=react-native), [Expo Stripe plugin](https://docs.expo.dev/versions/latest/sdk/stripe/).

## Release order

1. Merge this change after review. PR16 supplies the separate immediate/end-of-Pro deletion choice; include it in the submission release and apply `migrations/0017_pro_account_deletion.sql` before deploying that server change.
2. Deploy the server and website on Render, including the updated cycle payment-status response and privacy wording. The server must be deployed before the new mobile build is used.
3. Complete account activation above. From `mobile`, run `npm ci` and `npm run release:preflight`.
4. Build with `APP_ENV=production npx eas-cli@latest build --platform ios --profile production --auto-submit`. This uploads to App Store Connect/TestFlight; it does not itself request public App Store review. Use an App Store Connect version matching 0.1.1.
5. Test on a physical iPhone with Apple Pay and in Safari on a registered HTTPS domain. Expo Go and a JavaScript export cannot test Apple Pay or Apple signing.

The iOS build includes a camera purpose string for Stripe's optional Scan Card action. `release:config` checks the generated Info.plist after Expo plugins run, as well as the Apple Pay and production push entitlements. Changes to this purpose string require a new native build; resubmitting an older binary or publishing an OTA update cannot fix a missing Info.plist key.

## Payment acceptance checks

Use a staging/test Stripe environment and test counterparties for functional testing. Do not mark invoices paid manually.

- Pay a one-off invoice and an accepted retainer cycle with Apple Pay. Confirm the charged amount, the agreed platform fee and the freelancer destination, then verify originals unlock only after the server confirms payment.
- Repeat with card fallback, including a card requiring bank authentication. Return from authentication, leave/reopen the screen, and restart the app while confirmation is pending.
- On iOS, choose Scan Card and confirm the camera prompt explains payment-card scanning. Deny camera access and confirm manual card entry remains available; also test allowing access. Opening checkout alone should not prompt for camera access.
- Cancel the wallet before authorizing. Check that the invoice remains unpaid and the same payment can be resumed.
- Test a decline and loss of network immediately after authorizing. The UI must show a retryable decline or pending verification as appropriate, without a second charge or premature file access.
- Check a supported device with no configured Apple Pay card and a browser without wallet support: card checkout must remain usable.
- Check delayed webhook delivery and refund/dispute states. Verify the payment history and protected-file behavior.

After merging PR16, verify both deletion choices in the same TestFlight build. The existing font changes should receive their planned visual check in that build too.

## App Review notes

Suggested payment explanation, to accompany working reviewer accounts and a representative invoice:

Viewrr connects clients with named independent freelancers for commissioned photography, videography and editing services. Each project has an agreed brief, price and bespoke output intended for the client's use outside Viewrr. The app supports communication, project management, previews and delivery of the commissioned work. Clients pay project invoices and individually approved retainer cycle invoices through Stripe, using Apple Pay or a card. Payment is verified on our server before original deliverables become available. Pro subscriptions are purchased on the website; the native app displays existing membership status without a Pro purchase or upgrade control.

This explains the actual service model for review under [guideline 3.1.3(e)](https://developer.apple.com/app-store/review/guidelines/). Apple assesses the actual offering; Apple Pay itself does not determine whether a purchase qualifies. The separate real-time person-to-person exception is not the basis for asynchronous editing work.

Before pressing Submit for Review, select the tested build and verify the final App Store Connect listing, screenshots, privacy answers, age rating and reviewer access. Review privacy answers against the released Stripe SDK and the existing payment disclosures. This file does not assert that those account-side fields have already been completed.
