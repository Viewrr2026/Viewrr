import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * A stable per-install identifier for push token bookkeeping.
 *
 * Why it exists: `POST /api/me/push-tokens` accepts an optional `deviceId` so
 * the server can tell one account's devices apart when it prunes invalid
 * tokens. Neither iOS nor Android exposes a stable hardware id to apps any
 * more (and it would be a privacy problem if they did), so this is a random
 * value generated once per install and kept in the Keychain / Keystore next to
 * the auth token.
 *
 * Properties, deliberately:
 *   • Random — it carries no user, hardware or advertising identity.
 *   • Per-install — reinstalling produces a new id, which is correct: the old
 *     install's push token is dead anyway.
 *   • Never sent anywhere except the token endpoints, never logged.
 *
 * It does NOT touch session/tokenStore. That module owns exactly one secret
 * and is not modified by the push feature.
 */

const DEVICE_ID_KEY = "viewrr.push.deviceId";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const isNative = Platform.OS === "ios" || Platform.OS === "android";

/** In-memory fallback for Expo web preview, where there is no Keychain. */
let ephemeral: string | null = null;

/**
 * 128 bits of `Math.random` entropy, hex encoded. Not a cryptographic key —
 * it authenticates nothing and only needs to be collision-free in practice.
 */
function generate(): string {
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0");
  }
  return out;
}

export async function getDeviceId(): Promise<string> {
  if (!isNative) {
    ephemeral ??= generate();
    return ephemeral;
  }

  try {
    const existing = await SecureStore.getItemAsync(DEVICE_ID_KEY, SECURE_OPTIONS);
    if (existing) return existing;
  } catch {
    // Keychain unavailable (locked device, simulator quirk) — fall through to a
    // fresh id rather than failing registration.
  }

  const created = generate();
  try {
    await SecureStore.setItemAsync(DEVICE_ID_KEY, created, SECURE_OPTIONS);
  } catch {
    // Not persistable this launch. The id still works for this session.
  }
  return created;
}
