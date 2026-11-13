jest.mock("./api", () => ({ apiFetch: jest.fn() }));

import { companyHue, heroGradient } from "./company";

describe("company hero tint", () => {
  it("derives a stable hue from the name", () => {
    expect(companyHue("Acme")).toBe(companyHue("Acme"));
    expect(companyHue("Acme")).toBeGreaterThanOrEqual(0);
    expect(companyHue("Acme")).toBeLessThan(360);
  });

  it("fades the tint to transparent in both schemes", () => {
    for (const dark of [false, true]) {
      expect(heroGradient("Acme", dark)).toMatch(
        /^linear-gradient\(to bottom, rgba\(\d+,\d+,\d+,0\.\d+\) 0%, rgba\(\d+,\d+,\d+,0\) 100%\)$/,
      );
    }
  });
});
