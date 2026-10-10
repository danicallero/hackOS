import { formatAppVersion } from "./app-version";

describe("formatAppVersion", () => {
  it("adds the build commit beside the version", () => {
    expect(formatAppVersion("1.0.2", "abc1234")).toBe("v1.0.2 · abc1234");
  });

  it("keeps the bare version when no commit was embedded", () => {
    expect(formatAppVersion("1.0.2", null)).toBe("v1.0.2");
    expect(formatAppVersion(null, undefined)).toBe("vunknown");
  });
});
