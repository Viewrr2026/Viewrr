import type { IStorage } from "./storage";

type ProfileStore = Pick<IStorage, "getProfile" | "getProfileByUserId" | "getUser">;

/** User IDs and profile IDs are separate namespaces and can have the same value. */
export async function resolvePublicProfile(store: ProfileStore, id: number, lookup: "user" | "legacy") {
  if (!Number.isSafeInteger(id) || id < 1) return undefined;
  // Keep historical profile-ID links working; new user links never use this fallback.
  let match = lookup === "legacy" ? await store.getProfile(id) : undefined;
  if (!match) {
    const profile = await store.getProfileByUserId(id);
    if (profile) match = await store.getProfile(profile.id);
  }
  const user = match?.user ?? await store.getUser(id);
  if (!user || user.accountStatus !== "active" || user.isAdmin || user.role !== "freelancer") return undefined;
  if (lookup === "user" && user.id !== id) return undefined;
  return { user, profile: match?.profile ?? null };
}
