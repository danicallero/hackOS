import { describe, expect, it } from "vitest";

// Compose supplies an empty value when the optional fixture secret is unset.
// Import config only after setting that value so this exercises boot parsing.
process.env.REVIEW_FIXTURE_PASSWORD = "";
delete process.env.LOG_EXPO_PUSH_TICKETS;
delete process.env.LOG_EXPO_PUSH_UNSAFE_DEBUG;
// #966: Compose passes the optional APNs Live Activity settings as "" too.
process.env.APNS_KEY_ID = "";
process.env.APNS_AUTH_KEY_P8 = "";
process.env.APNS_BUNDLE_ID = "";
process.env.LIVE_ACTIVITY_LEAD_MINUTES = "";
const { config } = await import("../src/config.js");

describe("environment config", () => {
  it("treats an empty optional reviewer fixture password as unset (H54)", () => {
    expect(config.REVIEW_FIXTURE_PASSWORD).toBeUndefined();
  });

  it("keeps Expo push ticket logging disabled by default", () => {
    expect(config.logExpoPushTickets).toBe(false);
  });

  it("keeps Expo push-token logging disabled by default", () => {
    expect(config.logExpoPushTokens).toBe(false);
  });

  it("keeps unsafe Expo push debugging disabled by default", () => {
    expect(config.logExpoPushUnsafeDebug).toBe(false);
  });

  it("treats empty Live Activity settings as unset and applies defaults (#966)", () => {
    expect(config.APNS_KEY_ID).toBeUndefined();
    expect(config.liveActivityApnsConfigured).toBe(false);
    expect(config.APNS_BUNDLE_ID).toBe("com.hackudc.os");
    expect(config.LIVE_ACTIVITY_LEAD_MINUTES).toBe(15);
  });
});
