import { describe, expect, it } from "vitest";
import { EMAIL_MAX_LENGTH, isSimpleEmail, isSimpleUrl, URL_MAX_LENGTH } from "./forms.js";

describe("text condition shapes (#1110)", () => {
  it("accepts a local@domain email and rejects malformed ones", () => {
    expect(isSimpleEmail("hi@example.com")).toBe(true);
    expect(isSimpleEmail("a@b.c")).toBe(true);
    for (const value of ["not-an-email", "a@b", "a@.b", "a@b.", "@b.c", "a@@b.c", "a b@c.d"]) {
      expect(isSimpleEmail(value)).toBe(false);
    }
  });

  it("accepts domain-shaped URLs with or without a scheme", () => {
    for (const value of ["example.org", "https://example.org/a?b#c", "HTTP://a.bc"]) {
      expect(isSimpleUrl(value)).toBe(true);
    }
    for (const value of ["not-a-url", "https://example", ".example.org", "a.b", "a .bc", "/x.yz"]) {
      expect(isSimpleUrl(value)).toBe(false);
    }
  });

  it("caps length before matching", () => {
    const email = `${"a".repeat(EMAIL_MAX_LENGTH - "@b.co".length)}@b.co`;
    expect(isSimpleEmail(email)).toBe(true);
    expect(isSimpleEmail(`a${email}`)).toBe(false);
    const url = `https://example.org/${"a".repeat(URL_MAX_LENGTH - "https://example.org/".length)}`;
    expect(isSimpleUrl(url)).toBe(true);
    expect(isSimpleUrl(`${url}a`)).toBe(false);
  });

  it("rejects a 100k-character answer quickly", () => {
    const started = performance.now();
    expect(isSimpleEmail(`a@${".".repeat(100_000)} `)).toBe(false);
    expect(isSimpleUrl(`a${".".repeat(100_000)} `)).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
