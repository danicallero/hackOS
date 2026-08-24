#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

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
 * It also cross-checks call sites: every static t("...") key referenced from
 * apps/web/src or apps/mobile must resolve in that app's namespace-fallback
 * chain (web -> common, mobile -> common), catching typos and wrong-namespace
 * keys that the internal-consistency check above can't see (H459).
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
    file: "apps/web/src/components/common/questionnaire-builder.tsx",
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
const namespaceKeys = {};

for (const ns of NAMESPACES) {
  const flattened = {};
  for (const lang of LANGS) {
    const file = `${LOCALES_DIR}/${lang}/${ns}.json`;
    flattened[lang] = flatten(JSON.parse(readFileSync(file, "utf8")));
  }

  const allKeys = new Set(LANGS.flatMap((lang) => Object.keys(flattened[lang])));
  namespaceKeys[ns] = allKeys;
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

// Cross-check t("...") call sites against the resolved namespace-fallback
// chain per app: web -> common for apps/web, mobile -> common for
// apps/mobile (see apps/web/src/lib/i18n.ts and apps/mobile/lib/i18n.tsx).
// Catches typos/wrong-namespace keys that pass the internal-consistency
// check above but only fail at runtime as a raw key literal (H459).
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".expo",
  "dist",
  "build",
  "coverage",
  ".turbo",
]);
const SOURCE_EXTS = new Set([".ts", ".tsx"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, out);
    else if (SOURCE_EXTS.has(extname(entry))) out.push(path);
  }
  return out;
}

/** Advance past a quoted string literal starting at src[i] (the opening quote), honoring backslash escapes. */
function skipString(src, i, quote) {
  i++;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === quote) return i + 1;
    i++;
  }
  return i;
}

/** Find every `t(...)` call site and return its raw argument text (balanced on parens/strings). */
function findTCalls(src) {
  const calls = [];
  const re = /\bt\(/g;
  let m = re.exec(src);
  while (m) {
    const start = re.lastIndex;
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      else if (c === '"' || c === "'" || c === "`") {
        i = skipString(src, i, c);
        continue;
      }
      i++;
    }
    calls.push({
      argsText: src.slice(start, i - 1),
      line: src.slice(0, m.index).split("\n").length,
    });
    m = re.exec(src);
  }
  return calls;
}

const COMPARISON_OPS = ["===", "!==", "==", "!="];

/**
 * Static string-literal keys a t(...) call could resolve to at its first
 * argument position: the whole argument, or a top-level ternary/`??`
 * branch. Skips: everything past the first top-level comma (values-object
 * literals aren't keys), anything nested inside another call/array/object
 * (e.g. an options bag or a `.slice("...")` argument), literals adjacent to
 * an equality operator (a ternary *condition*, not a branch), and template
 * literals with interpolation (can't be resolved statically).
 */
function firstArgLiteralKeys(argsText) {
  let depth = 0;
  let firstArgEnd = argsText.length;
  for (let i = 0; i < argsText.length; i++) {
    const c = argsText[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === '"' || c === "'" || c === "`") {
      i = skipString(argsText, i, c) - 1;
    } else if (c === "," && depth === 0) {
      firstArgEnd = i;
      break;
    }
  }
  const firstArg = argsText.slice(0, firstArgEnd);

  const keys = [];
  depth = 0;
  let i = 0;
  while (i < firstArg.length) {
    const c = firstArg[i];
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      i++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
      i++;
    } else if (c === '"' || c === "'" || c === "`") {
      const end = skipString(firstArg, i, c);
      if (depth === 0) {
        const before = firstArg.slice(0, i).trimEnd();
        const after = firstArg.slice(end).trimStart();
        const isComparison =
          COMPARISON_OPS.some((op) => before.endsWith(op)) ||
          COMPARISON_OPS.some((op) => after.startsWith(op));
        const isTemplate = c === "`";
        const value = firstArg.slice(i + 1, end - 1);
        if (!isComparison && !(isTemplate && value.includes("${")) && value.length > 0) {
          keys.push(value);
        }
      }
      i = end;
    } else {
      i++;
    }
  }
  return keys;
}

const CALL_SITE_SOURCES = [
  { dir: "apps/web/src", resolvable: new Set([...namespaceKeys.web, ...namespaceKeys.common]) },
  { dir: "apps/mobile", resolvable: new Set([...namespaceKeys.mobile, ...namespaceKeys.common]) },
];

for (const { dir, resolvable } of CALL_SITE_SOURCES) {
  for (const file of walk(dir)) {
    const src = readFileSync(file, "utf8");
    for (const { argsText, line } of findTCalls(src)) {
      for (const key of firstArgLiteralKeys(argsText)) {
        if (!resolvable.has(key)) {
          failures.push(
            `${file}:${line}: t("${key}") does not resolve to any known translation key`,
          );
        }
      }
    }
  }
}

// Schedule/activity categories (H26, H48, H51) live in one registry —
// packages/shared/src/activity-kinds.ts — and their labels are looked up with
// *derived* keys (`type<Pascal>` in common, `kind<Pascal>` in web), which the
// static t("...") scan above can't see. This is the net that keeps adding a
// category honest: the three locales must exist before the category ships.
const KIND_REGISTRY = "packages/shared/src/activity-kinds.ts";
const registrySrc = readFileSync(KIND_REGISTRY, "utf8");
const registryBody = registrySrc.slice(
  registrySrc.indexOf("const KINDS = {"),
  registrySrc.indexOf("} as const satisfies"),
);
const kinds = [...registryBody.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9_]*):\s*\{/gm)].map((m) => m[1]);
if (kinds.length === 0) {
  failures.push(`${KIND_REGISTRY}: could not read any activity kinds — did the registry move?`);
}
for (const kind of kinds) {
  const pascal = kind.charAt(0).toUpperCase() + kind.slice(1);
  for (const [ns, key] of [
    ["common", `type${pascal}`],
    ["web", `kind${pascal}`],
  ]) {
    if (!namespaceKeys[ns].has(key)) {
      failures.push(
        `${KIND_REGISTRY}: activity kind "${kind}" has no ${ns}/${key} translation ` +
          `(every category needs a singular common/type* and a plural web/kind* label)`,
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
