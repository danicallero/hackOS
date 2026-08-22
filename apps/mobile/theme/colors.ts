import { Color } from "expo-router";
import { Appearance, type ColorValue, DynamicColorIOS, Platform } from "react-native";

function iosDynamic(light: string, dark: string) {
  return process.env.EXPO_OS === "ios" ? DynamicColorIOS({ light, dark }) : light;
}

// Glass fallbacks need fixed surfaces for their explicit light/dark variants,
// independent of the device scheme: a forced-dark panel on a light device must
// not become a pale surface behind white labels.
const glassLightSurface = "#ffffff";
const glassDarkSurface = "#1e1e20";

/**
 * Android renders the same palette iOS does, as an explicit light/dark pair.
 *
 * Material You (`Color.android.dynamic.*`) was tried first and is not a fit:
 * its neutral roles are lavender-tinted with almost no contrast between
 * `surface` and `surfaceContainer` (grouped cards vanished into the page), its
 * `*Container` roles are nothing like this app's tinted banner surfaces, and
 * because each token is a native call resolved when it is *read*, screens that
 * froze a token at module scope could end up mixing a light and a dark palette
 * in one frame. Fixed pairs make Android look like iOS and resolve from one
 * source of truth: the current scheme.
 */
function schemeHex(light: string, dark: string) {
  return Appearance.getColorScheme() === "dark" ? dark : light;
}

interface ColorSpec {
  ios: () => ColorValue;
  android: () => ColorValue;
  web: ColorValue;
}

/**
 * Platform semantic tokens: UIKit on iOS, the matching fixed pair on Android,
 * fixed fallbacks on web. Android entries are thunks so `colors` can resolve
 * them per access against the *current* scheme (memoised per scheme below) —
 * UIKit's dynamic colors re-resolve themselves, Android's cannot, and reading
 * them once at module load froze the palette to whatever scheme the app
 * launched in.
 *
 * `on…Surface` tokens are the foreground for the matching tinted `…Surface`
 * background (banner, pill, filled button); the base tone is for a tinted
 * mark on the ordinary page background.
 */
