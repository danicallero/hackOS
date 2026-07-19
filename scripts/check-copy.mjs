#!/usr/bin/env node
/**
 * Lightweight guard for the H196 copy rules (docs/DESIGN.md §10):
 * every i18n entry has all three locales, and no entry leaks story
 * identifiers or raw capability-key syntax into user-facing copy.
 *
 * TypeScript already enforces the `{ es, gl, en }` shape at compile time for
 * well-formed dict entries; this script is the cheap net for the things the
 * compiler can't see (identical/untranslated fallbacks, banned patterns) and
 * runs without a full typecheck, so it's cheap to wire into `pnpm lint` or a
 * pre-push hook.
 */
import { readFileSync } from "node:fs";

const TARGETS = [
  { file: "apps/web/src/lib/i18n.ts", lang: "web" },
  { file: "apps/mobile/lib/i18n.tsx", lang: "mobile" },
];

// key: { es: "...", gl: "...", en: "..." } in any order, single- or multi-line.
const ENTRY_RE =
  /(?<key>[A-Za-z_$][\w$]*)\s*:\s*\{\s*(?<body>(?:[a-z]{2}\s*:\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)\s*,?\s*){2,3})\}/gs;
const LOCALE_RE =
  /(?<locale>en|es|gl)\s*:\s*(?:"(?<dq>(?:[^"\\]|\\.)*)"|'(?<sq>(?:[^'\\]|\\.)*)'|`(?<bq>(?:[^`\\]|\\.)*)`)/g;

// Story identifiers (H7, H29-H40) and raw capability-key syntax (queue:admin).
const STORY_ID_RE = /\bH\d{1,3}(?:-H\d{1,3})?\b/;
const CAP_KEY_RE = /\b[a-z][a-z_]{2,}:[a-z][a-z_]{2,}\b/;

// Short/technical strings that are legitimately identical across locales
// (product name, punctuation-only, numeric placeholders, URLs, etc.).
function isPlausiblyUntranslated(a, b, minLen) {
  if (a.length < minLen) return false;
  if (a !== b) return false;
  if (/^[\d\s.,:;!?%€$#{}()\-–—/]*$/.test(a)) return false; // punctuation/number-only
  if (/^https?:\/\//.test(a)) return false;
  if (/\{[a-zA-Z]+\}/.test(a) && a.replace(/\{[a-zA-Z]+\}/g, "").trim().length < minLen)
    return false;
  return true;
}

const failures = [];

for (const { file } of TARGETS) {
  const src = readFileSync(file, "utf8");
  for (const entryMatch of src.matchAll(ENTRY_RE)) {
    const key = entryMatch.groups.key;
    const body = entryMatch.groups.body;
    const values = {};
    for (const localeMatch of body.matchAll(LOCALE_RE)) {
      const { locale, dq, sq, bq } = localeMatch.groups;
      values[locale] = dq ?? sq ?? bq ?? "";
    }

    const missing = ["en", "es", "gl"].filter((l) => !(l in values));
    if (missing.length > 0) {
      failures.push(`${file}: "${key}" is missing locale(s): ${missing.join(", ")}`);
      continue;
    }

    for (const [locale, text] of Object.entries(values)) {
      if (STORY_ID_RE.test(text)) {
        failures.push(
          `${file}: "${key}".${locale} leaks a story identifier: ${JSON.stringify(text)}`,
        );
      }
      if (CAP_KEY_RE.test(text)) {
        failures.push(
          `${file}: "${key}".${locale} leaks a raw capability key: ${JSON.stringify(text)}`,
        );
      }
    }

    if (isPlausiblyUntranslated(values.en, values.es, 15)) {
      failures.push(
        `${file}: "${key}" — es matches en verbatim (looks untranslated): ${JSON.stringify(values.en)}`,
      );
    }
    if (isPlausiblyUntranslated(values.en, values.gl, 15)) {
      failures.push(
        `${file}: "${key}" — gl matches en verbatim (looks untranslated): ${JSON.stringify(values.en)}`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`check-copy: ${failures.length} issue(s) found\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nSee docs/DESIGN.md §10 (copy rules) and CLAUDE.md's Non-negotiable conventions.\n" +
      "Story identifiers and capability keys belong in code comments, never in user-facing copy.\n" +
      "Every changed i18n key needs real Spanish, Galician, and English text (not a copy of another locale).",
  );
  process.exit(1);
}

console.log(
  "check-copy: all i18n entries have es/gl/en and no leaked story IDs or capability keys.",
);
