import { NATIVE_PASSWORD_RESET_REDIRECT, passwordResetRedirect } from "./password-reset";

describe("password reset redirect", () => {
  it("uses the web reset form on Android", () => {
    expect(passwordResetRedirect("android")).toBe("https://os.hackudc.com/reset-password");
  });

  it.each(["ios", "web", undefined])("keeps the native callback for %s", (platform) => {
    expect(passwordResetRedirect(platform)).toBe(NATIVE_PASSWORD_RESET_REDIRECT);
  });
});
