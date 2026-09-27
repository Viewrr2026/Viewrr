import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Local-only, read-only preflight. No signing, upload, API calls or submission.
// This script is intentionally not an EAS build hook (.easignore excludes scripts).
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expo = resolve(root, "node_modules/expo/bin/cli");
const eas = JSON.parse(readFileSync(resolve(root, "eas.json"), "utf8"));
const profile = eas.build.production;
const result = execFileSync(process.execPath, [expo, "config", "--type", "public", "--json"], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, ...profile.env, APP_ENV: "production", EXPO_NO_DOTENV: "1" },
});
const config = JSON.parse(result);
const projectId = "1d650340-9486-46f3-894f-86b4f4d9eb5e";

assert.equal(profile.env.APP_ENV, "production");
assert.equal(profile.environment, "production");
assert.equal(profile.distribution, "store");
assert.equal(profile.developmentClient, false);
assert.equal(profile.ios.buildConfiguration, "Release");
assert.notEqual(profile.ios.simulator, true);
assert.equal(profile.autoIncrement, true);
assert.equal(profile.channel, "production");
assert.equal(eas.cli.appVersionSource, "remote");
assert.equal(config.name, "Viewrr");
assert.equal(config.scheme, "viewrr");
assert.equal(config.owner, "viewrr-limited");
assert.equal(config.slug, "viewrr-app");
assert.equal(config.ios.bundleIdentifier, "uk.co.viewrr.app");
assert.equal(config.extra.appEnv, "production");
assert.equal(config.extra.apiBaseUrl, "https://www.viewrr.co.uk");
assert.equal(config.extra.eas.projectId, projectId);
assert.equal(config.updates.url, `https://u.expo.dev/${projectId}`);
assert.equal(config.runtimeVersion.policy, "appVersion");
assert.equal(config.ios.infoPlist.ITSAppUsesNonExemptEncryption, false);
assert.match(config.version, /^\d+\.\d+\.\d+$/);
const notifications = config.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-notifications",
);
assert.equal(notifications?.[1]?.mode, "production");

console.log(`PASS: production config, ${config.ios.bundleIdentifier}, version ${config.version}`);
console.log("NOT checked: Apple account, signing, native archive, privacy declarations, payments or device UX.");
console.log("Passing this command is not App Store submission approval.");
