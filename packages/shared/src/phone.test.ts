import { describe, expect, it } from "vitest";
import { formatPhoneAsYouType, formatPhoneInternational, normalizePhone } from "./phone";

describe("phone", () => {
  it("normalizes valid numbers to E.164, defaulting to Spain", () => {
    expect(normalizePhone("600 11 12 22")).toBe("+34600111222");
    expect(normalizePhone("+44 7911 123456")).toBe("+447911123456");
  });

  it("rejects implausible numbers", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("+34 100 000 000")).toBeNull();
  });

  it("formats for display", () => {
    expect(formatPhoneAsYouType("600111222")).toBe("600 11 12 22");
    expect(formatPhoneInternational("+34600111222")).toBe("+34 600 11 12 22");
    expect(formatPhoneInternational("nonsense")).toBe("nonsense");
  });
});
