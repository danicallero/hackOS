// Design-token ratchet for apps/mobile (H55, H59): raw hex colours, font sizes
// and radii may not grow past the per-file baseline in
// scripts/mobile-token-baseline.json. Migrating a file to `@/theme` lowers its
// count; run with --update to record the lower numbers. docs/DESIGN.md §12.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../apps/mobile/", import.meta.url).pathname;
const baselinePath = new URL("./mobile-token-baseline.json", import.meta.url).pathname;
const rules = {
  hex: /["']#[0-9a-fA-F]{3,8}["']/g,
  fontSize: /fontSize: \d/g,
  radius: /[rR]adius: \d/g,
};

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) yield path;
  }
}

const counts = {};
for (const dir of ["app", "components", "lib"]) {
  for (const file of walk(join(root, dir))) {
    const text = readFileSync(file, "utf8");
    const entry = Object.fromEntries(
      Object.entries(rules).map(([key, re]) => [key, (text.match(re) ?? []).length]),
    );
    if (Object.values(entry).some(Boolean)) counts[relative(root, file)] = entry;
  }
}

if (process.argv.includes("--update")) {
  writeFileSync(baselinePath, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`Baseline written for ${Object.keys(counts).length} files.`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const failures = [];
for (const [file, entry] of Object.entries(counts)) {
  for (const key of Object.keys(rules)) {
    const allowed = baseline[file]?.[key] ?? 0;
    if (entry[key] > allowed) {
      failures.push(`${file}: ${entry[key]} raw ${key} (baseline ${allowed})`);
    }
  }
}
if (failures.length) {
  console.error(
    `Raw design values in apps/mobile; use @/theme tokens (docs/DESIGN.md §12):\n${failures.join("\n")}`,
  );
  process.exit(1);
}
console.log("Mobile design tokens: no new raw values.");
