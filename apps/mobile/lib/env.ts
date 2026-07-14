/**
 * Base URL of the hackOS API. Expo only exposes env vars prefixed
 * `EXPO_PUBLIC_` to client code (mirrors `apps/web`'s `NEXT_PUBLIC_API_URL`
 * convention) — set it in `.env` or the EAS build profile.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
