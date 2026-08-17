#!/usr/bin/env node
import { readFileSync } from "node:fs";

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
 *
 * Resources live as i18next JSON under packages/shared/locales/{lng}/{ns}.json
 * (web, mobile, common, email — the last nested by template name, e.g.
 * mail.auth.verify.subject) since the i18next migration (H7); this walks
 * every string leaf across the three locale files per namespace.
 *
 */

const LANGS = ["en", "es", "gl"];
const NAMESPACES = ["common", "web", "mobile", "email"];
const LOCALES_DIR = "packages/shared/locales";

// Story identifiers (H7, H29-H40) and raw capability-key syntax (queue:admin).
const STORY_ID_RE = /\bH\d{1,3}(?:-H\d{1,3})?\b/;
const CAP_KEY_RE = /\b[a-z][a-z_]{2,}:[a-z][a-z_]{2,}\b/;

// Focused guards for the audited UI surfaces (H55). This is intentionally
// small and evidence-based: broad JSX-literal matching would flag technical
// values, test fixtures, and product names as copy. New user-facing variants
// on these surfaces should go through the locale resource files.
const RAW_COPY_GUARDS = [
  {
    file: "apps/web/src/app/(app)/challenges/builders.tsx",
    pattern: /placeholder\s*=\s*["']innovation["']/,
    message: "the field-key example must use i18n",
  },
  {
    file: "apps/web/src/app/(app)/settings/libraries/universities-manager.tsx",
    pattern: /placeholder\s*=\s*["']Universidade de Santiago de Compostela["']/,
    message: "the university example must use i18n",
  },
  {
    file: "apps/web/src/app/(app)/logistics/accreditation/page.tsx",
    pattern: /<SelectItem value=["'](?:qr|nfc)["']>\s*(?:QR|NFC)\s*<\//,
    message: "scanner method labels must use i18n",
  },
  {
    file: "apps/web/src/app/(app)/users/[id]/overview-tab.tsx",
    pattern: /(?:label\s*=\s*["']DNI["']|<FormLabel>DNI<\/)/,
    message: "identity labels must use i18n",
  },
];

// Short/technical strings that are legitimately identical across locales
// (product name, punctuation-only, numeric placeholders, URLs, etc.).
function isPlausiblyUntranslated(a, b, minLen) {
  if (a.length < minLen) return false;
  if (a !== b) return false;
  if (/^[\d\s.,:;!?%€$#{}()\-–—/]*$/.test(a)) return false; // punctuation/number-only
  if (/^https?:\/\//.test(a)) return false;
  if (/\{\{?[a-zA-Z]+\}?\}/.test(a) && a.replace(/\{\{?[a-zA-Z]+\}?\}/g, "").trim().length < minLen)
    return false;
  return true;
}

/** Flatten a (possibly nested, e.g. email.json's mail.auth.verify.subject) resource object to dot-path -> string. */
function flatten(obj, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[path] = value;
    } else if (value && typeof value === "object") {
      Object.assign(out, flatten(value, path));
    }
  }
  return out;
}

const failures = [];

for (const ns of NAMESPACES) {
  const flattened = {};
  for (const lang of LANGS) {
    const file = `${LOCALES_DIR}/${lang}/${ns}.json`;
    flattened[lang] = flatten(JSON.parse(readFileSync(file, "utf8")));
  }

  const allKeys = new Set(LANGS.flatMap((lang) => Object.keys(flattened[lang])));
  for (const key of allKeys) {
    const missing = LANGS.filter((lang) => !(key in flattened[lang]));
    if (missing.length > 0) {
      failures.push(`${ns}/${key}: missing locale(s): ${missing.join(", ")}`);
      continue;
    }

    const values = Object.fromEntries(LANGS.map((lang) => [lang, flattened[lang][key]]));
    for (const [locale, text] of Object.entries(values)) {
      if (STORY_ID_RE.test(text)) {
        failures.push(`${ns}/${key}.${locale} leaks a story identifier: ${JSON.stringify(text)}`);
      }
      if (CAP_KEY_RE.test(text)) {
        failures.push(`${ns}/${key}.${locale} leaks a raw capability key: ${JSON.stringify(text)}`);
      }
    }

    if (isPlausiblyUntranslated(values.en, values.es, 15)) {
      failures.push(
        `${ns}/${key} — es matches en verbatim (looks untranslated): ${JSON.stringify(values.en)}`,
      );
    }
    if (isPlausiblyUntranslated(values.en, values.gl, 15)) {
      failures.push(
        `${ns}/${key} — gl matches en verbatim (looks untranslated): ${JSON.stringify(values.en)}`,
      );
    }
  }
}

for (const guard of RAW_COPY_GUARDS) {
  const src = readFileSync(guard.file, "utf8");
  if (guard.pattern.test(src)) {
    failures.push(`${guard.file}: ${guard.message}`);
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
