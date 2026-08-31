import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * The ONLY place the native Bearer credential is read or written.
 *
 * PRD-019 issues a raw opaque token from POST /api/auth/mobile/login. It is a
 * password-equivalent, so:
 *   • On iOS/Android it lives in the Keychain / Keystore via expo-secure-store.
 *     Never AsyncStorage, never a plaintext file, never a JS global that
 *     survives a reload.
 *   • It is never logged, never interpolated into an error message and never
 *     rendered. Callers get the string and hand it straight to a request header.
 *   • On web (Expo web preview only — the shipped product is native) there is
 *     no Keychain. We deliberately do NOT fall back to localStorage or a
 *     cookie: the token is held in module memory for that tab only and is gone
 *     on reload. That makes cold-start restore a no-op on web by design, and
 *     keeps the web platform's own HttpOnly `vr_sess` cookie model the single
 *     source of truth for browsers.
 */

const TOKEN_KEY = "viewrr.auth.token";

/**
 * Keychain accessibility: the token must not be readable while the device is
 * locked, and must not migrate to a new device through an iCloud backup.
 */
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const isNative = Platform.OS === "ios" || Platform.OS === "android";

/** Web-preview-only, in-memory holder. Never persisted. */
let ephemeralWebToken: string | null = null;

export async function getToken(): Promise<string | null> {
  if (!isNative) return ephemeralWebToken;
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY, SECURE_OPTIONS);
  } catch {
    // A read failure (locked keychain, corrupted entry) is treated as
    // "no credential" rather than surfacing storage internals.
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  if (!isNative) {
    ephemeralWebToken = token;
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token, SECURE_OPTIONS);
}

export async function clearToken(): Promise<void> {
  ephemeralWebToken = null;
  if (!isNative) return;
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY, SECURE_OPTIONS);
  } catch {
    // Deleting a key that is already absent must never throw upwards — the
    // caller's intent ("be signed out") is satisfied either way.
  }
}

/** True when this platform can persist a credential across app launches. */
export const canPersistCredential = isNative;
