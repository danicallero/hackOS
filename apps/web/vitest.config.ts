import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const browserTests = [
  "src/**/*.test.tsx",
  "src/lib/nav.test.ts",
  "src/lib/privacy-removal.test.ts",
  "src/lib/url-tab.test.ts",
  "src/components/logistics/offline-queue.test.ts",
];

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: browserTests,
        },
      },
      {
        extends: true,
        test: { name: "browser", environment: "jsdom", include: browserTests },
      },
    ],
  },
});
