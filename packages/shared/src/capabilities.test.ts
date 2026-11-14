import { describe, expect, it } from "vitest";
import {
  ALL_CAPABILITIES,
  CAPABILITIES,
  CAPABILITY_ACCESS,
  closedEditionCapabilities,
} from "./capabilities";
import { shouldShowEditionSelector } from "./editions";

describe("closed-edition capabilities (H8)", () => {
  it("classifies every capability", () => {
    expect(Object.keys(CAPABILITY_ACCESS).sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  it("keeps read capabilities and drops operational ones", () => {
    const kept = closedEditionCapabilities([
      CAPABILITIES.USERS_READ,
      CAPABILITIES.ACCREDIT_SCAN,
      CAPABILITIES.NOTIFICATIONS_SEND,
    ]);
    expect([...kept]).toEqual([CAPABILITIES.USERS_READ]);
  });

  it("expands the wildcard to every read capability, never to the wildcard itself", () => {
    const kept = closedEditionCapabilities([CAPABILITIES.ADMIN_ALL]);
    expect(kept.has(CAPABILITIES.ADMIN_ALL)).toBe(false);
    expect(kept.has(CAPABILITIES.ACCREDIT_SCAN)).toBe(false);
    expect(kept.has(CAPABILITIES.EVENT_MANAGE)).toBe(true);
    expect(kept.size).toBe(
      ALL_CAPABILITIES.filter((capability) => CAPABILITY_ACCESS[capability] === "read").length,
    );
  });
});

describe("edition selector visibility", () => {
  const edition = {
    eventKey: "e2026",
    name: "2026",
    status: "closed" as const,
    startsAt: null,
    endsAt: null,
    isCurrent: false,
  };
  it("shows only when there is more than one edition", () => {
    expect(shouldShowEditionSelector([edition])).toBe(false);
    expect(
      shouldShowEditionSelector([edition, { ...edition, eventKey: "e2027", isCurrent: true }]),
    ).toBe(true);
  });
});
