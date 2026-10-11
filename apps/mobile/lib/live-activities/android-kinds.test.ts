/**
 * #966 (H59 attendee, H19 deadline, H22 accreditation): the Android Live
 * Update mapping of the newer kinds — both renderings (promoted title/text/
 * chip/track and the custom card), missing labels, the deadline's closing
 * alert, rank as the sort key — and the Android host posting them.
 */
import {
  type AccreditationLiveProps,
  type AttendeeActivityLiveProps,
  accreditationLiveLabels,
  attendeeActivityLiveLabels,
  type DeadlineLiveProps,
  deadlineLiveLabels,
} from "@hackos/shared/live-activities";
import type { LiveUpdateSpec } from "@/modules/live-updates";
import {
  androidLiveUpdateId,
  parseAndroidLiveUpdateId,
  parseAndroidLiveUpdateMessage,
  toLiveUpdateSpec,
} from "./model";

const mockShow = jest.fn();
jest.mock("@/modules/live-updates", () => ({
  __esModule: true,
  default: {
    isSupported: () => true,
    canPostPromotedNotifications: () => true,
    show: (spec: unknown) => mockShow(spec),
    activeIds: () => [],
    consumeDismissals: () => ({}),
    dismiss: jest.fn(),
  },
}));

const NOW = Date.parse("2026-02-20T12:00:00.000Z");
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
// Local wall-clock times, as the mapping renders them.
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function attendee(overrides: Partial<AttendeeActivityLiveProps> = {}): AttendeeActivityLiveProps {
  return {
    v: 1,
    kind: "attendee_activity",
    phase: "upcoming",
    scheduleId: 21,
    name: "Intro to Rust",
    category: "workshop",
    location: "Room A2",
    startsAt: iso(NOW + 12 * MIN),
    endsAt: iso(NOW + 72 * MIN),
    url: "hackos://schedule/21",
    labels: attendeeActivityLiveLabels("en"),
    updatedAt: iso(NOW),
    ...overrides,
  };
}

function deadline(overrides: Partial<DeadlineLiveProps> = {}): DeadlineLiveProps {
  return {
    v: 1,
    kind: "deadline",
    phase: "open",
    startsAt: iso(NOW - 30 * 60 * MIN),
    endsAt: iso(NOW + 6 * 60 * MIN),
    submission: "draft",
    projectName: "Tidewatch",
    url: "hackos://project",
    labels: deadlineLiveLabels("en"),
    updatedAt: iso(NOW),
    ...overrides,
  };
}

function accreditation(overrides: Partial<AccreditationLiveProps> = {}): AccreditationLiveProps {
  return {
    v: 1,
    kind: "accreditation",
    phase: "live",
    accredited: 412,
    eligible: 600,
    inside: 380,
    recentArrivals: 23,
    endsAt: iso(NOW + 47 * MIN),
    scanUrl: "hackos://scan",
    url: "hackos://scan",
    labels: accreditationLiveLabels("en"),
    updatedAt: iso(NOW),
    ...overrides,
  };
}

const spec = (props: Parameters<typeof toLiveUpdateSpec>[0], previous: string | null = null) =>
  toLiveUpdateSpec(props, previous, NOW) as LiveUpdateSpec;

describe("attendee activity (H59)", () => {
  it("counts down to the start in the chip and header while upcoming", () => {
    const result = spec(attendee());
    const where = `${hhmm(NOW + 12 * MIN)}–${hhmm(NOW + 72 * MIN)} · Room A2`;
    expect(result).toMatchObject({
      id: "schedule:21",
      title: "Intro to Rust",
      text: where,
      subText: "Starts in",
      countdownTo: NOW + 12 * MIN,
      tone: "accent",
      icon: "mic",
      url: "hackos://schedule/21",
      alert: false,
      card: {
        header: "Intro to Rust",
        lead: { caption: "Starts in", timer: "countDown", hero: true },
        detail: where,
      },
    });
    // The chip shows the countdown itself; no action, no track yet.
    expect(result.shortCriticalText ?? null).toBeNull();
    expect(result.action ?? null).toBeNull();
    expect(result.progress ?? null).toBeNull();
  });

  it("reads Now · name while live, counts down to the end and tracks the elapsed time", () => {
    const result = spec(
      attendee({ phase: "live", startsAt: iso(NOW - 20 * MIN), endsAt: iso(NOW + 20 * MIN) }),
    );
    expect(result).toMatchObject({
      title: "Now · Intro to Rust",
      emphasis: "Now",
      subText: "Ends in",
      countdownTo: NOW + 20 * MIN,
      progress: {
        value: 50,
        segments: [
          { length: 50, tone: "travelled" },
          { length: 50, tone: "accent" },
        ],
        tracker: "mic",
      },
      card: { header: "Now · Intro to Rust", lead: { caption: "Ends in", timer: "countDown" } },
    });
  });

  it("maps categories like the iOS widget and omits missing labels", () => {
    expect(spec(attendee({ category: "deadline" })).icon).toBe("flag");
    expect(spec(attendee({ category: "activity" })).icon).toBe("sparkles");
    expect(spec(attendee({ category: "meal" })).icon).toBe("meal");
    expect(spec(attendee({ category: "other" })).icon).toBe("calendar");
    const bare = spec(
      attendee({
        phase: "live",
        labels: {} as AttendeeActivityLiveProps["labels"],
        location: null,
      }),
    );
    expect(bare.title).toBe("Intro to Rust");
    expect(bare.emphasis ?? null).toBeNull();
    expect(bare.subText).toBeNull();
    expect(bare.card?.lead.caption).toBeNull();
  });
});

