import "./env.js";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";

/** #966 APNs Live Activity payloads and ES256 provider tokens (no network). */

const queueProps = {
  v: 1 as const,
  kind: "queue" as const,
  phase: "waiting" as const,
  entryId: 4,
  challengeTitle: "Robotics",
  position: 4,
  etaMinutes: 12,
  roomName: null,
  roomLocation: null,
  otherQueues: 0,
  url: "hackos://queue",
  labels: {
    position: "Position",
    wait: "Wait",
    goTo: "Go to",
    inRoom: "In room",
    moreQueues: null,
    minutes: "min",
  },
  updatedAt: "2026-10-11T10:00:00.000Z",
};

describe("liveActivityApnsPayload", () => {
  it("wraps props the way expo-widgets decodes them and adds start-only fields", async () => {
    const { liveActivityApnsPayload } = await import("../../src/modules/live-activities/apns.js");
    const now = new Date("2026-10-11T10:00:00Z");
    const payload = liveActivityApnsPayload({
      event: "start",
      kind: "queue",
      props: queueProps,
      now,
      alert: { title: "Robotics", body: "Position #4" },
      staleDate: new Date("2026-10-11T10:30:00Z"),
      relevanceScore: 50,
    });
    expect(payload).toEqual({
      aps: {
        timestamp: 1_791_712_800,
        event: "start",
        "content-state": { name: "QueueActivity", props: JSON.stringify(queueProps) },
        "attributes-type": "LiveActivityAttributes",
        attributes: { url: "hackos://queue" },
        alert: { title: "Robotics", body: "Position #4" },
        "stale-date": 1_791_714_600,
        "relevance-score": 50,
      },
    });
  });

  it("sets a dismissal date on end and never start-only attributes on update", async () => {
    const { liveActivityApnsPayload } = await import("../../src/modules/live-activities/apns.js");
    const now = new Date("2026-10-11T10:00:00Z");
    const end = liveActivityApnsPayload({ event: "end", kind: "queue", props: queueProps, now });
    expect(end.aps).toMatchObject({ event: "end", "dismissal-date": 1_791_712_800 + 900 });
    const update = liveActivityApnsPayload({
      event: "update",
      kind: "queue",
      props: queueProps,
      now,
    });
    expect(update.aps).not.toHaveProperty("attributes-type");
    expect(update.aps).not.toHaveProperty("alert");
    expect(update.aps).not.toHaveProperty("dismissal-date");
  });

  it("classifies dead tokens", async () => {
    const { isDeadApnsToken } = await import("../../src/modules/live-activities/apns.js");
    expect(isDeadApnsToken({ status: 410, reason: "Unregistered" })).toBe(true);
    expect(isDeadApnsToken({ status: 400, reason: "BadDeviceToken" })).toBe(true);
    expect(isDeadApnsToken({ status: 400, reason: "ExpiredToken" })).toBe(true);
    expect(isDeadApnsToken({ status: 429, reason: "TooManyRequests" })).toBe(false);
    expect(isDeadApnsToken({ status: 403, reason: "ExpiredProviderToken" })).toBe(false);
  });
});

describe("signApnsJwt", () => {
  it("produces an ES256 JWT that verifies with the key's public half", async () => {
    const { signApnsJwt } = await import("../../src/modules/live-activities/apns.js");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const token = signApnsJwt({
      keyId: "ABC123DEFG",
      teamId: "TEAM123456",
      key: pem,
      issuedAt: new Date("2026-10-11T10:00:00Z"),
    });
    const [header, claims, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "ABC123DEFG",
    });
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toEqual({
      iss: "TEAM123456",
      iat: 1_791_712_800,
    });
    const raw = Buffer.from(signature!, "base64url");
    expect(raw).toHaveLength(64); // JOSE r||s, not DER
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key: createPublicKey(pem), dsaEncoding: "ieee-p1363" },
        raw,
      ),
    ).toBe(true);
  });
});
