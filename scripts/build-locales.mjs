#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
/**
 * Regenerates packages/shared/locales/{lng}/web.json from its commented
 * .jsonc source in packages/shared/locales-src/. web is the only namespace
 * with a .jsonc source — its section headers reflect real, coherent
 * groupings from the original dict. common.json's 57 keys are scattered
 * fragments pulled from many different original sections, so labeling them
 * with wherever they happened to sit in the full web dict is misleading,
 * not helpful — it stays plain JSON, like mobile.json/email.json, all
 * edited directly with no generated-file step.
 *
 * web.json is the runtime file apps/web and apps/mobile actually import
 * (plain JSON — neither Next.js nor Metro support importing .jsonc
 * directly). Run this after editing the .jsonc source; scripts/check-copy.mjs
 * fails the build if the generated .json ever drifts from it.
 */
import { parse } from "jsonc-parser";

const LANGS = ["en", "es", "gl"];
const NAMESPACES = ["web"];

for (const lang of LANGS) {
  for (const ns of NAMESPACES) {
    const srcPath = `packages/shared/locales-src/${lang}/${ns}.jsonc`;
    const outPath = `packages/shared/locales/${lang}/${ns}.json`;
    const data = parse(readFileSync(srcPath, "utf8"));
    writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
  }
}

console.log("build-locales: regenerated web.json from its .jsonc source.");
