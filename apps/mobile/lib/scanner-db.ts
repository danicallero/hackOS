// TypeScript/Node resolution fallback. Metro selects scanner-db.native.ts on
// iOS/Android and scanner-db.web.ts for static web bundles.
export * from "./scanner-db.native";
