import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const runtimeRoots = ["apps/api/src", "apps/api/scripts", "apps/web/src", "apps/mobile"].map(
  (path) => resolve(repoRoot, path),
);
const forbidden = [
  "manual_attendee_roles",
  "capability_grant_quarantine",
  "legacy:event-access",
  "/api/permission-groups",
  "/api/permission-group-templates",
];
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "assets" || entry === "node_modules" || entry === "test") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!sourceExtensions.has(path.slice(path.lastIndexOf(".")))) continue;
    const contents = readFileSync(path, "utf8");
    for (const token of forbidden) {
      if (contents.includes(token)) {
        violations.push(
          `${relative(repoRoot, path)} contains retired authorization token ${token}`,
        );
      }
    }
  }
}

for (const root of runtimeRoots) walk(root);

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("retired authorization guard: clean");
}
