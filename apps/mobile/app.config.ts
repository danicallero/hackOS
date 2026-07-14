import type { ConfigContext, ExpoConfig } from "expo/config";

const eventWebsiteUrl = process.env.EXPO_PUBLIC_EVENT_WEBSITE_URL ?? "https://os.hackudc.com";

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const eventWebsiteHost = new URL(eventWebsiteUrl).hostname;

  return {
    ...config,
    ios: {
      ...config.ios,
      associatedDomains: [`webcredentials:${eventWebsiteHost}`],
    },
  } as ExpoConfig;
}
