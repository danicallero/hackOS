import { describe, expect, it } from "vitest";
import { handleOf, urlForHandle } from "./social-links";

// #934, #935: web and mobile editors reduce stored or pasted links to the handle.
describe("handleOf", () => {
  it("keeps only the handle of a stored or pasted address", () => {
    expect(handleOf("https://instagram.com/maria", "instagram.com/")).toBe("maria");
    expect(handleOf("https://www.x.com/maria", "x.com/")).toBe("maria");
    expect(handleOf("linkedin.com/in/maria-p", "linkedin.com/in/")).toBe("maria-p");
    expect(handleOf("maria", "instagram.com/")).toBe("maria");
    expect(handleOf("", "x.com/")).toBe("");
  });
});

describe("urlForHandle", () => {
  it("stores the full address and clears an empty handle", () => {
    expect(urlForHandle("maria-p", "linkedin.com/in/")).toBe("https://linkedin.com/in/maria-p");
    expect(urlForHandle("https://x.com/maria", "x.com/")).toBe("https://x.com/maria");
    expect(urlForHandle("", "x.com/")).toBe("");
  });
});
