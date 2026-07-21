#!/usr/bin/env node
/**
 * Page-size ratchet for the web app (see apps/web/README.md § "Page structure").
 *
 * Three `page.tsx` files reached 1900-2500 lines before anyone noticed, because
 * nothing measured it. This is the cheap net that keeps that from recurring.
 *
 * Two tiers, on purpose:
 *
 *   HARD  (fails)  no page may exceed HARD_LIMIT. This is a ratchet, not a
 *                  target: it sits just above today's largest page, so nothing
 *                  can get worse than the worst thing currently in the tree.
 *                  Lower it as pages shrink.
 *
 *   SOFT  (prints) pages past SOFT_LIMIT are listed but do not fail. The
 *                  convention's trigger is *meaning*, not length — a route
 *                  whose sections only make sense together is allowed to be
 *                  long, and mechanically shredding it into eight files that
 *                  each need six props threaded in is worse than leaving it.
 *                  So this tier informs; a human decides.
 *
 * Deliberately no allowlist. A file that "has to" be exempt means the limit is
 * wrong — change the number, don't special-case the file, or the list becomes
 * a dumping ground and the guard stops meaning anything.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "apps/web/src/app";
const HARD_LIMIT = 950;
const SOFT_LIMIT = 600;

/** Every `page.tsx` under the app router, depth-first. */
function pageFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...pageFiles(path));
    else if (entry === "page.tsx") out.push(path);
  }
  return out;
}

const pages = pageFiles(ROOT)
  .map((file) => ({ file, lines: readFileSync(file, "utf8").split("\n").length }))
  .sort((a, b) => b.lines - a.lines);

const over = pages.filter((p) => p.lines > HARD_LIMIT);
const large = pages.filter((p) => p.lines > SOFT_LIMIT && p.lines <= HARD_LIMIT);

if (large.length > 0) {
  console.log(
    `check-page-size: ${large.length} page(s) past ${SOFT_LIMIT} lines — worth a look, not a failure:`,
  );
  for (const { file, lines } of large) console.log(`  - ${file} (${lines})`);
  console.log(
    "  Split only if the page holds independently meaningful parts (a tab with its own\n" +
      "  save cycle, a modal with its own form, a rule worth testing without rendering).\n" +
      "  See apps/web/README.md § Page structure.\n",
  );
}

if (over.length > 0) {
  console.error(`check-page-size: ${over.length} page(s) over the ${HARD_LIMIT}-line limit\n`);
  for (const { file, lines } of over) console.error(`  - ${file} (${lines})`);
  console.error(
    `\nThis limit is a ratchet: it sits just above the largest page that existed when it\n` +
      `was introduced, so pages can only get smaller. Extract the parts that are\n` +
      `independently meaningful — see apps/web/README.md § Page structure for what goes\n` +
      `where, and prefer moving decision logic into a tested sibling module first.\n`,
  );
  process.exit(1);
}

console.log(
  `check-page-size: ${pages.length} pages, largest ${pages[0]?.lines ?? 0} lines (limit ${HARD_LIMIT}).`,
);
