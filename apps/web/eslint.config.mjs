import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Official wallet badge/button artwork: must render as the exact source
    // asset, never re-processed by next/image. Mirrors the biome-ignore
    // already on these <img> elements — ESLint and biome can't both hold a
    // suppression comment on the same JSX line, so this rule is scoped off
    // for the file instead.
    files: ["src/components/common/wallet-buttons.tsx"],
    rules: { "@next/next/no-img-element": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
