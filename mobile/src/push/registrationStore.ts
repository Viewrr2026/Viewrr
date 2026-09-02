import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Remembers the last push token this install successfully registered, and for
 * which user.
 *
 * Two jobs:
 *   1. Rotation detection. Expo can hand back a new token at any time; posting
 *      the same token on every launch is wasted work, while missing a rotation
 *      silently kills push. Comparing against this record answers both.
 *   2. Sign-out cleanup. Deregistration needs the token string, and the
 *      provider may be unmounted by the time sign-out completes, so the token
 *      is read from here rather than from React state.
 *
 * The token is not a secret in the way the Bearer credential is — it only lets
 * Expo's service address this device — but it is device-identifying, so it
 * lives in the same protected store rather than in plaintext.
 */

const KEY = "viewrr.push.registration";

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const isNative = Platform.OS === "ios" || Platform.OS === "android";

export type PushRegistrationRecord = {
  token: string;
  userId: number;
  /** Epoch ms of the last successful POST, for diagnostics only. */
  registeredAt: number;
};

let ephemeral: PushRegistrationRecord | null = null;

function parse(raw: string | null): PushRegistrationRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    const token = record["token"];
    const userId = record["userId"];
    const registeredAt = record["registeredAt"];
    if (typeof token !== "string" || token.length === 0) return null;
    if (typeof userId !== "number") return null;
    return {
      token,
      userId,
      registeredAt: typeof registeredAt === "number" ? registeredAt : 0,
    };
  } catch {
    return null;
  }
}

export async function readRegistration(): Promise<PushRegistrationRecord | null> {
  if (!isNative) return ephemeral;
  try {
    return parse(await SecureStore.getItemAsync(KEY, SECURE_OPTIONS));
  } catch {
    return null;
  }
}

export async function writeRegistration(record: PushRegistrationRecord): Promise<void> {
  if (!isNative) {
    ephemeral = record;
    return;
  }
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(record), SECURE_OPTIONS);
  } catch {
    // Non-fatal: the token is registered server-side either way, we just lose
    // the ability to skip the next redundant POST.
  }
}

export async function clearRegistration(): Promise<void> {
  ephemeral = null;
  if (!isNative) return;
  try {
    await SecureStore.deleteItemAsync(KEY, SECURE_OPTIONS);
  } catch {
    // Nothing to do — the record is advisory.
  }
}
