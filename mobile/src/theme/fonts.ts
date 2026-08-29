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
  "Satoshi-400": require("../../assets/fonts/Satoshi-400.ttf"),
  "Satoshi-500": require("../../assets/fonts/Satoshi-500.ttf"),
  "Satoshi-700": require("../../assets/fonts/Satoshi-700.ttf"),
  "Satoshi-900": require("../../assets/fonts/Satoshi-900.ttf"),
  "ClashDisplay-500": require("../../assets/fonts/ClashDisplay-500.ttf"),
  "ClashDisplay-600": require("../../assets/fonts/ClashDisplay-600.ttf"),
  "ClashDisplay-700": require("../../assets/fonts/ClashDisplay-700.ttf"),
} as const;
