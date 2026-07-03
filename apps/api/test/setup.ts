/**
 * Per-worker test env. Runs before any application import, so config.ts
 * picks these up. Import app code lazily inside tests/helpers, never at the
 * top of this file.
 */
import { TEST_DATABASE_URL } from "./test-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.WORKERS_INLINE = "false";
