const { createServer, request: forwardRequest } = require("node:http");

const IDS = require("../../packages/shared/src/ui-test-ids.json");

const fixture = {
  email: process.env.E2E_OPERATOR_EMAIL,
  password: process.env.E2E_OPERATOR_PASSWORD,
  personId: process.env.E2E_PERSON_ID,
  badge: process.env.E2E_BADGE_ID,
  newBadge: process.env.E2E_NEW_BADGE_ID,
  mealId: process.env.E2E_MEAL_ACTIVITY_ID,
  activityId: process.env.E2E_RECORDABLE_ACTIVITY_ID,
  apiUrl: process.env.E2E_API_URL,
  upstreamUrl: process.env.E2E_API_UPSTREAM_URL,
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
    apiUrl: "E2E_API_URL",
    upstreamUrl: "E2E_API_UPSTREAM_URL",
  };
  for (const key of keys) {
    if (!fixture[key])
      throw new Error(`Missing deterministic device fixture variable ${variable[key]}`);
  }
}

// H25/H26: make an unacknowledged scan real. Detox's URL blacklist controls
// idle synchronization only; it does not disconnect the app from the server.
let rejectActivityScans = false;
const rejectedScanKeys = [];
const acknowledgedScanKeys = [];
let scanRejected;
let scanAcknowledged;
let proxy;
beforeAll(async () => {
  requireFixture("apiUrl", "upstreamUrl", "activityId");
  const address = new URL(fixture.apiUrl);
  const upstream = new URL(fixture.upstreamUrl);
  proxy = createServer((incoming, outgoing) => {
    const isScan =
      incoming.method === "POST" &&
      incoming.url.split("?")[0] === `/api/activities/${fixture.activityId}/scan`;
    const key = incoming.headers["idempotency-key"];
    if (isScan && rejectActivityScans) {
      rejectedScanKeys.push(key);
      scanRejected?.();
      outgoing.writeHead(503, { "content-type": "application/json" });
      outgoing.end(
        JSON.stringify({
          error: { code: "offline_fixture", message: "Scan acknowledgement unavailable" },
        }),
      );
      return;
    }
    const forwarded = forwardRequest(
      new URL(incoming.url, upstream),
      {
        method: incoming.method,
        headers: incoming.headers,
      },
      (response) => {
        if (isScan && response.statusCode >= 200 && response.statusCode < 300) {
          acknowledgedScanKeys.push(key);
          scanAcknowledged?.();
        }
        outgoing.writeHead(response.statusCode, response.headers);
        response.pipe(outgoing);
      },
    );
    forwarded.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end();
    });
    outgoing.on("close", () => forwarded.destroy());
    incoming.pipe(forwarded);
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(Number(address.port), address.hostname, resolve);
  });
});
afterAll(async () => {
  if (!proxy) return;
  proxy.closeAllConnections();
  await new Promise((resolve, reject) =>
    proxy.close((error) => (error ? reject(error) : resolve())),
  );
});

async function signIn() {
  requireFixture("email", "password");
  if (device.getPlatform() === "ios") await device.clearKeychain();
  await device.launchApp({
    permissions: { notifications: "YES", camera: "YES" },
    delete: true,
    newInstance: true,
    launchArgs: {
      detoxEnableSynchronization: 0,
      detoxURLBlacklistRegex: ".*/api/realtime/stream.*",
    },
  });
  // H55: the live shell animates continuously; wait for explicit UI states.
  await device.disableSynchronization();
  await waitFor(element(by.id(IDS.auth.email)))
    .toBeVisible()
    .withTimeout(90_000);
  await element(by.id(IDS.auth.email)).tap();
  await element(by.id(IDS.auth.email)).typeText(fixture.email);
  await element(by.id(IDS.auth.password)).tap();
  await element(by.id(IDS.auth.password)).typeText(fixture.password);
  await element(by.id(IDS.auth.submit)).tap();
  await waitFor(element(by.id(IDS.auth.submit)))
    .not.toBeVisible()
    .withTimeout(30_000);
}

async function enterCode(code) {
  const manual = element(by.label("Enter code manually").and(by.traits(["button"])));
  await waitFor(manual).toBeVisible().withTimeout(30_000);
  // H55: UIKit ignores touches during the scanner modal’s slide transition.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await manual.tap();
  // iOS prompts with UIKit's own alert, which carries no test ids.
  await waitFor(element(by.type("UITextField")))
    .toBeVisible()
    .withTimeout(10_000);
  await element(by.type("UITextField")).typeText(code);
  await element(by.label("Register scan").and(by.type("_UIAlertControllerActionView"))).tap();
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
    await waitFor(element(by.text(fixture.newBadge)))
      .toBeVisible()
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
    await waitFor(element(by.label("Add another")))
      .toBeVisible()
      .withTimeout(30_000);
  });

  it("records a recordable activity and exposes the durable result after sync", async () => {
    requireFixture("activityId", "badge");
    rejectActivityScans = true;
    rejectedScanKeys.length = 0;
    acknowledgedScanKeys.length = 0;
    const rejected = new Promise((resolve) => {
      scanRejected = resolve;
    });
    await device.openURL({ url: `hackos://activities/${fixture.activityId}` });
    await enterCode(fixture.badge);
    await waitFor(element(by.id(IDS.scanner.result)))
      .toBeVisible()
      .withTimeout(30_000);
    await expect(element(by.id(IDS.scanner.continue))).toBeVisible();

    // The write is now only in the encrypted SQLite queue. A process restart
    // must retain it; restoring the network lets the initial sync replay the
    // same scan ID/idempotency key exactly once.
    await rejected;
    expect(rejectedScanKeys[0]).toBeTruthy();
    expect(acknowledgedScanKeys).toHaveLength(0);
    await device.terminateApp();
    const replayed = new Promise((resolve) => {
      scanAcknowledged = resolve;
    });
    rejectActivityScans = false;
    await device.launchApp({
      newInstance: true,
      launchArgs: {
        detoxEnableSynchronization: 0,
        detoxURLBlacklistRegex: ".*/api/realtime/stream.*",
      },
    });
    await device.disableSynchronization();
    await replayed;
    expect(acknowledgedScanKeys).toEqual([rejectedScanKeys[0]]);
    await device.openURL({ url: `hackos://activities/${fixture.activityId}` });
    await enterCode(fixture.badge);
    await waitFor(element(by.label("Add another")))
      .toBeVisible()
      .withTimeout(30_000);
  });
});
