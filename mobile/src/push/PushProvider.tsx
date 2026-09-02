import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";

import { deletePushToken, registerPushToken, type PushPlatform } from "@/api/push";
import { resolvePushTarget } from "@/navigation/linkResolver";
import { useNotifications } from "@/notifications/NotificationsProvider";
import { getDeviceId } from "@/push/deviceId";
import {
  clearRegistration,
  readRegistration,
  writeRegistration,
} from "@/push/registrationStore";
import { useSession } from "@/session/SessionProvider";

/**
 * Native push notifications (Decision 15).
 *
 * Honesty rules this provider is built around
 * -------------------------------------------
 *   • `enabled` is true only when the OS granted permission AND a token was
 *     accepted by the server. Permission granted with a failed registration is
 *     NOT push being on, and a denied permission is never dressed up as on.
 *   • Nothing is ever displayed that the server did not send. No local test
 *     notification, no sample banner.
 *   • A simulator, an Expo Go-style environment without push credentials, or a
 *     device that refuses a token all end in `supported: false` / an error
 *     string — never a crash and never a false positive.
 *
 * Permission timing
 * -----------------
 * The system prompt is NEVER raised on cold start. This provider mounts inside
 * the authenticated shell, so it only ever sees a signed-in user, and even
 * there it does two different things:
 *
 *   • On mount it only READS the current permission (`getPermissionsAsync`).
 *     If permission was already granted in a previous session it silently
 *     acquires and registers the token — the OS asks nothing.
 *   • The prompt itself is raised only by `requestPermission()` / `enable()`,
 *     which a screen calls in response to a deliberate user action (the push
 *     row in settings, or an explanatory prompt). One shot, in context, after
 *     sign-in — never before the user knows what the app is.
 *
 * Token lifecycle
 * ---------------
 *   sign-in → permission granted → getExpoPushTokenAsync
 *           → POST /api/me/push-tokens (upsert on user_id+token)
 *           → record {token, userId} in the Keychain
 *   rotation (addPushTokenListener) → POST the new token, replace the record
 *   different user on the same install → re-POST under the new user id
 *   sign-out → DELETE /api/me/push-tokens, clear the record
 *
 * Server-side invalid-token pruning (B3) covers the cases a client can never
 * see: uninstalls, disabled notifications and expired tokens.
 */

/**
 * Foreground presentation. Set at module scope so it is in place before any
 * notification can arrive, per the expo-notifications guidance.
 *
 * A banner and a list entry, no sound and no badge write: the unread badge is
 * owned by NotificationsProvider and read from the server, so letting a push
 * set it independently would produce two disagreeing numbers (Decision 18 —
 * inbox unread and notification events are different counters).
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    // Deprecated alias still present in the SDK 57 type.
    shouldShowAlert: true,
  }),
});

export type PushPermission = "undetermined" | "granted" | "denied";

export type PushState = {
  /** A physical iOS/Android device that can hold a push token at all. */
  supported: boolean;
  permission: PushPermission;
  /** Permission granted AND a token accepted by the server. The truth. */
  enabled: boolean;
  /** The registered Expo push token, when there is one. */
  token: string | null;
  /** True while a permission request or registration round-trip is running. */
  busy: boolean;
  /**
   * Why push is not on, in user-safe wording. Null when there is nothing to
   * report. Never contains a token.
   */
  error: string | null;
};

type PushValue = PushState & {
  /**
   * Raise the OS permission prompt if it has not been answered, then register.
   * Resolves to the truthful end state: true only if push is actually on.
   * Safe to call from a settings toggle or an in-context prompt.
   */
  enable: () => Promise<boolean>;
  /** Re-read permission and re-register if needed. No prompt is raised. */
  refresh: () => Promise<void>;
  /**
   * Deregister this device's token. Call BEFORE `signOut()` so the request
   * still carries a valid Bearer credential.
   */
  deregister: () => Promise<void>;
};

const PushContext = createContext<PushValue | null>(null);

const ANDROID_CHANNEL_ID = "default";

/** Brand orange, matching theme tokens `brand.orange` / the adaptive icon. */
const ANDROID_LIGHT_COLOR = "#FF5A1F";

/**
 * Deregistration that touches no React state, so it can run from an unmount
 * cleanup as well as from the public `deregister()`.
 *
 * Best effort by design: if the Bearer credential has already been cleared the
 * DELETE answers 401 and the server prunes the token on its first failed send
 * instead. The local record is dropped either way, so the next sign-in on this
 * install always re-registers rather than trusting a stale record.
 */
async function deregisterQuietly(): Promise<void> {
  const record = await readRegistration();
  if (record) {
    try {
      await deletePushToken(record.token);
    } catch {
      // Nothing further a client can do. Server-side invalid-token cleanup owns
      // the rest of this case.
    }
  }
  await clearRegistration();
}

