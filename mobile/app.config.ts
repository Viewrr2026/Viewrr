import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * Viewrr Mobile — dynamic Expo config.
 *
 * Isolated from the root web/server package on purpose:
 *   • nothing here reads root package.json, vite.config.ts or render.yaml
 *   • no browser-relative URLs — every environment declares an absolute API base
 *
 * Environment is selected with APP_ENV at config-evaluation time:
 *   APP_ENV=development  (default)  → local Express backend
 *   APP_ENV=staging                 → preview builds; see CLOSED ALPHA below
 *   APP_ENV=production              → live Viewrr backend
 *
 * EAS LINKAGE — fixed project identity, intentionally hardcoded.
 * The Expo dashboard project already exists and its identity never varies by
 * environment, so `owner`, `slug` and `extra.eas.projectId` are literals here
 * rather than env-driven. This is what lets EAS commands resolve the project
 * from a dynamic config: EAS can READ these values but cannot write them, which
 * is why `eas init` fails against an app.config.ts.
 *
 * They are public identifiers, not secrets — they ship inside every bundle.
 * Do NOT change them, and do NOT run bare `eas init`: a second Expo project
 * must never be created for Viewrr.
 *
 * Only environment-varying configuration stays dynamic (APP_ENV, API base URL,
 * app name, bundle identifier, scheme).
 */

type AppEnv = "development" | "staging" | "production";

const requestedEnv = process.env.APP_ENV ?? "development";
if (!["development", "staging", "production"].includes(requestedEnv)) {
  throw new Error(
    `[viewrr/config] Invalid APP_ENV "${requestedEnv}". Use development, staging or production.`,
  );
}
const APP_ENV = requestedEnv as AppEnv;

const IS_DEV = APP_ENV === "development";
const IS_STAGING = APP_ENV === "staging";

/** The live Viewrr API origin. Declared once so no environment restates it. */
const PRODUCTION_API_BASE_URL = "https://www.viewrr.co.uk";

/** Dedicated staging backend; production remains unchanged. */
const STAGING_API_BASE_URL = "https://viewrr-staging.onrender.com";

/** Absolute API base URL per environment. Never relative. */
const API_BASE_URL: Record<AppEnv, string> = {
  // Override per-machine with EXPO_PUBLIC_API_BASE_URL (e.g. a LAN IP for device testing).
  development: process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:5000",
  staging: process.env.EXPO_PUBLIC_API_BASE_URL ?? STAGING_API_BASE_URL,
  production: PRODUCTION_API_BASE_URL,
};

const NAME: Record<AppEnv, string> = {
  development: "Viewrr Dev",
  staging: "Viewrr Staging",
  production: "Viewrr",
};

/**
 * Reverse-DNS identifiers for viewrr.co.uk. Permanent once a build is submitted:
 * a bundle identifier cannot be renamed on the App Store or Play, so do not
 * change these after the first store release.
 */
const BUNDLE_ID: Record<AppEnv, string> = {
  development: "uk.co.viewrr.app.dev",
  staging: "uk.co.viewrr.app.staging",
  production: "uk.co.viewrr.app",
};

/**
 * Existing Expo project identity — confirmed against the Expo dashboard.
 * Shared by every APP_ENV: one Expo project serves development, staging and
 * production, which differ only by name, bundle identifier and scheme.
 */
