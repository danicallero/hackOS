import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    server: "src/server.ts",
    worker: "src/worker.ts",
    migrate: "scripts/migrate.ts",
    seed: "scripts/seed.ts",
  },
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  // workspace packages ship TS source; bundle them into the output
  noExternal: [/^@hackos\//],
});