describe("submission deadline (H19, H20)", () => {
  it("counts down in blue with the project, its draft status and the window track", () => {
    const result = spec(deadline());
    // 30 h of a 36 h window elapsed.
    expect(result).toMatchObject({
      id: "deadline",
      title: "Tidewatch",
      text: "Not submitted",
      subText: "Closes in",
      countdownTo: NOW + 6 * 60 * MIN,
      tone: "accent",
      icon: "hourglass",
      url: "hackos://project",
      alert: false,
      progress: { value: 83, tracker: "hourglass", trackerTone: "accent" },
      card: {
        header: "Submissions close",
        lead: { caption: "Closes in", timer: "countDown", hero: true },
        trail: { caption: "Tidewatch", value: "Not submitted", quiet: true, tone: "warning" },
      },
    });
    expect(result.shortCriticalText ?? null).toBeNull();
    expect(result.action ?? null).toBeNull();
  });

  it("shows no status for an unknown submission, never 'not submitted'", () => {
    const result = spec(deadline({ submission: null, projectName: null }));
    expect(result.title).toBe("Submissions close");
    expect(result.text).toBeNull();
    expect(result.card?.trail).toBeNull();
  });

  it("draws no track without the window's start", () => {
    expect(spec(deadline({ startsAt: null })).progress).toBeNull();
  });

  it("turns red while closing and alerts only on the transition into it", () => {
    const closing = deadline({ phase: "closing", endsAt: iso(NOW + 11 * MIN) });
    expect(spec(closing, "open")).toMatchObject({
      tone: "alert",
      icon: "alert",
      alert: true,
      progress: { trackerTone: "alert" },
      card: { trail: { value: "Not submitted", tone: "alert" } },
    });
    expect(spec(closing, null).alert).toBe(true);
    expect(spec(closing, "closing").alert).toBe(false);
    expect(spec(deadline(), "closing").alert).toBe(false);
  });

  it("is calm and green once submitted, keeping the time left", () => {
    const result = spec(deadline({ phase: "submitted", submission: "submitted" }), "closing");
    expect(result).toMatchObject({
      title: "Submitted",
      text: "Tidewatch",
      subText: "Closes in",
      countdownTo: NOW + 6 * 60 * MIN,
      tone: "go",
      icon: "check",
      alert: false,
      card: {
        header: "Submissions close",
        lead: { caption: "Tidewatch", value: "Submitted", hero: true },
        trail: { caption: "Closes in", timer: "countDown", quiet: true },
      },
    });
    expect(result.progress ?? null).toBeNull();
  });

  it("stops counting once the deadline passed and omits missing labels", () => {
    expect(spec(deadline({ endsAt: iso(NOW - MIN) })).countdownTo).toBeNull();
    const bare = spec(deadline({ labels: {} as DeadlineLiveProps["labels"] }));
    expect(bare.subText).toBeNull();
    expect(bare.text).toBeNull();
    expect(bare.card?.lead.caption).toBeNull();
  });

  it("localizes", () => {
    const result = spec(deadline({ labels: deadlineLiveLabels("gl") }));
    expect(result.text).toBe("Sen entregar");
    expect(result.subText).toBe("Pecha en");
  });
});

