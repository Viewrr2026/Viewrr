import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Local-only, read-only preflight. No signing, upload, API calls or submission.
// This script runs from release:preflight; it is not an EAS build hook.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expo = resolve(root, "node_modules/expo/bin/cli");
const eas = JSON.parse(readFileSync(resolve(root, "eas.json"), "utf8"));
const profile = eas.build.production;
// Introspection applies config plugins, including plugins that can remove plist keys.
const result = execFileSync(process.execPath, [expo, "config", "--type", "introspect", "--json"], {
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
const generatedIos = config._internal?.modResults?.ios;
const generatedInfoPlist = generatedIos?.infoPlist;
for (const key of ["NSCameraUsageDescription", "NSPhotoLibraryUsageDescription"]) {
  assert.ok(
    typeof generatedInfoPlist?.[key] === "string" && generatedInfoPlist[key].trim().length > 0,
    `Generated iOS Info.plist must include ${key} before building for App Store Connect`,
  );
}
assert.equal(generatedInfoPlist.NSCameraUsageDescription, config.ios.infoPlist.NSCameraUsageDescription);
assert.equal(generatedIos.entitlements["aps-environment"], "production");
assert.match(config.version, /^\d+\.\d+\.\d+$/);
const notifications = config.plugins.find(
  (plugin) => Array.isArray(plugin) && plugin[0] === "expo-notifications",
);
assert.equal(notifications?.[1]?.mode, "production");

const stripePlugin = config.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === "@stripe/stripe-react-native");
assert.equal(stripePlugin?.[1]?.merchantIdentifier, "merchant.uk.co.viewrr.app");
assert.equal(config.extra.appleMerchantId, stripePlugin[1].merchantIdentifier);
assert.deepEqual(generatedIos.entitlements["com.apple.developer.in-app-payments"], [config.extra.appleMerchantId]);
assert.equal(config.extra.paymentUrlScheme, config.scheme);
// A native Stripe module cannot be delivered over the old 0.1.0 OTA runtime.
assert.notEqual(config.version, "0.1.0");

console.log(`PASS: production config, ${config.ios.bundleIdentifier}, version ${config.version}`);
console.log("PASS: generated iOS camera/photo purpose strings and Apple Pay/push entitlements");
console.log("NOT checked: Apple account, signing, native archive, App Store privacy answers, payments or device UX.");
console.log("Passing this command is not App Store submission approval.");