function platformOf(): PushPlatform | null {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return null;
}

/**
 * The EAS project id, needed by `getExpoPushTokenAsync` in a dynamic-config
 * project. It is a public identifier declared once in app.config.ts; this only
 * reads it, and never falls back to a literal.
 */
function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as
    | { eas?: { projectId?: unknown } }
    | undefined;
  const fromExtra = extra?.eas?.projectId;
  if (typeof fromExtra === "string" && fromExtra.length > 0) return fromExtra;

  const fromEas = Constants.easConfig?.projectId;
  return typeof fromEas === "string" && fromEas.length > 0 ? fromEas : null;
}

function appVersion(): string | undefined {
  const version = Constants.expoConfig?.version;
  return typeof version === "string" ? version : undefined;
}

function toPermission(status: Notifications.NotificationPermissionsStatus): PushPermission {
  if (status.granted) return "granted";
  // `undetermined` is the only status that can still become granted without a
  // trip to the OS settings app.
  return status.status === "undetermined" ? "undetermined" : "denied";
}

export function PushProvider({ children }: { children: ReactNode }) {
  const { status: sessionStatus, user } = useSession();
  const { refresh: refreshBadge } = useNotifications();
  const router = useRouter();

  const userId = sessionStatus === "signed-in" ? (user?.id ?? null) : null;
  const role = user?.role ?? null;

  const [state, setState] = useState<PushState>({
    supported: platformOf() !== null,
    permission: "undetermined",
    enabled: false,
    token: null,
    busy: false,
    error: null,
  });

  const mounted = useRef(true);
  const registering = useRef(false);
  /** Latest values for listeners, which are registered once. */
  const userIdRef = useRef<number | null>(userId);
  const roleRef = useRef(role);

  userIdRef.current = userId;
  roleRef.current = role;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const patch = useCallback((next: Partial<PushState>) => {
    if (!mounted.current) return;
    setState((current) => ({ ...current, ...next }));
  }, []);

  /**
   * Acquire the Expo push token and register it, assuming permission is
   * already granted. Returns the token, or null with `error` set.
   */
  const acquireAndRegister = useCallback(
    async (targetUserId: number): Promise<string | null> => {
      if (registering.current) return null;
      registering.current = true;
      patch({ busy: true });

      try {
        if (!Device.isDevice) {
          patch({
            supported: false,
            enabled: false,
            error: "Push notifications need a physical device — a simulator cannot receive them.",
          });
          return null;
        }

        const projectId = easProjectId();
        if (!projectId) {
          patch({
            enabled: false,
            error: "Push is unavailable in this build: no Expo project id was found.",
          });
          return null;
        }

        if (Platform.OS === "android") {
          // Android 8+ refuses to display a notification without a channel.
          await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
            name: "Viewrr",
            importance: Notifications.AndroidImportance.DEFAULT,
            lightColor: ANDROID_LIGHT_COLOR,
          });
        }

        const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
        const platform = platformOf();
        if (!token || !platform) {
          patch({ enabled: false, error: "This device did not return a push token." });
          return null;
        }

        const previous = await readRegistration();
        const unchanged =
          previous !== null && previous.token === token && previous.userId === targetUserId;

        if (!unchanged) {
          await registerPushToken({
            token,
            platform,
            deviceId: await getDeviceId(),
            appVersion: appVersion(),
          });
          await writeRegistration({
            token,
            userId: targetUserId,
            registeredAt: Date.now(),
          });
        }

        patch({ supported: true, permission: "granted", enabled: true, token, error: null });
        return token;
      } catch {
        // Offline, an Expo push-service failure, missing APNs credentials, or a
        // rejected POST. Push is simply not on; the next foreground or an
        // explicit retry can try again.
        patch({
          enabled: false,
          error: "Push notifications could not be set up. You can try again from Settings.",
        });
        return null;
      } finally {
        registering.current = false;
        patch({ busy: false });
      }
    },
    [patch],
  );

  /** Read-only sync: never raises the OS prompt. */
  const refresh = useCallback(async () => {
    if (platformOf() === null) {
      patch({ supported: false, enabled: false, token: null });
      return;
    }
    if (userId === null) return;

    try {
      const permissions = await Notifications.getPermissionsAsync();
      const permission = toPermission(permissions);
      patch({ permission });

      if (permission !== "granted") {
        // Denied or unanswered — push is off, and saying anything else would be
        // a lie. No prompt is raised here.
        patch({ enabled: false, token: null });
        return;
      }

      await acquireAndRegister(userId);
    } catch {
      patch({ enabled: false, error: null });
    }
  }, [acquireAndRegister, patch, userId]);

  /** The only path that can raise the OS prompt. */
  const enable = useCallback(async (): Promise<boolean> => {
    if (userId === null) return false;

    if (platformOf() === null || !Device.isDevice) {
      patch({
        supported: false,
        enabled: false,
        error: "Push notifications need a physical device — a simulator cannot receive them.",
      });
      return false;
    }

    patch({ busy: true, error: null });
    try {
      const current = await Notifications.getPermissionsAsync();
      let permission = toPermission(current);

      if (permission === "undetermined") {
        const requested = await Notifications.requestPermissionsAsync();
        permission = toPermission(requested);
      }

      patch({ permission });

      if (permission !== "granted") {
        patch({
          enabled: false,
          token: null,
          error:
            permission === "denied"
              ? "Notifications are turned off for Viewrr in your device settings."
              : null,
        });
        return false;
      }

      const token = await acquireAndRegister(userId);
      return token !== null;
    } catch {
      patch({ enabled: false, error: "Push notifications could not be set up." });
      return false;
    } finally {
      patch({ busy: false });
    }
  }, [acquireAndRegister, patch, userId]);

  const deregister = useCallback(async () => {
    patch({ enabled: false, token: null });
    await deregisterQuietly();
  }, [patch]);

  // ── Sign-out ────────────────────────────────────────────────────────────
  //
  // Two paths, because this provider lives inside the authenticated shell and
  // the shell redirects away the instant the session ends — the state change
  // and the unmount can arrive in either order.
  //
  //   • The session flips to signed-out while this subtree is still mounted:
  //     the effect below fires.
  //   • The redirect unmounts the subtree first: the cleanup fires, and it
  //     checks the live session ref so a remount for any other reason (fast
  //     refresh, a layout remount) does not deregister a valid token.
  //
  // A screen with a sign-out button should still call `deregister()` BEFORE
  // `signOut()` — that is the one ordering where the DELETE is guaranteed to
  // carry a valid credential.
  const signedInRef = useRef(sessionStatus === "signed-in");
  const hadRegistration = useRef(false);

  signedInRef.current = sessionStatus === "signed-in";
  if (state.enabled) hadRegistration.current = true;

  useEffect(() => {
    if (sessionStatus === "signed-in") return;
    if (!hadRegistration.current) return;
    hadRegistration.current = false;
    void deregisterQuietly();
  }, [sessionStatus]);

  useEffect(
    () => () => {
      if (signedInRef.current) return;
      if (!hadRegistration.current) return;
      hadRegistration.current = false;
      void deregisterQuietly();
    },
    [],
  );

  // ── Silent registration once a signed-in user is present ────────────────
  useEffect(() => {
    if (userId === null) {
      patch({ enabled: false, token: null });
      return;
    }
    void refresh();
  }, [patch, refresh, userId]);

  // ── Token rotation ──────────────────────────────────────────────────────
  useEffect(() => {
    const subscription = Notifications.addPushTokenListener(() => {
      const current = userIdRef.current;
      if (current === null) return;
      // Re-read and re-post through the normal path so the stored record and
      // the server stay in step.
      void acquireAndRegister(current);
    });
    return () => subscription.remove();
  }, [acquireAndRegister]);

  // ── Foreground receipt ──────────────────────────────────────────────────
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(() => {
      // The banner is drawn by the handler above. The only app-state change a
      // received push justifies is re-reading the real unread count from the
      // server — the badge is never incremented locally on a guess.
      refreshBadge();
    });
    return () => subscription.remove();
  }, [refreshBadge]);

  // ── Tap handling: same destination as the in-app row ────────────────────
  const handledResponse = useRef<string | null>(null);

  const openFromResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const id = response.notification.request.identifier;
      if (id && handledResponse.current === id) return;
      handledResponse.current = id;

      const data = response.notification.request.content.data;
      const target = resolvePushTarget(data, roleRef.current);
      router.push(target);
      refreshBadge();
    },
    [refreshBadge, router],
  );

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(openFromResponse);
    return () => subscription.remove();
  }, [openFromResponse]);

  // Cold start from a tapped push: the response that launched the app is not
  // delivered to the listener above, so it is claimed once here.
  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;

    void (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (!cancelled && last) openFromResponse(last);
      } catch {
        // No launch notification, or the module is unavailable in this runtime.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openFromResponse, userId]);

  const value = useMemo<PushValue>(
    () => ({ ...state, enable, refresh, deregister }),
    [deregister, enable, refresh, state],
  );

  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

/**
 * Push state and controls.
 *
 * Read `enabled` for "is push actually on", `permission` for why not, and call
 * `enable()` from a deliberate user action. Outside <PushProvider> this throws
 * rather than returning a fake "off" state.
 */
export function usePush(): PushValue {
  const value = useContext(PushContext);
  if (!value) {
    throw new Error("usePush must be used inside <PushProvider>");
  }
  return value;
}
