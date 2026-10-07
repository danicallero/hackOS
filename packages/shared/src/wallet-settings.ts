/** Runtime Wallet customization (H28). Artwork is served by hackOS, not baked into deployments. */
export const WALLET_ARTWORK_SLOTS = [
  "appleIcon",
  "appleLogo",
  "appleStrip",
  "appleBackground",
  "appleThumbnail",
  "appleFooter",
  "googleLogo",
  "googleWideLogo",
  "googleHero",
  "googleDetail",
] as const;
export type WalletArtworkSlot = (typeof WALLET_ARTWORK_SLOTS)[number];
export type WalletArtworkScale = 1 | 2 | 3;
export interface WalletArtworkImage {
  url: string;
  variants: Partial<Record<WalletArtworkScale, string>>;
}
export const WALLET_ARTWORK_DIMENSIONS: Record<
  WalletArtworkSlot,
  { width: number; height: number }
> = {
  appleIcon: { width: 29, height: 29 },
  appleLogo: { width: 160, height: 50 },
  appleStrip: { width: 375, height: 98 },
  appleBackground: { width: 180, height: 220 },
  appleThumbnail: { width: 90, height: 90 },
  appleFooter: { width: 286, height: 15 },
  googleDetail: { width: 1032, height: 336 },
  googleLogo: { width: 660, height: 660 },
  googleWideLogo: { width: 1280, height: 400 },
  googleHero: { width: 1032, height: 336 },
};
export interface WalletSettings {
  backgroundColor: string;
  foregroundColor: string;
  labelColor: string;
  websiteUrl: string;
  showDirections: boolean;
  showSchedule: boolean;
  scheduleUrl: string;
  appleAppStoreId: number | null;
  androidPackageName: string;
  androidStoreUrl: string;
  appleOptions: Record<string, unknown>;
  googleClassOptions: Record<string, unknown>;
  googleObjectOptions: Record<string, unknown>;
  artwork: Partial<Record<WalletArtworkSlot, WalletArtworkImage & { id: string }>>;
  artworkDefaults: Partial<Record<WalletArtworkSlot, WalletArtworkImage>>;
}
export type WalletAlert = Record<"es" | "gl" | "en", { title: string; body: string }>;
export const WALLET_ACTION_LABELS = {
  en: {
    directions: "Get directions",
    schedule: "View schedule",
    website: "Open hackOS",
    alert: "Event alert",
  },
  es: {
    directions: "Cómo llegar",
    schedule: "Ver programa",
    website: "Abrir hackOS",
    alert: "Aviso del evento",
  },
  gl: {
    directions: "Como chegar",
    schedule: "Ver programa",
    website: "Abrir hackOS",
    alert: "Aviso do evento",
  },
} as const;
