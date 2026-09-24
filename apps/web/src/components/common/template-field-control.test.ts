import { describe, expect, it } from "vitest";
import { externalUrlHref } from "./template-field-control";

describe("externalUrlHref", () => {
  it("adds HTTPS to submitted hostnames so browsers do not treat them as app routes", () => {
    expect(externalUrlHref("www.website.com")).toBe("https://www.website.com/");
  });

  it("preserves HTTP(S) URLs and refuses non-web protocols", () => {
    expect(externalUrlHref("https://example.com/demo")).toBe("https://example.com/demo");
    expect(externalUrlHref("javascript:alert(1)")).toBeNull();
  });
});
