import { canEnterMobileApp, isMobileAccessDenied } from "@/lib/mobile-access";

describe("mobile access navigation boundary", () => {
  it("requires both an authenticated session and explicit mobile access", () => {
    expect(canEnterMobileApp(false, undefined)).toBe(false);
    expect(canEnterMobileApp(true, undefined)).toBe(false);
    expect(canEnterMobileApp(true, false)).toBe(false);
    expect(canEnterMobileApp(true, true)).toBe(true);
  });

  it("blocks a signed-in account whose profile explicitly denies access", () => {
    expect(isMobileAccessDenied(true, false)).toBe(true);
    expect(isMobileAccessDenied(true, true)).toBe(false);
    expect(isMobileAccessDenied(false, false)).toBe(false);
  });
});
