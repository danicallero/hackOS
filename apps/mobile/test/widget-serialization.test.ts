/// <reference types="node" />
/**
 * #1171: a widget layout is serialized to a string for the extension, and a
 * regex literal loses its backslashes on the way (`/\s+/` became `/s+/`, so
 * "Room B" was never split and the compact island showed "Roo"). Layouts must
 * not contain regex literals.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WIDGETS = join(__dirname, "..", "widgets");
const REGEX_LITERAL = /(?:[=(,:]|return)\s*\/(?![/*])(?:\\.|[^/\n\\])+\/[a-z]*\s*[.;),]/;

describe("widget layouts", () => {
  it("contain no regex literals", () => {
    const offenders = readdirSync(WIDGETS)
      .filter((name) => name.endsWith(".tsx"))
      .filter((name) =>
        readFileSync(join(WIDGETS, name), "utf8")
          .split("\n")
          .some((line) => !line.trim().startsWith("//") && REGEX_LITERAL.test(line)),
      );
    expect(offenders).toEqual([]);
  });
});