describe("accreditation desk (H22)", () => {
  it("leads with the accredited count, tracks the share and offers Scan", () => {
    const result = spec(accreditation());
    expect(result).toMatchObject({
      id: "accreditation",
      title: "412/600 accredited",
      emphasis: "412",
      text: "+23 last 10 min · 380 inside",
      subText: "Accreditation",
      shortCriticalText: "412",
      icon: "badge",
      tone: "accent",
      url: "hackos://scan",
      action: { label: "Scan", url: "hackos://scan" },
      progress: { value: 69, tracker: "badge" },
      card: {
        header: "Accreditation",
        stats: [
          { caption: "Accredited", value: "412/600", hero: true },
          { caption: "Last 10 min", value: "+23" },
          { caption: "Inside", value: "380" },
        ],
      },
    });
    // A count in the chip: no `when` to displace it.
    expect(result.countdownTo ?? null).toBeNull();
    expect(result.countUpFrom ?? null).toBeNull();
  });

  it("omits the presence estimate when unknown and anything whose label is missing", () => {
    const noInside = spec(accreditation({ inside: null }));
    expect(noInside.text).toBe("+23 last 10 min");
    expect(noInside.card?.stats).toHaveLength(2);

    const bare = spec(accreditation({ labels: {} as AccreditationLiveProps["labels"] }));
    expect(bare.title).toBe("412/600");
    expect(bare.text).toBeNull();
    expect(bare.subText).toBeNull();
    expect(bare.action).toBeNull();
    expect(bare.card?.stats).toEqual([{ caption: null, value: "412/600", hero: true }]);
  });

  it("has no share without eligible people and fits a large count in the chip", () => {
    const result = spec(accreditation({ eligible: 0, accredited: 12_345_678 }));
    expect(result.progress).toBeNull();
    expect(result.title).toBe("12345678 accredited");
    expect(result.shortCriticalText).toBe("123456…");
  });

  it("localizes", () => {
    const result = spec(accreditation({ labels: accreditationLiveLabels("es") }));
    expect(result.title).toBe("412/600 acreditados");
    expect(result.text).toBe("+23 últimos 10 min · 380 dentro");
    expect(result.action?.label).toBe("Escanear");
  });
});

describe("rank (#966)", () => {
  it("carries the device rank to the post's sort key", () => {
    expect(spec(accreditation({ rank: 2 })).rank).toBe(2);
    expect(spec(attendee({ rank: 0 })).rank).toBe(0);
    expect(spec(deadline()).rank).toBeUndefined();
    expect(spec(deadline({ rank: -1 })).rank).toBeUndefined();
  });
});

describe("Android ids and messages for the new kinds", () => {
  it("round-trips notification ids", () => {
    for (const [kind, subject] of [
      ["attendee_activity", "schedule:21"],
      ["deadline", "deadline"],
      ["accreditation", "accreditation"],
    ] as const) {
      expect(parseAndroidLiveUpdateId(androidLiveUpdateId(kind, subject))).toEqual({
        kind,
        subject,
      });
    }
    expect(parseAndroidLiveUpdateId("schedule:x")).toBeNull();
  });

  it("accepts data pushes of every kind", () => {
    const message = (props: unknown, kind: string, subject: string) => ({
      hackosLiveUpdate: { event: "update", kind, subject, props, rank: 1 },
    });
    expect(parseAndroidLiveUpdateMessage(message(deadline(), "deadline", "deadline"))?.kind).toBe(
      "deadline",
    );
    expect(
      parseAndroidLiveUpdateMessage(message(attendee(), "attendee_activity", "schedule:21"))
        ?.subject,
    ).toBe("schedule:21");
    expect(parseAndroidLiveUpdateMessage(message(accreditation(), "unknown", "x"))).toBeNull();
  });
});

describe("host.android", () => {
  it("posts the new kinds", async () => {
    const { liveActivityHost } = require("./host.android") as typeof import("./host.android");
    mockShow.mockClear();
    const id = await liveActivityHost.start(
      { kind: "deadline", subject: "deadline", props: deadline({ rank: 1 }) },
      null,
    );
    expect(id).toBe("deadline");
    expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ id: "deadline", rank: 1 }));
    await liveActivityHost.start(
      { kind: "accreditation", subject: "accreditation", props: accreditation() },
      null,
    );
    await liveActivityHost.start(
      { kind: "attendee_activity", subject: "schedule:21", props: attendee() },
      null,
    );
    expect(mockShow).toHaveBeenCalledTimes(3);
  });
});
