import { describe, expect, it } from "vitest";
import { safeReturnPath, withReturnPath } from "./return-path";

describe("safeReturnPath (H188 same-origin guard)", () => {
  it("accepts a relative path", () => {
    expect(safeReturnPath("/my-applications/5")).toBe("/my-applications/5");
  });

  it.each([
    null,
    undefined,
    "",
    "https://evil.example.com",
    "//evil.example.com",
    "javascript:alert(1)",
  ])("falls back to the default for %s", (candidate) => {
    expect(safeReturnPath(candidate)).toBe("/timetable");
  });

  it("supports a custom fallback", () => {
    expect(safeReturnPath(null, "/enterprises")).toBe("/enterprises");
    expect(safeReturnPath("https://evil.example.com", "")).toBe("");
  });
});

describe("withReturnPath", () => {
  it("appends ?next= to a bare href", () => {
    expect(withReturnPath("/signup", "/my-applications/5")).toBe(
      "/signup?next=%2Fmy-applications%2F5",
    );
  });

  it("appends &next= when the href already has a query string", () => {
    expect(withReturnPath("/verify-email?email=a%40b.com", "/timetable")).toBe(
      "/verify-email?email=a%40b.com&next=%2Ftimetable",
    );
  });

  it("leaves the href untouched when next is missing or unsafe", () => {
    expect(withReturnPath("/signup", null)).toBe("/signup");
    expect(withReturnPath("/signup", undefined)).toBe("/signup");
    expect(withReturnPath("/signup", "https://evil.example.com")).toBe("/signup");
    expect(withReturnPath("/signup", "//evil.example.com")).toBe("/signup");
  });
});
