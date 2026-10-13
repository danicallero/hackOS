import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * UI code must never render `ApiError.message` (English server copy, #1013).
 * Resolve the reason with `apiErrorText` / `apiErrorCopy` instead
 * (apps/web/src/lib/api-error-text.ts, apps/mobile/lib/api-error-reason.ts).
 */
const repoRoot = resolve(import.meta.dirname, "..");
const roots = ["apps/web/src", "apps/mobile"].map((path) => resolve(repoRoot, path));
const exts = new Set([".ts", ".tsx"]);
const forbidden = /instanceof ApiError\s*\?\s*[\w.]+\.message\b/;
const skipDirs = new Set(["node_modules", "test", "assets", ".expo", "ios", "android"]);
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (skipDirs.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!exts.has(path.slice(path.lastIndexOf("."))) || /\.test\.tsx?$/.test(path)) continue;
    const match = forbidden.exec(readFileSync(path, "utf8"));
    if (match) violations.push(relative(repoRoot, path));
  }
}

for (const root of roots) walk(root);

if (violations.length > 0) {
  console.error(
    `check-api-error-messages: UI renders ApiError.message in:\n  ${violations.join("\n  ")}\nUse apiErrorText(err, t, fallback) instead.`,
  );
  process.exit(1);
}
console.log("check-api-error-messages: clean.");
