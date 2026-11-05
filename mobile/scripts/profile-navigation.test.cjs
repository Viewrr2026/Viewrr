const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function loadSource(path, mocks = {}) {
  const filename = resolve(__dirname, "..", path);
  const code = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = id => Object.hasOwn(mocks, id) ? mocks[id] : require(id);
  mod._compile(code, filename);
  return mod.exports;
}
const links = loadSource("src/navigation/linkResolver.ts");
const expectedUser = { pathname: "/(app)/discover/[profileId]", params: { profileId: "42", idKind: "user" } };

test("account destinations retain their ID namespace through native navigation", () => {
  assert.deepEqual(links.profileForUser(42), expectedUser);
  assert.deepEqual(links.resolvePushTarget({ targetType: "profile", targetId: 42 }), expectedUser);
  assert.deepEqual(links.resolveNotificationTarget({ type: "profile_view", actorId: 42, link: "/profile/7" }), expectedUser);
});

test("new web profile URLs use account lookup and historical profile URLs keep their meaning", () => {
  for (const link of ["/profile/user/42", "https://www.viewrr.co.uk/#/profile/user/42"]) {
    assert.deepEqual(links.resolveNotificationLink(link), expectedUser);
  }
  assert.deepEqual(links.resolveNotificationLink("/profile/42"), {
    pathname: "/(app)/discover/[profileId]", params: { profileId: "42" },
  });
  assert.deepEqual(links.resolveNotificationLink("/profile/user/invalid"), { pathname: "/(app)/discover" });
});

test("an account ID never falls back to the ambiguous profile endpoint, including on a 404", async () => {
  const calls = [];
  const api = { get: async (path, options) => {
    calls.push({ path, options });
    if (path.includes("by-user")) throw new Error("Profile not found");
    return { user: { id: 7 }, profile: { id: 42 } };
  } };
  const { loadTalentDetail } = loadSource("src/api/talent.ts", { "@/api/client": { api } });
  const signal = new AbortController().signal;
  await assert.rejects(loadTalentDetail(42, signal, "user"), /Profile not found/);
  assert.deepEqual(calls, [{ path: "/api/profiles/by-user/42", options: { signal } }]);
  const legacy = await loadTalentDetail(42, signal, "profile");
  assert.equal(legacy.user.id, 7);
  assert.equal(calls[1].path, "/api/profiles/42");
});
