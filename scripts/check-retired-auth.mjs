import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(process.argv[2] ?? resolve(import.meta.dirname, ".."));
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

for (const root of runtimeRoots) if (existsSync(root)) walk(root);

// #1005: source/tests/locales are current runtime vocabulary, unlike immutable SQL history.
const projectRoots = [
  "apps/api/src",
  "apps/api/scripts",
  "apps/api/test",
  "apps/web/src",
  "apps/mobile",
  "packages/shared",
  "scripts",
];
const projectTokens =
  /devpost|project[ /_-]+import|imported (?:project|participant|email)|apiError_project_locked|import operators|teamDetailLinkHint|projects:import|PROJECTS_IMPORT|\/api\/projects\/imports|projectReconciliation|projectPossibleTeamSize|projectResolveIdentities|projectIdentityReview|projectParticipantsDiffer|projectUseInternal|projectLinkConsequences|provideBothCsvExports|importDeniedDesc|resolveImports/gi;
const projectExtensions = new Set([...sourceExtensions, ".json", ".swift", ".kt"]);
function checkProjectFile(path) {
  const file = relative(repoRoot, path);
  const contents = readFileSync(path, "utf8");
  const matches = [...new Set(contents.match(projectTokens) ?? [])];
  for (const token of matches) violations.push(`${file} contains retired project token ${token}`);
}
function walkProjects(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (
      [
        "node_modules",
        "dist",
        ".next",
        ".expo",
        "build",
        "assets",
        "coverage",
        "Pods",
        ".git",
      ].includes(entry)
    )
      continue;
    const path = join(dir, entry);
    const file = relative(repoRoot, path);
    // These files define and exercise the guard's forbidden vocabulary.
    if (["scripts/check-retired-auth.mjs", "scripts/check-retired-auth.test.mjs"].includes(file))
      continue;
    if (statSync(path).isDirectory()) walkProjects(path);
    else if (projectExtensions.has(path.slice(path.lastIndexOf(".")))) checkProjectFile(path);
  }
}
for (const root of projectRoots) walkProjects(resolve(repoRoot, root));

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("retired authorization guard: clean");
}
