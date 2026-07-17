import { describe, expect, it } from "vitest";
import { enterpriseNextAction } from "./shared";

describe("enterpriseNextAction", () => {
  it("asks for a logo first", () => {
    expect(
      enterpriseNextAction({ logo_url: null, website: "https://acme.com", description: "Acme" }),
    ).toBe("addLogo");
  });

  it("asks for a website next", () => {
    expect(
      enterpriseNextAction({
        logo_url: "https://acme.com/logo.png",
        website: null,
        description: "Acme",
      }),
    ).toBe("addWebsite");
  });

  it("asks for a description next", () => {
    expect(
      enterpriseNextAction({
        logo_url: "https://acme.com/logo.png",
        website: "https://acme.com",
        description: "",
      }),
    ).toBe("addDescription");
  });

  it("is null once the profile is complete", () => {
    expect(
      enterpriseNextAction({
        logo_url: "https://acme.com/logo.png",
        website: "https://acme.com",
        description: "We build things.",
      }),
    ).toBeNull();
  });
});
