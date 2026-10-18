/**
 * Brand typefaces — the same two families the website loads from Fontshare in
 * client/index.html:
 *   Satoshi        → body copy  (--font-sans)
 *   Clash Display  → headings   (h1–h6)
 *
 * The .ttf files in assets/fonts are the Fontshare-hosted weights the web app
 * requests, bundled locally so the native app does not depend on a webfont CDN.
 * Keys match theme/tokens.ts `fontFamily`.
 */

export const fontAssets = {
  "Satoshi-400": require("../../assets/fonts/Satoshi-Regular.ttf"),
  "Satoshi-500": require("../../assets/fonts/Satoshi-Medium.ttf"),
  "Satoshi-700": require("../../assets/fonts/Satoshi-Bold.ttf"),
  "Satoshi-900": require("../../assets/fonts/Satoshi-Black.ttf"),
  "ClashDisplay-500": require("../../assets/fonts/ClashDisplay-Medium.ttf"),
  "ClashDisplay-600": require("../../assets/fonts/ClashDisplay-Semibold.ttf"),
  "ClashDisplay-700": require("../../assets/fonts/ClashDisplay-Bold.ttf"),
} as const;
