/**
 * Base URL of the hackOS API. Expo only exposes env vars prefixed
 * `EXPO_PUBLIC_` to client code (mirrors `apps/web`'s `NEXT_PUBLIC_API_URL`
 * convention) — set it in `.env` or the EAS build profile. Production is the
 * safe default for installed builds; local development must opt into a local
 * URL explicitly.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://api.hackudc.com";
