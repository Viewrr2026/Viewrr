import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePublicProfile } from "../public-profile";

function fixture() {
  const users = new Map<number, any>([
    [42, { id: 42, name: "Creative A", role: "freelancer", accountStatus: "active", isAdmin: false }],
    [7, { id: 7, name: "Creative B", role: "freelancer", accountStatus: "active", isAdmin: false }],
  ]);
  const profiles = new Map<number, any>([[7, { id: 7, userId: 42 }], [42, { id: 42, userId: 7 }]]);
  const store = {
    getUser: async (id: number) => users.get(id),
    getProfile: async (id: number) => {
      const profile = profiles.get(id), user = profile && users.get(profile.userId);
      return profile && user ? { profile, user } : undefined;
    },
    getProfileByUserId: async (id: number) => [...profiles.values()].find(p => p.userId === id),
  };
  return { users, profiles, store };
}

test("account links resolve the intended person even when another profile has the same ID", async () => {
  const { store } = fixture();
  const byUser = await resolvePublicProfile(store, 42, "user");
  assert.equal(byUser?.user.name, "Creative A");
  assert.equal(byUser?.profile?.id, 7);
  assert.equal((await resolvePublicProfile(store, 7, "user"))?.user.name, "Creative B");
  // Existing profile-ID bookmarks still identify their original owner.
  assert.equal((await resolvePublicProfile(store, 42, "legacy"))?.user.name, "Creative B");
});

test("a missing account or profile never opens a different person's colliding profile", async () => {
  const { store, users, profiles } = fixture();
  profiles.delete(7);
  const withoutProfile = await resolvePublicProfile(store, 42, "user");
  assert.equal(withoutProfile?.user.id, 42);
  assert.equal(withoutProfile?.profile, null);
  users.delete(42);
  assert.equal(await resolvePublicProfile(store, 42, "user"), undefined);
});

test("explicit account lookup preserves public visibility restrictions", async () => {
  for (const patch of [{ role: "client" }, { isAdmin: true }, { accountStatus: "suspended" }, { accountStatus: "anonymised" }]) {
    const { store, users } = fixture();
    Object.assign(users.get(42), patch);
    assert.equal(await resolvePublicProfile(store, 42, "user"), undefined);
  }
});

test("invalid IDs do not reach storage", async () => {
  const unexpected = async () => assert.fail("invalid IDs must not query storage");
  const store = { getProfile: unexpected, getProfileByUserId: unexpected, getUser: unexpected };
  for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(await resolvePublicProfile(store, id, "user"), undefined);
  }
});
