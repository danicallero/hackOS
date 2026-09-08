jest.mock("@/lib/api", () => ({ CLOCK_SKEW_TOLERANCE_MS: 60_000 }));

import {
  buildPeopleIndex,
  detailLabel,
  findSubject,
  subjectLabel,
} from "@/components/scanner-transaction-status";
import type { PendingScan, ScannerActivity, ScannerPerson } from "@/lib/scanner-types";

function person(overrides: Partial<ScannerPerson> = {}): ScannerPerson {
  return {
    userId: 1,
    email: "ada@example.com",
    role: "participant",
    hasCapabilities: false,
    isEnterpriseJudge: false,
    eventAccess: true,
    ticketToken: null,
    badgeId: null,
    revokedBadgeIds: [],
    name: "Ada",
    surname: "Lovelace",
    dni: null,
    accepted: true,
    confirmed: true,
    intolerances: [],
    foodIntoleranceNotes: null,
    notes: null,
    lastPresenceKind: null,
    lastPresenceAt: null,
    ...overrides,
  };
}

function pending(payload: PendingScan["payload"]): PendingScan {
  return {
    id: "scan-1",
    kind: payload.kind,
    payload,
    status: "pending",
    attempts: 0,
    lastError: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    acknowledgedAt: null,
    clockCorrected: false,
  };
}

const t = ((key: string) => key) as ReturnType<typeof import("@/lib/i18n").useLocale>["t"];

describe("buildPeopleIndex (O(1) lookup, same results as scanning the array)", () => {
  const people = [
    person({ userId: 1, ticketToken: "TICKET-1", badgeId: "BADGE-1", email: "a@example.com" }),
    person({
      userId: 2,
      ticketToken: "TICKET-2",
      badgeId: "BADGE-2",
      revokedBadgeIds: ["BADGE-2-OLD"],
      email: "b@example.com",
    }),
  ];
  const index = buildPeopleIndex(people);

  it("matches an accreditation scan by ticket token, same as the array scan", () => {
    const scan = pending({
      kind: "accreditation",
      ticketToken: "TICKET-2",
      badgeId: "BADGE-2",
      method: "qr",
    });
    expect(findSubject(scan, index)).toEqual(findSubject(scan, people));
    expect(findSubject(scan, index)?.userId).toBe(2);
  });

  it("matches a presence/activity scan by current badge id", () => {
    const scan = pending({ kind: "presence", badgeId: "BADGE-1", direction: "in", scannedAt: "" });
    expect(findSubject(scan, index)).toEqual(findSubject(scan, people));
    expect(findSubject(scan, index)?.userId).toBe(1);
  });

  it("matches a presence/activity scan by a REVOKED badge id, same as the array scan", () => {
    const scan = pending({
      kind: "presence",
      badgeId: "BADGE-2-OLD",
      direction: "out",
      scannedAt: "",
    });
    expect(findSubject(scan, index)).toEqual(findSubject(scan, people));
    expect(findSubject(scan, index)?.userId).toBe(2);
  });

  it("matches accreditation_user/badge_rotation/badge_removal by user id", () => {
    const scan = pending({
      kind: "badge_removal",
      userId: 1,
      currentBadgeId: "BADGE-1",
      reason: "lost",
    });
    expect(findSubject(scan, index)).toEqual(findSubject(scan, people));
    expect(findSubject(scan, index)?.userId).toBe(1);
  });

  it("falls back from user id to badge id for presence_signal_delete, same as the array scan", () => {
    const scan = pending({
      kind: "presence_signal_delete",
      source: "door",
      logId: 9,
      badgeId: "BADGE-2-OLD",
    });
    expect(findSubject(scan, index)).toEqual(findSubject(scan, people));
    expect(findSubject(scan, index)?.userId).toBe(2);
  });

  it("returns undefined for both when nothing matches", () => {
    const scan = pending({ kind: "presence", badgeId: "NOPE", direction: "in", scannedAt: "" });
    expect(findSubject(scan, index)).toBeUndefined();
    expect(findSubject(scan, people)).toBeUndefined();
  });

  it("subjectLabel gives identical results through the array and the index", () => {
    const scan = pending({
      kind: "accreditation_user",
      userId: 2,
      badgeId: "BADGE-2",
      method: "manual",
    });
    expect(subjectLabel(scan, index)).toBe(subjectLabel(scan, people));
  });
});

describe("detailLabel with an activities Map (same results as the array)", () => {
  const activities: ScannerActivity[] = [
    {
      id: 7,
      name: "Workshop",
      category: "talk",
      requiresScan: true,
      startsAt: null,
      primaryLanguage: "en",
      nameI18n: {},
      descriptionI18n: {},
    },
  ];
  const activitiesById = new Map(activities.map((a) => [a.id, a]));

  it("resolves the activity name the same way via array and Map", () => {
    const scan = pending({
      kind: "activity",
      activityId: 7,
      badgeId: "BADGE-1",
      allowRepeat: false,
      scannedAt: "",
    });
    expect(detailLabel(scan, activitiesById, t)).toBe(detailLabel(scan, activities, t));
    expect(detailLabel(scan, activitiesById, t)).toContain("Workshop");
  });

  it("falls back to the numeric id the same way when the activity isn't found", () => {
    const scan = pending({
      kind: "activity",
      activityId: 999,
      badgeId: "BADGE-1",
      allowRepeat: false,
      scannedAt: "",
    });
    expect(detailLabel(scan, activitiesById, t)).toBe(detailLabel(scan, activities, t));
    expect(detailLabel(scan, activitiesById, t)).toContain("#999");
  });
});
