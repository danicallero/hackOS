import type { ConfigContext, ExpoConfig } from "expo/config";

const eventWebsiteUrl = process.env.EXPO_PUBLIC_EVENT_WEBSITE_URL ?? "https://os.hackudc.com";
const isDevelopmentBuild = process.env.APP_VARIANT === "development";

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
    },
    android: {
      ...config.android,
      package: isDevelopmentBuild ? `${config.android?.package}.debug` : config.android?.package,
    },
  } as ExpoConfig;
}
