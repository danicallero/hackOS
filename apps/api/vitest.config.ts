import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    setupFiles: ["./test/setup.ts"],
    // DB-backed tests share one database; suites run sequentially so
    // truncation between tests can't race across files.
    fileParallelism: false,
    testTimeout: 15_000,
    // migrations.test.ts's afterAll opens a fresh admin connection and runs
    // DROP DATABASE ... WITH (FORCE) after ~90 other DB-backed suites have
    // run against the same Postgres instance; under a loaded CI runner that
    // occasionally doesn't clear 30s even though nothing is actually stuck
    // (H53 — two observed CI timeouts here on an otherwise-healthy run).
    hookTimeout: 60_000,
  },
});
