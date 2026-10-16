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
// #1016 owns secondary-email removal. Pin exact path/key/value digests; no new legacy copy is allowed.
const secondaryEmailExceptions = new Map([
  [
    "packages/shared/locales/en/web.json:devpostEmailPlaceholder",
    "bcd36deb6e3c2209f531dea626be7c5af297b5bc96a634f59ffc2dc91e8d3aa2",
  ],
  [
    "packages/shared/locales/en/web.json:willUseToMatchDevpost",
    "ef9b19feaa6613bbdd3b9e3905a20a5837c6a399d983bf6a327dbd5ba752a1b8",
  ],
  [
    "packages/shared/locales/en/email.json:mail.auth.verifySecondaryEmail.body",
    "0d9fec62d1ade0b328d2c76629a09ffce61e3e9e38603eb060d75195de624241",
  ],
  [
    "packages/shared/locales/es/web.json:devpostEmailPlaceholder",
    "9ca9791d4d64c823bf62a54f5352faf8697ad6b9502ef29c1493556c210b8687",
  ],
  [
    "packages/shared/locales/es/web.json:willUseToMatchDevpost",
    "f9d072bbe931273e456a8cdb760d076a55476c443f38e6cbcae57e1a2f9c69b8",
  ],
  [
    "packages/shared/locales/es/email.json:mail.auth.verifySecondaryEmail.body",
    "9ca463279f668c3c6815d533c4e2658c29018a3e3a7588a195ab62e7f1996684",
  ],
  [
    "packages/shared/locales/gl/web.json:devpostEmailPlaceholder",
    "5985bdfe53539f9f96c5cf49659561299c4f2c9c766dc23312e5bd4e09218359",
  ],
  [
    "packages/shared/locales/gl/web.json:willUseToMatchDevpost",
    "531275b1e9f192e8fcd2a52792dd370fd9c6175ea89de9bbc6ad2d6f87e0fe1b",
  ],
  [
    "packages/shared/locales/gl/email.json:mail.auth.verifySecondaryEmail.body",
    "804caa3ae72894d2c39a9c1c12a1cba615cd1071eae29f6e703dea69afb30a4f",
  ],
]);
const projectExtensions = new Set([...sourceExtensions, ".json", ".swift", ".kt"]);
function checkProjectFile(path) {
  const file = relative(repoRoot, path);
  let contents = readFileSync(path, "utf8");
  if (path.endsWith(".json")) {
    const stripExceptions = (value, keyPath = "") => {
      if (typeof value === "string") {
        const expected = secondaryEmailExceptions.get(`${file}:${keyPath}`);
        return expected && createHash("sha256").update(value).digest("hex") === expected
          ? undefined
          : value;
      }
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => {
            const nextPath = keyPath ? `${keyPath}.${key}` : key;
            const stripped = stripExceptions(item, nextPath);
            return [stripped === undefined ? "" : key, stripped ?? ""];
          }),
        );
      }
      return value;
    };
    contents = JSON.stringify(stripExceptions(JSON.parse(contents)));
  }
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
