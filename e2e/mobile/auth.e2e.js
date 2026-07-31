const AUTH_IDS = require("../../packages/shared/src/ui-test-ids.json").auth;

// The build under test is an expo-dev-client. It boots straight into Metro
// because the Detox build bakes DEV_CLIENT_DEFAULT_LAUNCHER_URL into the
// Info.plist; bundling still takes a while on the first launch.
describe("native sign-in UI contract", () => {
  beforeEach(async () => {
    await device.launchApp({ delete: true, newInstance: true });
    await waitFor(element(by.id(AUTH_IDS.email)))
      .toBeVisible()
      .withTimeout(90_000);
  });

  it("renders the shared controls", async () => {
    await expect(element(by.id(AUTH_IDS.email))).toBeVisible();
    await expect(element(by.id(AUTH_IDS.password))).toBeVisible();
    await expect(element(by.id(AUTH_IDS.submit))).toBeVisible();
  });

  it("accepts credentials through native text input", async () => {
    await element(by.id(AUTH_IDS.email)).tap();
    await element(by.id(AUTH_IDS.email)).typeText("person@example.com");
    await element(by.id(AUTH_IDS.password)).tap();
    await element(by.id(AUTH_IDS.password)).typeText("secret");

    await expect(element(by.id(AUTH_IDS.submit))).toBeVisible();
  });
});
