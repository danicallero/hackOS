const IDS = require("../../packages/shared/src/ui-test-ids.json");

const fixture = {
  email: process.env.E2E_OPERATOR_EMAIL,
  password: process.env.E2E_OPERATOR_PASSWORD,
  personId: process.env.E2E_PERSON_ID,
  badge: process.env.E2E_BADGE_ID,
  newBadge: process.env.E2E_NEW_BADGE_ID,
  mealId: process.env.E2E_MEAL_ACTIVITY_ID,
  activityId: process.env.E2E_RECORDABLE_ACTIVITY_ID,
};

function requireFixture(...keys) {
  const variable = {
    email: "E2E_OPERATOR_EMAIL",
    password: "E2E_OPERATOR_PASSWORD",
    personId: "E2E_PERSON_ID",
    badge: "E2E_BADGE_ID",
    newBadge: "E2E_NEW_BADGE_ID",
    mealId: "E2E_MEAL_ACTIVITY_ID",
    activityId: "E2E_RECORDABLE_ACTIVITY_ID",
  };
  for (const key of keys) {
    if (!fixture[key])
      throw new Error(`Missing deterministic device fixture variable ${variable[key]}`);
  }
}

async function signIn() {
  requireFixture("email", "password");
  await device.launchApp({ delete: true, newInstance: true });
  await waitFor(element(by.id(IDS.auth.email)))
    .toBeVisible()
    .withTimeout(90_000);
  await element(by.id(IDS.auth.email)).typeText(fixture.email);
  await element(by.id(IDS.auth.password)).typeText(fixture.password);
  await element(by.id(IDS.auth.submit)).tap();
  await waitFor(element(by.id(IDS.auth.submit)))
    .not.toBeVisible()
    .withTimeout(30_000);
}

async function enterCode(code) {
  await waitFor(element(by.id(IDS.scanner.manualEntry)))
    .toBeVisible()
    .withTimeout(30_000);
  await element(by.id(IDS.scanner.manualEntry)).tap();
  await element(by.id(IDS.scanner.manualCode)).typeText(code);
  await element(by.id(IDS.scanner.manualSubmit)).tap();
}

describe("critical in-person scanner flows", () => {
  beforeEach(signIn);

  it("accredits a person with a badge", async () => {
    requireFixture("personId", "newBadge");
    await device.openURL({ url: `hackos://scan/person/${fixture.personId}` });
    await waitFor(element(by.id(IDS.scanner.linkBadge)))
      .toBeVisible()
      .withTimeout(30_000);
    await element(by.id(IDS.scanner.linkBadge)).tap();
    await enterCode(fixture.newBadge);
    await waitFor(element(by.id(IDS.scanner.linkBadge)))
      .not.toBeVisible()
      .withTimeout(30_000);
  });

  it("records a meal and requires confirmation for a second physical scan", async () => {
    requireFixture("mealId", "badge");
    await device.openURL({ url: `hackos://activities/${fixture.mealId}` });
    await enterCode(fixture.badge);
    await waitFor(element(by.id(IDS.scanner.result)))
      .toBeVisible()
      .withTimeout(30_000);
    await element(by.id(IDS.scanner.continue)).tap();
    await enterCode(fixture.badge);
    await waitFor(element(by.id(IDS.scanner.confirmRepeat)))
      .toBeVisible()
      .withTimeout(30_000);
  });

  it("records a recordable activity and exposes the durable result after sync", async () => {
    requireFixture("activityId", "badge");
    await device.setURLBlacklist([`.*/api/activities/${fixture.activityId}/scan.*`]);
    await device.openURL({ url: `hackos://activities/${fixture.activityId}` });
    await enterCode(fixture.badge);
    await waitFor(element(by.id(IDS.scanner.result)))
      .toBeVisible()
      .withTimeout(30_000);
    await expect(element(by.id(IDS.scanner.continue))).toBeVisible();

    // The write is now only in the encrypted SQLite queue. A process restart
    // must retain it; restoring the network lets the initial sync replay the
    // same scan ID/idempotency key exactly once.
    await device.terminateApp();
    await device.setURLBlacklist([]);
    await device.launchApp({ newInstance: true });
    await device.openURL({ url: `hackos://activities/${fixture.activityId}` });
    await enterCode(fixture.badge);
    await waitFor(element(by.id(IDS.scanner.confirmRepeat)))
      .toBeVisible()
      .withTimeout(30_000);
  });
});
