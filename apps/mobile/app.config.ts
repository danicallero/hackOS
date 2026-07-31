import type { ConfigContext, ExpoConfig } from "expo/config";

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

  return {
    ...config,
    name: isDevelopmentBuild ? `${config.name} (Debug)` : config.name,
    ios: {
      ...config.ios,
      bundleIdentifier: isDevelopmentBuild
        ? `${config.ios?.bundleIdentifier}.debug`
        : config.ios?.bundleIdentifier,
      icon: isDevelopmentBuild ? "./assets/icon-ios-debug.icon" : config.ios?.icon,
      associatedDomains: [`webcredentials:${eventWebsiteHost}`],
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
    },
  } as ExpoConfig;
}
