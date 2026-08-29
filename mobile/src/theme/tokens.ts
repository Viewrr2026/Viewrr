/**
 * Viewrr Mobile design tokens — derived from the production web app.
 *
 * SOURCE OF TRUTH (audited, not approximated):
 *   • client/src/index.css      → :root and .dark CSS custom properties
 *   • tailwind.config.ts        → borderRadius overrides, status colours
 *   • client/index.html         → Satoshi + Clash Display, theme-color
 *   • literal hex values used across client/src (counted, most-used wins)
 *
 * Every HSL variable below is the exact hex conversion of the web value, e.g.
 * `--background: 20 14% 97%` → #F8F7F6. Nothing is imported from the web
 * package: values are ported by value so /mobile stays an isolated package.
 *
 * Web ships BOTH themes (ThemeProvider follows prefers-color-scheme and offers
 * a toggle), so mobile does the same via useColorScheme. Light is the canonical
 * Viewrr surface; dark is the same brand on the warm near-black ramp.
 */

/* ── Brand ─────────────────────────────────────────────────────────────────
 * #FF5A1F appears 381× in client/src, #FF8C42 67× (the CTA gradient partner),
 * #FFA500 30× (Pro / gold treatments), #E04D16 3× (pressed brand).
 */
export const brand = {
  orange: "#FF5A1F", // --primary (light) / --color-brand / theme-color
  orangeDark: "#E04D16", // pressed / active brand
  orangeBright: "#FF6933", // --primary (dark theme) = hsl(16 100% 60%)
  orangeMid: "#FF8C42", // gradient partner, dominant CTA gradient end
  amber: "#FFA500", // Pro Viewrr gradient end
  gold: "#F59E0B", // --color-gold, star ratings
  goldBright: "#FFD700", // premium accents
  tint: "#FFF5F0", // --color-brand-bg
} as const;

/** The web CTA gradient: linear-gradient(135deg,#FF5A1F,#FF8C42) — 58 uses. */
export const gradients = {
  brand: [brand.orange, brand.orangeMid] as const,
  /** .gradient-text — used for the "Viewrr" wordmark in the navbar. */
  wordmark: [brand.orange, brand.gold] as const,
  /** Pro Viewrr / premium surfaces. */
  pro: [brand.orange, brand.amber] as const,
} as const;

/* ── Status ────────────────────────────────────────────────────────────────
 * From tailwind.config.ts `status.*`, index.css badge classes and the most
 * frequently used literals in client/src.
 */
export const status = {
  success: "#16A34A", // used 13× (green-600)
  successBright: "#22C55E", // tailwind status.online
  warning: "#F59E0B", // tailwind status.away / --color-gold
  error: "#DC2626", // used 9× (red-600)
  errorBright: "#EF4444", // used 8× — matches --destructive (light)
  offline: "#9CA3AF", // tailwind status.offline
  emerald: "#10B981", // --color-success
} as const;

export type BadgeTones = {
  available: { background: string; text: string };
  busy: { background: string; text: string };
  unavailable: { background: string; text: string };
};

/** Availability badges — index.css .badge-* (light) and .dark .badge-* pairs. */
export const badges: Record<"light" | "dark", BadgeTones> = {
  light: {
    available: { background: "#D1FAE5", text: "#065F46" },
    busy: { background: "#FEF3C7", text: "#92400E" },
    unavailable: { background: "#FEE2E2", text: "#991B1B" },
  },
  dark: {
    available: { background: "#064E3B", text: "#6EE7B7" },
    busy: { background: "#451A03", text: "#FCD34D" },
    unavailable: { background: "#450A0A", text: "#FCA5A5" },
  },
} as const;

/* ── Palettes ─────────────────────────────────────────────────────────────── */

export type Palette = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accentSurface: string;
  accentSurfaceForeground: string;
  primary: string;
  primaryForeground: string;
  primaryPressed: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  /** Translucent brand wash — web uses bg-primary/10 for active nav items. */
  primaryWash: string;
  primaryWashBorder: string;
  /** Shadow colour tuned per scheme (web: rgba(0,0,0,.12) light / .4 dark). */
  shadow: string;
  overlay: string;
};

