import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The RSVP strings live in fragments until the integration step merges them
 * into web.json. They must stay trilingual, with the same placeholders.
 */
function load(lang: string): Record<string, string> {
  return JSON.parse(
    readFileSync(join(process.cwd(), "locale-fragments", `catering-rsvp.${lang}.json`), "utf8"),
  );
}

describe("catering RSVP locale fragments", () => {
  const en = load("en");
  it.each(["es", "gl"])("%s has exactly the English keys and placeholders", (lang) => {
    const other = load(lang);
    expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(other[key]?.trim(), key).not.toBe("");
      const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(placeholders(other[key]), key).toEqual(placeholders(en[key]));
    }
  });
});
