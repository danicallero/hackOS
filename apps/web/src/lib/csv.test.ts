import { describe, expect, it } from "vitest";
import { buildCsv, csvField } from "./csv";

describe("csvField", () => {
  it("leaves plain text alone", () => {
    expect(csvField("Opening ceremony")).toBe("Opening ceremony");
  });

  it("quotes commas, quotes and newlines, doubling inner quotes", () => {
    expect(csvField("a, b")).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("neutralizes spreadsheet formulas", () => {
    expect(csvField("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvField("@cmd")).toBe("'@cmd");
    expect(csvField("+1")).toBe("'+1");
    expect(csvField('=1,"x"')).toBe('"\'=1,""x"""');
  });
});

describe("buildCsv", () => {
  it("starts with a UTF-8 BOM and uses CRLF rows", () => {
    const csv = buildCsv([
      ["Título", "Notas"],
      ["Café", "a,b"],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe('﻿Título,Notas\r\nCafé,"a,b"\r\n');
  });
});
