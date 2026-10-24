/**
 * #1083: certificates use a flush-isolated Valkey DB, like the other domain suites.
 * This must be the first import, before config.ts reads VALKEY_URL.
 */
process.env.VALKEY_URL = process.env.TEST_VALKEY_URL ?? "redis://localhost:6379/4";
