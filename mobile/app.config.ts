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
 * EAS LINKAGE — deliberately NOT hardcoded.
 * The Expo dashboard project already exists. `owner` and `extra.eas.projectId`
 * are only emitted when supplied via env, so an incorrect or invented project id
 * can never be baked in, and `eas init` can never silently create a second
 * project. See mobile/README.md for the linking procedure.
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

/** Existing Expo dashboard identifiers — supplied by env until confirmed. */
const EXPO_SLUG = process.env.EXPO_SLUG ?? "viewrr";
const EXPO_OWNER = process.env.EXPO_OWNER;
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAME[APP_ENV],
  slug: EXPO_SLUG,
  version: "0.1.0",
  orientation: "portrait",
  scheme: IS_DEV ? "viewrr-dev" : IS_STAGING ? "viewrr-staging" : "viewrr",
  userInterfaceStyle: "automatic",
  icon: "./assets/images/icon.png",
  ...(EXPO_OWNER ? { owner: EXPO_OWNER } : {}),
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
    appEnv: APP_ENV,
    apiBaseUrl: API_BASE_URL[APP_ENV],
    ...(EAS_PROJECT_ID ? { eas: { projectId: EAS_PROJECT_ID } } : {}),
  },
});
