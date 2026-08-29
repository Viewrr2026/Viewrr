import Constants from "expo-constants";

/**
 * Runtime environment resolution for Viewrr Mobile.
 *
 * Values originate in app.config.ts (`extra`) so they are baked into the build
 * and identical across JS bundles for a given EAS profile.
 *
 * Hard rule: the API base URL is ALWAYS absolute. The web client resolves API
 * calls relatively (same-origin) — a native app has no origin, so a relative
 * URL is a silent failure. `assertAbsolute` makes that failure loud instead.
 */

export type AppEnv = "development" | "staging" | "production";

type Extra = {
  appEnv?: AppEnv;
  apiBaseUrl?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

function assertAbsolute(url: string | undefined): string {
  if (!url) {
    throw new Error(
      "[viewrr/config] apiBaseUrl is missing. Check app.config.ts `extra.apiBaseUrl`.",
    );
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(
      `[viewrr/config] apiBaseUrl must be absolute (http/https). Received: "${url}"`,
    );
  }
  // Normalise: no trailing slash, so joining paths never double up.
  return url.replace(/\/+$/, "");
}

export const APP_ENV: AppEnv = extra.appEnv ?? "development";

export const API_BASE_URL: string = assertAbsolute(extra.apiBaseUrl);

/** Path prefix used by the existing Express backend. */
export const API_PREFIX = "/api";

/** Request timeout in ms — mobile networks are not localhost. */
export const API_TIMEOUT_MS = 15_000;

export const isDevelopment = APP_ENV === "development";
export const isStaging = APP_ENV === "staging";
export const isProduction = APP_ENV === "production";

/** Safe to log — contains no secrets. */
export const envSummary = {
  appEnv: APP_ENV,
  apiBaseUrl: API_BASE_URL,
} as const;