const SPECS = {
  label: {
    ios: () => Color.ios.label,
    android: () => schemeHex("#000000", "#ffffff"),
    web: "#171717",
  },
  secondaryLabel: {
    ios: () => Color.ios.secondaryLabel,
    android: () => schemeHex("#6c6c70", "#98989e"),
    web: "#5f6368",
  },
  tertiaryLabel: {
    ios: () => Color.ios.tertiaryLabel,
    android: () => schemeHex("#b1b1b6", "#6d6d72"),
    web: "#7c7c80",
  },
  background: {
    ios: () => Color.ios.systemGroupedBackground,
    android: () => schemeHex("#f2f2f7", "#000000"),
    web: "#f5f5f7",
  },
  surface: {
    ios: () => Color.ios.secondarySystemGroupedBackground,
    android: () => schemeHex("#ffffff", "#1c1c1e"),
    web: "#ffffff",
  },
  elevatedSurface: {
    ios: () => Color.ios.tertiarySystemGroupedBackground,
    android: () => schemeHex("#f2f2f7", "#2c2c2e"),
    web: "#ffffff",
  },
  separator: {
    ios: () => Color.ios.separator,
    android: () => schemeHex("#c6c6c8", "#38383a"),
    web: "#d1d1d6",
  },
  accent: {
    ios: () => Color.ios.systemBlue,
    android: () => schemeHex("#007aff", "#0a84ff"),
    web: "#007aff",
  },
  accentText: {
    ios: () => "#ffffff",
    android: () => schemeHex("#ffffff", "#ffffff"),
    web: "#ffffff",
  },
  primaryAction: {
    ios: () => iosDynamic("#0057b8", "#78b7ff"),
    android: () => schemeHex("#0057b8", "#78b7ff"),
    web: "#0057b8",
  },
  primaryActionText: {
    ios: () => iosDynamic("#ffffff", "#001a33"),
    android: () => schemeHex("#ffffff", "#001a33"),
    web: "#ffffff",
  },
  interactiveText: {
    ios: () => iosDynamic("#0057b8", "#78b7ff"),
    android: () => schemeHex("#0057b8", "#78b7ff"),
    web: "#0057b8",
  },
  accentSurface: {
    ios: () => iosDynamic("#e8f2ff", "#102a43"),
    android: () => schemeHex("#e8f2ff", "#102a43"),
    web: "#e8f2ff",
  },
  onAccentSurface: {
    ios: () => Color.ios.systemBlue,
    android: () => schemeHex("#0057b8", "#78b7ff"),
    web: "#007aff",
  },
  success: {
    ios: () => Color.ios.systemGreen,
    android: () => schemeHex("#248a3d", "#30d158"),
    web: "#248a3d",
  },
  successSurface: {
    ios: () => iosDynamic("#e8f7ed", "#10351c"),
    android: () => schemeHex("#e8f7ed", "#10351c"),
    web: "#e8f7ed",
  },
  onSuccessSurface: {
    ios: () => Color.ios.systemGreen,
    android: () => schemeHex("#248a3d", "#30d158"),
    web: "#248a3d",
  },
  warning: {
    ios: () => Color.ios.systemOrange,
    android: () => schemeHex("#c25d00", "#ff9f0a"),
    web: "#c25d00",
  },
  warningSurface: {
    ios: () => iosDynamic("#fff3e0", "#3b260c"),
    android: () => schemeHex("#fff3e0", "#3b260c"),
    web: "#fff3e0",
  },
  onWarningSurface: {
    ios: () => Color.ios.systemOrange,
    android: () => schemeHex("#c25d00", "#ff9f0a"),
    web: "#c25d00",
  },
  destructive: {
    ios: () => Color.ios.systemRed,
    android: () => schemeHex("#d70015", "#ff453a"),
    web: "#d70015",
  },
  destructiveSurface: {
    ios: () => iosDynamic("#fff0f0", "#3a1114"),
    android: () => schemeHex("#fff0f0", "#3a1114"),
    web: "#fff0f0",
  },
  onDestructiveSurface: {
    ios: () => Color.ios.systemRed,
    android: () => schemeHex("#d70015", "#ff453a"),
    web: "#d70015",
  },
  purple: {
    ios: () => Color.ios.systemPurple,
    android: () => schemeHex("#af52de", "#bf5af2"),
    web: "#af52de",
  },
  purpleSurface: {
    ios: () => iosDynamic("#f5ebff", "#2b1a3d"),
    android: () => schemeHex("#f5ebff", "#2b1a3d"),
    web: "#f5ebff",
  },
  onPurpleSurface: {
    ios: () => Color.ios.systemPurple,
    android: () => schemeHex("#af52de", "#bf5af2"),
    web: "#af52de",
  },
} satisfies Record<string, ColorSpec>;

type Palette = { [K in keyof typeof SPECS]: ColorValue } & {
  transparent: string;
  invisibleHitTarget: string;
  controlShadow: string;
  qrBackground: string;
  glassLightSurface: string;
  glassDarkSurface: string;
};

const androidCache = new Map<string, ColorValue>();
let androidScheme = Appearance.getColorScheme();

function resolveAndroid(name: keyof typeof SPECS, spec: ColorSpec): ColorValue {
  const scheme = Appearance.getColorScheme();
  if (scheme !== androidScheme) {
    androidScheme = scheme;
    androidCache.clear();
  }
  const cached = androidCache.get(name);
  if (cached !== undefined) return cached;
  const value = spec.android();
  androidCache.set(name, value);
  return value;
}

function buildPalette(): Palette {
  const palette = {
    transparent: "transparent",
    invisibleHitTarget: "rgba(0, 0, 0, 0.001)",
    controlShadow: "0 1px 2px rgba(0, 0, 0, 0.14)",
    qrBackground: "#ffffff",
    glassLightSurface,
    glassDarkSurface,
  } as Palette;

  for (const [name, spec] of Object.entries(SPECS) as [keyof typeof SPECS, ColorSpec][]) {
    if (Platform.OS === "android") {
      Object.defineProperty(palette, name, {
        enumerable: true,
        get: () => resolveAndroid(name, spec),
      });
      continue;
    }
    Object.defineProperty(palette, name, {
      enumerable: true,
      value: Platform.OS === "ios" ? spec.ios() : spec.web,
    });
  }
  return palette;
}

/** Platform semantic colors: UIKit on iOS, Material You on Android, fixed fallbacks on web. */
export const colors = buildPalette();
