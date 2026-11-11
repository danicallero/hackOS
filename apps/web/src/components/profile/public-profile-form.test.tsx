import { describe, expect, it } from "vitest";
import { handleOf } from "./public-profile-form";

describe("handleOf", () => {
  it("keeps only the handle of a stored or pasted address", () => {
    expect(handleOf("https://instagram.com/maria", "instagram.com/")).toBe("maria");
    expect(handleOf("https://www.x.com/maria", "x.com/")).toBe("maria");
    expect(handleOf("linkedin.com/in/maria-p", "linkedin.com/in/")).toBe("maria-p");
    expect(handleOf("maria", "instagram.com/")).toBe("maria");
    expect(handleOf("", "x.com/")).toBe("");
  });
});