/** :root in client/src/index.css — the default Viewrr surface. */
export const lightPalette: Palette = {
  background: "#F8F7F6", // 20 14% 97%
  foreground: "#1C1917", // 20 10% 10%
  card: "#FFFFFF", // 0 0% 100%
  cardForeground: "#1C1917",
  popover: "#FFFFFF",
  secondary: "#F1EFEE", // 20 10% 94%
  secondaryForeground: "#2A2522", // 20 10% 15%
  muted: "#EDEAE9", // 20 10% 92%
  mutedForeground: "#7C706A", // 20 8% 45%
  accentSurface: "#EDEAE9", // --accent
  accentSurfaceForeground: "#1C1917",
  primary: brand.orange, // 16 100% 56%
  primaryForeground: "#FFFFFF",
  primaryPressed: brand.orangeDark,
  destructive: "#EF4343", // 0 84% 60%
  destructiveForeground: "#FAFAFA",
  border: "#E3DFDD", // 20 10% 88%
  input: "#E3DFDD",
  ring: brand.orange,
  primaryWash: "rgba(255, 90, 31, 0.10)",
  primaryWashBorder: "rgba(255, 90, 31, 0.20)",
  shadow: "rgba(28, 25, 23, 0.12)",
  overlay: "rgba(28, 25, 23, 0.45)",
};

/** .dark in client/src/index.css. */
export const darkPalette: Palette = {
  background: "#171412", // 20 12% 8%
  foreground: "#E8E5E3", // 20 8% 90%
  card: "#1F1B19", // 20 10% 11%
  cardForeground: "#E8E5E3",
  popover: "#1F1B19",
  secondary: "#2D2725", // 20 10% 16%
  secondaryForeground: "#D0CBC8", // 20 8% 80%
  muted: "#2D2725",
  mutedForeground: "#938A85", // 20 6% 55%
  accentSurface: "#2D2725",
  accentSurfaceForeground: "#E8E5E3",
  primary: brand.orangeBright, // 16 100% 60%
  primaryForeground: "#FFFFFF",
  primaryPressed: brand.orange,
  destructive: "#DC2828", // 0 72% 51%
  destructiveForeground: "#FAFAFA",
  border: "#322C29", // 20 10% 18%
  input: "#322C29",
  ring: brand.orangeBright,
  primaryWash: "rgba(255, 105, 51, 0.12)",
  primaryWashBorder: "rgba(255, 105, 51, 0.24)",
  shadow: "rgba(0, 0, 0, 0.40)",
  overlay: "rgba(0, 0, 0, 0.60)",
};

export const palettes = { light: lightPalette, dark: darkPalette } as const;
export type ColorScheme = keyof typeof palettes;

/* ── Radii ────────────────────────────────────────────────────────────────
 * tailwind.config.ts overrides sm/md/lg; xl/2xl/3xl are Tailwind defaults.
 * Usage counted in client/src: rounded-full 573×, rounded-xl 288×,
 * rounded-2xl 189×, rounded-lg 126×, rounded-md 46×.
 */
export const radii = {
  sm: 3, // .1875rem
  md: 6, // .375rem  — shadcn button/input default
  lg: 9, // .5625rem
  xl: 12, // Tailwind default — the dominant card radius, == --radius (0.75rem)
  "2xl": 16, // large feature cards
  "3xl": 24,
  full: 999, // pills, badges, avatars
} as const;

/* ── Spacing ──────────────────────────────────────────────────────────────
 * Tailwind's 4pt scale, same rhythm as web. Gutter is a deliberate mobile
 * adaptation (web uses px-4/sm:px-6 inside a max-w-7xl centred container).
 */
