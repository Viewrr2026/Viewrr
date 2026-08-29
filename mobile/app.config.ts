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
 *   APP_ENV=staging                 → staging Render service
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

const APP_ENV = (process.env.APP_ENV ?? "development") as AppEnv;

const IS_DEV = APP_ENV === "development";
const IS_STAGING = APP_ENV === "staging";

/** Absolute API base URL per environment. Never relative. */
const API_BASE_URL: Record<AppEnv, string> = {
  // Override per-machine with EXPO_PUBLIC_API_BASE_URL (e.g. a LAN IP for device testing).
  development: process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:5000",
  staging: process.env.EXPO_PUBLIC_API_BASE_URL ?? "https://staging.viewrr.co.uk",
  production: "https://www.viewrr.co.uk",
};

const NAME: Record<AppEnv, string> = {
  development: "Viewrr Dev",
  staging: "Viewrr Staging",
  production: "Viewrr",
};

const BUNDLE_ID: Record<AppEnv, string> = {
  development: "co.uk.viewrr.app.dev",
  staging: "co.uk.viewrr.app.staging",
  production: "co.uk.viewrr.app",
};

/**
 * Existing Expo project identity — confirmed against the Expo dashboard.
 * Shared by every APP_ENV: one Expo project serves development, staging and
 * production, which differ only by name, bundle identifier and scheme.
 */
const EXPO_OWNER = "viewrr-limited";
const EXPO_SLUG = "viewrr-app";
const EAS_PROJECT_ID = "1d650340-9486-46f3-894f-86b4f4d9eb5e";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAME[APP_ENV],
  slug: EXPO_SLUG,
  version: "0.1.0",
  orientation: "portrait",
  scheme: IS_DEV ? "viewrr-dev" : IS_STAGING ? "viewrr-staging" : "viewrr",
  userInterfaceStyle: "automatic",
  icon: "./assets/images/icon.png",
  owner: EXPO_OWNER,
  ios: {
    bundleIdentifier: BUNDLE_ID[APP_ENV],
    supportsTablet: false,
  },
  android: {
    package: BUNDLE_ID[APP_ENV],
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
    [
      "expo-font",
      {
        // Satoshi + Clash Display — the same Fontshare families the website
        // loads in client/index.html.
        fonts: [
          "./assets/fonts/Satoshi-400.ttf",
          "./assets/fonts/Satoshi-500.ttf",
          "./assets/fonts/Satoshi-700.ttf",
          "./assets/fonts/Satoshi-900.ttf",
          "./assets/fonts/ClashDisplay-500.ttf",
          "./assets/fonts/ClashDisplay-600.ttf",
          "./assets/fonts/ClashDisplay-700.ttf",
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
    apiBaseUrl: API_BASE_URL[APP_ENV],
    eas: {
      ...config.extra?.eas,
      projectId: EAS_PROJECT_ID,
    },
  },
});
