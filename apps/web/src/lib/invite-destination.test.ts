import { describe, expect, it } from "vitest";
import { destinationForKind } from "./invite-destination";

describe("destinationForKind (H9/H10 invitation onboarding branch)", () => {
  it("routes a late participant to my applications (the closed form)", () => {
    expect(destinationForKind("participant")).toBe("/my-applications");
  });

  it("routes a sponsor representative to the company workspace", () => {
    expect(destinationForKind("sponsor")).toBe("/enterprises");
  });

  it("routes staff to their granted work tools", () => {
    expect(destinationForKind("staff")).toBe("/dashboard");
  });
});
