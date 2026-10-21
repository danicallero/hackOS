import type { ConfigContext, ExpoConfig } from "expo/config";

// app.config.ts runs in Node, but the mobile tsconfig intentionally does not
// include @types/node for the client bundle.
declare function require(moduleName: "node:fs"): { existsSync(path: string): boolean };
declare function require(moduleName: "node:child_process"): {
  execFileSync(command: string, args: string[], options: { encoding: "utf8" }): string;
};

function buildCommit(): string | undefined {
  const provided = process.env.EAS_BUILD_GIT_COMMIT_HASH ?? process.env.GITHUB_SHA;
  if (provided && /^[a-f0-9]{7,40}$/i.test(provided)) return provided.slice(0, 7);
  try {
    return require("node:child_process")
      .execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" })
      .trim();
  } catch {
    return undefined;
  }
}

const eventWebsiteUrl = process.env.EXPO_PUBLIC_EVENT_WEBSITE_URL ?? "https://os.hackudc.com";
const isDevelopmentBuild = process.env.APP_VARIANT === "development";

/**
 * Boots a development build straight into a Metro bundle instead of stopping
 * at the dev launcher's server list. Only set for automated device runs
 * (`e2e/mobile`, see docs/ui-testing.md) — a launcher screen no test can tap
 * past would otherwise fail every Detox spec.
 */
const devClientDefaultLauncherUrl = process.env.DEV_CLIENT_DEFAULT_LAUNCHER_URL;

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const eventWebsiteHost = new URL(eventWebsiteUrl).hostname;
  const configuredGoogleServicesFile =
    process.env.GOOGLE_SERVICES_JSON ?? config.android?.googleServicesFile;
  // Local checkouts intentionally do not contain the Firebase file. Keep it
  // required when explicitly configured (CI/EAS or a developer download),
  // while allowing a local native build to run without push configuration.
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON
    ? configuredGoogleServicesFile
    : configuredGoogleServicesFile &&
        require("node:fs").existsSync(`${process.cwd()}/${configuredGoogleServicesFile}`)
      ? configuredGoogleServicesFile
      : undefined;

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      "expo-font",
      [
        "react-native-nfc-manager",
        {
          nfcPermission:
            "hackOS uses NFC to read participant badge serial numbers, link badges to participant accounts, record check-in, meal collection, and activity attendance, and link company tags so attendees can collect companies.",
          // #935: TAG only. Company-tag links are written through the iOS
          // tag-reader session (MifareIOS), which already exposes NDEF; App
          // Store Connect rejects the NDEF reader-session format (SDK 27).
          includeNdefEntitlement: false,
        },
      ],
      ["expo-navigation-bar", { enforceContrast: false }],
      "expo-secure-store",
      "expo-status-bar",
      "expo-web-browser",
      "./plugins/withAndroidResConfigs.js",
      "./plugins/withAndroidAppleTheme.js",
      "./plugins/withAndroidNfcTagClaim.js",
      "./plugins/withWidgetBundleVersion.js",
      // #935: company-tag links https://<event host>/s/<code> open the app.
      ["./plugins/withAndroidCompanyTagLinks.js", { host: eventWebsiteHost }],
    ],
    extra: { ...config.extra, buildCommit: buildCommit() },
    name: isDevelopmentBuild ? `${config.name} (Debug)` : config.name,
    ios: {
      ...config.ios,
      bundleIdentifier: isDevelopmentBuild
        ? `${config.ios?.bundleIdentifier}.debug`
        : config.ios?.bundleIdentifier,
      icon: isDevelopmentBuild ? "./assets/icon-ios-debug.icon" : config.ios?.icon,
      // applinks (#935): company-tag links /s/<code>, see the web AASA.
      associatedDomains: [`webcredentials:${eventWebsiteHost}`, `applinks:${eventWebsiteHost}`],
      ...(devClientDefaultLauncherUrl
        ? {
            infoPlist: {
              ...config.ios?.infoPlist,
              DEV_CLIENT_DEFAULT_LAUNCHER_URL: devClientDefaultLauncherUrl,
              // The dev-menu onboarding sheet and its floating action button
              // both render full-screen overlays that swallow taps, so no
              // spec can get past them.
              EXDevMenuIsOnboardingFinished: true,
              EXDevMenuShowFloatingActionButton: false,
              EXDevMenuShowsAtLaunch: false,
              // Detox's synthetic touches otherwise re-open the menu mid-spec.
              EXDevMenuTouchGestureEnabled: false,
              EXDevMenuMotionGestureEnabled: false,
            },
          }
        : {}),
    },
    android: {
      ...config.android,
      package: isDevelopmentBuild ? `${config.android?.package}.debug` : config.android?.package,
      googleServicesFile,
    },
  } as ExpoConfig;
}