export const spacing = {
  "0.5": 2,
  1: 4,
  1.5: 6,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/** Screen gutter — 16pt matches the web's px-4 mobile gutter. */
export const gutter = 16;

/* ── Typography ───────────────────────────────────────────────────────────
 * Web: body = Satoshi, headings = Clash Display (both Fontshare, loaded in
 * client/index.html). Both families are bundled in assets/fonts and registered
 * in theme/fonts.ts, so mobile renders the real brand faces rather than the
 * system stack. Sizes are Tailwind's scale — client/src is dominated by
 * text-xs (1177×) and text-sm (892×), with 2xl/3xl/4xl for headings.
 */
export const fontFamily = {
  /** Satoshi — body copy, labels, buttons. */
  body: "Satoshi-400",
  bodyMedium: "Satoshi-500",
  bodyBold: "Satoshi-700",
  bodyBlack: "Satoshi-900",
  /** Clash Display — headings, exactly as h1–h6 on web. */
  display: "ClashDisplay-600",
  displayMedium: "ClashDisplay-500",
  displayBold: "ClashDisplay-700",
} as const;

export const typography = {
  /** text-4xl / Clash Display 600 — hero headline. line-height 1.15 as on web. */
  display: { fontFamily: fontFamily.display, fontSize: 36, lineHeight: 41 },
  /** text-3xl */
  h1: { fontFamily: fontFamily.display, fontSize: 30, lineHeight: 35 },
  /** text-2xl — web CardTitle size */
  h2: { fontFamily: fontFamily.display, fontSize: 24, lineHeight: 28 },
  /** text-lg */
  h3: { fontFamily: fontFamily.display, fontSize: 18, lineHeight: 22 },
  /** text-base */
  body: { fontFamily: fontFamily.body, fontSize: 16, lineHeight: 24 },
  bodyMedium: { fontFamily: fontFamily.bodyMedium, fontSize: 16, lineHeight: 24 },
  bodyBold: { fontFamily: fontFamily.bodyBold, fontSize: 16, lineHeight: 24 },
  /** text-sm — the web's workhorse size */
  small: { fontFamily: fontFamily.body, fontSize: 14, lineHeight: 20 },
  smallMedium: { fontFamily: fontFamily.bodyMedium, fontSize: 14, lineHeight: 20 },
  smallBold: { fontFamily: fontFamily.bodyBold, fontSize: 14, lineHeight: 20 },
  /** text-xs — badges, meta, pills */
  caption: { fontFamily: fontFamily.bodyMedium, fontSize: 12, lineHeight: 16 },
  captionBold: { fontFamily: fontFamily.bodyBold, fontSize: 12, lineHeight: 16 },
  /** Uppercase eyebrow/label treatment used across web section headers. */
  eyebrow: {
    fontFamily: fontFamily.bodyBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
  },
} as const;

/* ── Elevation ────────────────────────────────────────────────────────────
 * Tailwind shadow-sm / md / lg translated to RN. Web cards use shadow-sm;
 * .card-lift hover uses 0 12px 32px rgba(0,0,0,.12) — the "lg" entry.
 */
export function elevation(scheme: ColorScheme) {
  const shadowColor = palettes[scheme].shadow;
  return {
    none: {},
    sm: {
      shadowColor,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 1,
      shadowRadius: 2,
      elevation: 1,
    },
    md: {
      shadowColor,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 1,
      shadowRadius: 6,
      elevation: 3,
    },
    lg: {
      shadowColor,
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 1,
      shadowRadius: 32,
      elevation: 8,
    },
    /** shadow-primary/25 — brand-tinted glow under primary CTAs. */
    brand: {
      shadowColor: brand.orange,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.28,
      shadowRadius: 14,
      elevation: 6,
    },
  } as const;
}

export const opacity = {
  disabled: 0.5, // web: disabled:opacity-50
  pressed: 0.9,
} as const;

/* ── Touch (mobile-only adaptation) ───────────────────────────────────────
 * Web controls are 36pt tall (h-9). That is below the iOS HIG 44pt / Android
 * 48dp minimum, so native controls are taller while keeping web's proportions.
 */
export const control = {
  height: 48,
  heightCompact: 40,
  minTouchTarget: 44,
} as const;

export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;

export const durations = {
  fast: 120,
  base: 200, // web transitions use 0.2s ease
  slow: 320,
} as const;

export const tokens = {
  brand,
  gradients,
  status,
  badges,
  palettes,
  radii,
  spacing,
  gutter,
  typography,
  fontFamily,
  opacity,
  control,
  hitSlop,
  durations,
} as const;
