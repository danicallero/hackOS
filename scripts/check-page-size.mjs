#!/usr/bin/env node
/**
 * Ratchet against page bloat (#288, #295): no `apps/web/src/app/**\/page.tsx`
 * may exceed HARD_LIMIT lines.
 *
 * This is a floor against rot, NOT the size to aim for. Three pages reached
 * 1900-2500 lines because nothing measured them; splitting them once without a
 * ratchet just means re-litigating it in six months. The number where human
 * judgement should kick in is ADVISORY (~600) and lives in apps/web/README.md's
 * "Page structure" section — this script deliberately does not enforce it,
 * because a dogmatic check produces five files of 599 lines, which is worse
 * than what we have now.
 *
 * There is no allowlist by design: if a page genuinely cannot come under the
 * limit, that is a signal the limit is wrong, not that the file is special.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "apps/web/src/app";
const HARD_LIMIT = 950;
const ADVISORY = 600;

/** Every page.tsx under the App Router tree, route groups and all. */
function findPages(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findPages(path));
    else if (entry.name === "page.tsx") found.push(path);
  }
  return found;
}

const pages = findPages(ROOT)
  .map((file) => ({ file, lines: readFileSync(file, "utf8").split("\n").length }))
  .sort((a, b) => b.lines - a.lines);

const offenders = pages.filter((p) => p.lines > HARD_LIMIT);

if (offenders.length > 0) {
  console.error(`check-page-size: ${offenders.length} page(s) past the ${HARD_LIMIT}-line limit\n`);
  const width = String(offenders[0].lines).length;
  for (const { file, lines } of offenders) {
    console.error(`  - ${String(lines).padStart(width)} lines  ${file}`);
  }
  console.error(
    `\nThese pages are past the size where a page.tsx should have become a directory.\n` +
      `See "Page structure" in apps/web/README.md: split by parts that are independently\n` +
      `meaningful — a tab with its own state, a modal with its own form, a decision rule\n` +
      `worth testing on its own — and leave cohesive sections alone. Extracting single-use\n` +
      `fragments, or anything that needs props threaded through to survive the move, makes\n` +
      `the page harder to read, not easier.\n\n` +
      `The ${HARD_LIMIT}-line limit is a floor against rot, not a target: ~${ADVISORY} lines is\n` +
      `where it's worth stopping to look. Reference splits: app/(app)/users/[id]/ and\n` +
      `app/(app)/judging/.`,
  );
  process.exit(1);
}

const largest = pages[0];
console.log(
  `check-page-size: ${pages.length} page.tsx files, largest ${largest.lines} lines ` +
    `(${largest.file}) — all within the ${HARD_LIMIT}-line limit.`,
);
