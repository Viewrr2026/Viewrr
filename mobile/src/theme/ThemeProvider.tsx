import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

import {
  badges,
  elevation,
  palettes,
  type BadgeTones,
  type ColorScheme,
  type Palette,
} from "@/theme/tokens";

/**
 * Mirrors client/src/components/ThemeProvider.tsx on web: the theme follows the
 * OS colour-scheme preference by default and can be toggled at runtime. Web
 * defaults to prefers-color-scheme, so native defaults to useColorScheme().
 */

type ThemeValue = {
  scheme: ColorScheme;
  colors: Palette;
  shadows: ReturnType<typeof elevation>;
  badge: BadgeTones;
  /** True when the scheme is following the OS rather than an explicit choice. */
  isSystem: boolean;
  toggle: () => void;
  useSystem: () => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme: ColorScheme = useColorScheme() === "dark" ? "dark" : "light";
  const [override, setOverride] = useState<ColorScheme | null>(null);

  const scheme = override ?? systemScheme;

  const toggle = useCallback(() => {
    setOverride((current) => ((current ?? systemScheme) === "dark" ? "light" : "dark"));
  }, [systemScheme]);

  const useSystem = useCallback(() => setOverride(null), []);

  const value = useMemo<ThemeValue>(
    () => ({
      scheme,
      colors: palettes[scheme],
      shadows: elevation(scheme),
      badge: badges[scheme],
      isSystem: override === null,
      toggle,
      useSystem,
    }),
    [override, scheme, toggle, useSystem],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return value;
}

/**
 * Build a StyleSheet from the active palette, memoised per scheme.
 * Keeps component styles declarative while staying theme-aware.
 */
export function useThemedStyles<T>(factory: (theme: ThemeValue) => T): T {
  const theme = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- factory is stable per module
  return useMemo(() => factory(theme), [theme]);
}