const EXPO_OWNER = "viewrr-limited";
const EXPO_SLUG = "viewrr-app";
const EAS_PROJECT_ID = "1d650340-9486-46f3-894f-86b4f4d9eb5e";
const CAMERA_USAGE_DESCRIPTION =
  "Viewrr uses your camera to scan a payment card when you choose Scan Card at checkout.";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAME[APP_ENV],
  slug: EXPO_SLUG,
  version: "0.1.1",
  orientation: "portrait",
  scheme: IS_DEV ? "viewrr-dev" : IS_STAGING ? "viewrr-staging" : "viewrr",
  updates: {
    url: "https://u.expo.dev/1d650340-9486-46f3-894f-86b4f4d9eb5e",
  },
  runtimeVersion: {
    policy: "appVersion",
  },
  userInterfaceStyle: "automatic",
  icon: "./assets/images/icon.png",
  owner: EXPO_OWNER,
  ios: {
    bundleIdentifier: BUNDLE_ID[APP_ENV],
    supportsTablet: false,
    infoPlist: {
      // Stripe PaymentSheet includes optional card scanning on iOS.
      NSCameraUsageDescription: CAMERA_USAGE_DESCRIPTION,
      // App Store export-compliance declaration.
      //
      // Viewrr Mobile uses only encryption that Apple treats as exempt: HTTPS/TLS
      // provided by iOS for API calls, and the iOS Keychain (via
      // expo-secure-store) for the PRD-019 Bearer token. There is no proprietary
      // or non-standard cryptography in the app.
      //
      // Declaring this here means EAS and App Store Connect stop asking
      // "iOS app only uses standard/exempt encryption?" on every build — EAS can
      // read a dynamic config but cannot write to it, which is why the prompt
      // recurred. If the app ever adds its own cryptography, this must be
      // revisited before submission.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: BUNDLE_ID[APP_ENV],
    // Preserve the existing Android camera restriction; card scanning is iOS-only.
    blockedPermissions: ["android.permission.CAMERA"],
    adaptiveIcon: {
      backgroundColor: "#FF5A1F",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    ["@stripe/stripe-react-native", { merchantIdentifier: "merchant.uk.co.viewrr.app", enableGooglePay: false }],
    [
      "expo-image-picker",
      {
        photosPermission: "Choose photos and videos to share on Viewrr.",
        // false would remove the iOS purpose string above, including for Stripe.
        cameraPermission: CAMERA_USAGE_DESCRIPTION,
        microphonePermission: false,
      },
    ],
    [
      "expo-font",
      {
        // Satoshi + Clash Display — the same Fontshare families the website
        // loads in client/index.html.
        fonts: [
          "./assets/fonts/Satoshi-Regular.ttf",
          "./assets/fonts/Satoshi-Medium.ttf",
          "./assets/fonts/Satoshi-Bold.ttf",
          "./assets/fonts/Satoshi-Black.ttf",
          "./assets/fonts/ClashDisplay-Medium.ttf",
          "./assets/fonts/ClashDisplay-Semibold.ttf",
          "./assets/fonts/ClashDisplay-Bold.ttf",
        ],
      },
    ],
    [
      "expo-splash-screen",
      {
        // Brand surfaces from client/src/index.css: --background light / dark.
        backgroundColor: "#F8F7F6",
        image: "./assets/images/splash-icon.png",
        imageWidth: 132,
        resizeMode: "contain",
        dark: {
          backgroundColor: "#171412",
          image: "./assets/images/splash-icon-dark.png",
        },
      },
    ],
    // PRD-019 native auth: the Bearer token is held in the iOS Keychain /
    // Android Keystore via expo-secure-store. Never AsyncStorage.
    "expo-secure-store",
    "expo-image",
    [
      // Native push (Decision 15). The plugin only configures the native
      // notification presentation; permission is requested at runtime, from a
      // deliberate user action, in src/push/PushProvider.
      //
      // `icon` and `color` drive the Android status-bar/small icon. The colour
      // is the same brand orange as theme tokens `brand.orange` and the
      // adaptive icon background. iOS uses the app icon and needs no asset
      // here.
      //
      // Delivery on iOS additionally requires an APNs key on the Expo project
      // (Apple Developer credentials) — nothing in this file can substitute for
      // it, and it is not created by any build run here.
      "expo-notifications",
      {
        icon: "./assets/images/android-icon-monochrome.png",
        color: "#FF5A1F",
        // iOS APNs environment written into the entitlements. A store or
        // TestFlight build must not ship the development environment, and a
        // local dev-client build must not ship the production one.
        mode: IS_DEV ? "development" : "production",
        // Viewrr sends alert notifications only. No silent/content-available
        // wake-ups, so the `remote-notification` background mode stays off —
        // claiming a background mode the app does not use is an App Review
        // rejection risk.
        enableBackgroundRemoteNotifications: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    // Preserve anything Expo already put on `extra` (e.g. the router plugin's
    // own keys) instead of replacing the object outright.
    ...config.extra,
    appEnv: APP_ENV,
    appleMerchantId: "merchant.uk.co.viewrr.app",
    paymentUrlScheme: IS_DEV ? "viewrr-dev" : IS_STAGING ? "viewrr-staging" : "viewrr",
    apiBaseUrl: API_BASE_URL[APP_ENV],
    eas: {
      ...config.extra?.eas,
      projectId: EAS_PROJECT_ID,
    },
  },
});
