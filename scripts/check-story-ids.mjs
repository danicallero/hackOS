#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const PLAN_FILE = "plan/historias-hackos.md";
const ROOTS = ["apps", "packages", "docs"];
const SKIP_DIRS = new Set([
  ".expo",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "migration-history",
  "node_modules",
]);

const plan = readFileSync(PLAN_FILE, "utf8");
const storyNumbers = [...plan.matchAll(/^\*\*H(\d+)\./gm)].map((match) => Number(match[1]));
if (storyNumbers.length === 0) {
  console.error(`No story headings found in ${PLAN_FILE}`);
  process.exit(1);
}
const latestStory = Math.max(...storyNumbers);
const failures = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;

    const file = join(dir, entry.name);
    const bytes = readFileSync(file);
    if (bytes.includes(0)) continue;

    const contents = bytes.toString("utf8");
    const storyId = /\bH(\d+)\b/g;
    for (const match of contents.matchAll(storyId)) {
      const number = Number(match[1]);
      if (number <= latestStory) continue;
      const line = contents.slice(0, match.index).split("\n").length;
      failures.push(
        `${relative(".", file)}:${line}: H${number} exceeds the latest story H${latestStory}; use the issue number with #`,
      );
    }
  }
}

for (const root of ROOTS) walk(root);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Story references are at or below H${latestStory}.`);
