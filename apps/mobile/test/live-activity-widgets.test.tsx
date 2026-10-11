/**
 * #966 (H38, H25/H26): the iOS Live Activity layouts receive APNs props
 * directly, so they must build every presentation for edge-case and
 * future-version payloads without throwing.
 */

import * as SwiftUI from "@expo/ui/swift-ui";
import * as SwiftUIModifiers from "@expo/ui/swift-ui/modifiers";
import {
  type AccreditationLiveProps,
  type ActivityLiveProps,
  type AttendeeActivityLiveProps,
  accreditationLiveLabels,
  activityLiveLabels,
  attendeeActivityLiveLabels,
  type DeadlineLiveProps,
  deadlineLiveLabels,
  type QueueLiveProps,
  queueLiveLabels,
} from "@hackos/shared/live-activities";
import type { LiveActivityEnvironment } from "expo-widgets";
import * as AccreditationWidget from "@/widgets/accreditation-activity";
import * as AttendeeWidget from "@/widgets/attendee-activity";
import * as DeadlineWidget from "@/widgets/deadline-activity";
import * as QueueWidget from "@/widgets/queue-activity";
import * as StaffWidget from "@/widgets/staff-activity";

type Layout<P> = (props: P, environment: LiveActivityEnvironment) => Record<string, unknown>;

/**
 * The `'widget'` Babel transform turns each layout into source text that the
 * widget extension evaluates on its own. Evaluate it the same way: with only
 * the JSX runtime and `@expo/ui/swift-ui` names in scope, so any reference to
 * module-scope code fails here exactly as it would on the device.
 */
function evaluateLayout<P>(source: unknown): Layout<P> {
  expect(typeof source).toBe("string");
  const allowed = new Set([...Object.keys(SwiftUI), ...Object.keys(SwiftUIModifiers)]);
  const scope = new Proxy(
    {},
    {
      has: (_target, key) => typeof key === "string" && !(key in globalThis),
      get: (_target, key) => {
        if (key === Symbol.unscopables) return undefined;
        const name = String(key);
        if (/^_jsxs?$/.test(name)) {
          return (type: unknown, props: Record<string, unknown>) => ({ type, props });
        }
        if (name === "_Fragment") return "Fragment";
        if (allowed.has(name)) {
          return name[0] === name[0]!.toUpperCase()
            ? name
            : (...args: unknown[]) => ({ modifier: name, args });
        }
        throw new ReferenceError(`${name} is not available to a 'widget' layout`);
      },
    },
  );
  const factory = new Function("scope", `with (scope) { return (${source as string}); }`);
  return factory(scope) as Layout<P>;
}

const QueueActivityLayout = evaluateLayout<QueueLiveProps>(QueueWidget.QueueActivityLayout);
const StaffActivityLayout = evaluateLayout<ActivityLiveProps>(StaffWidget.StaffActivityLayout);
const AttendeeActivityLayout = evaluateLayout<AttendeeActivityLiveProps>(
  AttendeeWidget.AttendeeActivityLayout,
);
const DeadlineActivityLayout = evaluateLayout<DeadlineLiveProps>(
  DeadlineWidget.DeadlineActivityLayout,
);
const AccreditationActivityLayout = evaluateLayout<AccreditationLiveProps>(
  AccreditationWidget.AccreditationActivityLayout,
);

const environment = {
  colorScheme: "dark",
  isLuminanceReduced: false,
} as unknown as LiveActivityEnvironment;

const SLOTS = [
  "banner",
  "bannerSmall",
  "compactLeading",
  "compactTrailing",
  "minimal",
  "expandedLeading",
  "expandedTrailing",
  "expandedBottom",
];

function queue(overrides: Partial<QueueLiveProps> = {}): QueueLiveProps {
  return {
    v: 1,
    kind: "queue",
    phase: "waiting",
    entryId: 3,
    challengeTitle: "Open data",
    position: 4,
    etaMinutes: 12,
    roomName: null,
    roomLocation: null,
    otherQueues: 0,
    url: "hackos://queue",
    labels: queueLiveLabels("en", 0),
    updatedAt: "2026-02-20T10:00:00.000Z",
    ...overrides,
  };
}

function activity(overrides: Partial<ActivityLiveProps> = {}): ActivityLiveProps {
  return {
    v: 1,
    kind: "activity",
    phase: "upcoming",
    activityId: 12,
    name: "Lunch",
    category: "meal",
    location: null,
    startsAt: "2026-02-20T12:00:00.000Z",
    endsAt: "2026-02-20T13:30:00.000Z",
    scanned: 0,
    scanUrl: "hackos://scan?activity=12",
    url: "hackos://scan?activity=12",
    labels: activityLiveLabels("en"),
    updatedAt: "2026-02-20T11:40:00.000Z",
    ...overrides,
  };
}

function texts(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  const props = (node as { props?: { children?: unknown } }).props;
  return props ? texts(props.children) : [];
}

type Node = { type?: unknown; props?: Record<string, unknown> };

/** Every node of `type` in a rendered presentation, depth first. */
function nodes(node: unknown, type: string): Node[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => nodes(child, type));
  const current = node as Node;
  const own = current.type === type ? [current] : [];
  return [...own, ...nodes(current.props?.children, type)];
}

/** Fill values of the stage track's three segment units (2:1 split, H38). */
function trackFill(layout: Record<string, unknown>): number[] {
  return nodes(layout.banner, "ProgressView").map((bar) => bar.props?.value as number);
}

describe("Live Activity layouts (#966)", () => {
  it.each([
    queue(),
    queue({ position: null, etaMinutes: null }),
    queue({ phase: "called", position: null, etaMinutes: null, roomName: "Room B" }),
    queue({ phase: "called", position: null, etaMinutes: null, roomName: null }),
    queue({ phase: "in_room", position: null, etaMinutes: null, roomName: "Room B" }),
    queue({ position: 4, queueTotal: 9, calledAt: null }),
    queue({
      phase: "called",
      position: null,
      etaMinutes: null,
      roomName: "A very long room name that must truncate",
      calledAt: "not a date",
    }),
    queue({ position: Number.NaN, etaMinutes: Number.POSITIVE_INFINITY }),
  ])("builds every queue presentation (%#)", (props) => {
    const layout = QueueActivityLayout(props, environment);
    expect(Object.keys(layout).sort()).toEqual([...SLOTS].sort());
  });

  it("never shows an empty compact presentation when the room is unknown", () => {
    const layout = QueueActivityLayout(
      queue({
        phase: "called",
        position: null,
        etaMinutes: null,
        roomName: null,
        calledAt: "2026-02-20T10:00:00.000Z",
      }),
      environment,
    );
    // The count-up since the call stands in for the room.
    expect(nodes(layout.compactTrailing, "Text")[0]?.props?.timerInterval).toBeTruthy();
    expect(nodes(layout.minimal, "Image")).toHaveLength(1);
  });

  it.each([
    // Waiting: (total - position + 1) / (total + 1) of the first segment,
    // split over its two units.
    [{ position: 1, queueTotal: 10 }, [1, 9 / 11, 0]],
    [{ position: 5, queueTotal: 10 }, [1, 1 / 11, 0]],
    [{ position: 10, queueTotal: 10 }, [2 / 11, 0, 0]],
    // Older server, or a position outside the total: the stage only.
    [{ position: 4, queueTotal: null }, [0, 0, 0]],
    [{ position: 4 }, [0, 0, 0]],
    [{ position: 12, queueTotal: 9 }, [0, 0, 0]],
    [{ position: 4, queueTotal: 0 }, [0, 0, 0]],
  ] as const)("fills the queue track from the queue size (%o)", (overrides, expected) => {
    const fill = trackFill(QueueActivityLayout(queue(overrides), environment));
    expect(fill).toHaveLength(3);
    for (const [index, value] of fill.entries()) expect(value).toBeCloseTo(expected[index]!, 5);
  });

  const called = { phase: "called", position: null, etaMinutes: null, roomName: "Room B" } as const;

  it.each([
    // Called: 2 / (calledAhead + 3) of the second segment.
    [0, 2 / 3],
    [1, 1 / 2],
    [3, 1 / 3],
    [undefined, 0],
  ])("fills the called segment from the teams called ahead (%p)", (calledAhead, expected) => {
    const fill = trackFill(QueueActivityLayout(queue({ ...called, calledAhead }), environment));
    expect(fill.slice(0, 2)).toEqual([1, 1]);
    expect(fill[2]).toBeCloseTo(expected, 5);
  });

  it("completes the track once in the room", () => {
    const inRoom = queue({ ...called, phase: "in_room", calledAhead: 2 });
    expect(trackFill(QueueActivityLayout(inRoom, environment))).toEqual([1, 1, 1]);
  });

  it("labels each track node only when the stage names arrive", () => {
    const withNames = texts(QueueActivityLayout(queue(), environment).banner);
    expect(withNames).toEqual(expect.arrayContaining(["In line", "Called", "In room"]));
  });

  it("shows the server's placeholder for an unknown ETA, never a dash", () => {
    const layout = QueueActivityLayout(queue({ etaMinutes: null }), environment);
    expect(texts(layout.banner)).toContain("Estimating…");
    expect(texts(layout.expandedTrailing)).toContain("Estimating…");
    expect(texts(layout.banner)).not.toContain("–");
  });

  it("omits post-v1 elements instead of inventing copy when an older server sends v1 labels", () => {
    const {
      called: _called,
      estimating: _estimating,
      stageInLine: _inLine,
      stageCalled: _stageCalled,
      stageInRoom: _inRoom,
      ...v1Labels
    } = queueLiveLabels("es", 0);
    const waiting = QueueActivityLayout(queue({ etaMinutes: null, labels: v1Labels }), environment);
    const shown = SLOTS.flatMap((slot) => texts(waiting[slot]));
    expect(shown.join(" ")).not.toMatch(/Estimating|Calculando|In line|Called|En cola/);
    expect(shown).toContain("#4");

    const called = QueueActivityLayout(
      queue({
        phase: "called",
        position: null,
        etaMinutes: null,
        roomName: "Sala B",
        calledAt: "2026-02-20T10:00:00.000Z",
        labels: v1Labels,
      }),
      environment,
    );
    expect(SLOTS.flatMap((slot) => texts(called[slot])).join(" ")).not.toMatch(/Called|Llamados/);
  });

  it.each([
    activity(),
    activity({ phase: "live", scanned: 37, location: "Cafeteria" }),
    activity({ updatedAt: "not a date" }),
    activity({ phase: "live", scanned: 142, accredited: 180, location: "Cafeteria" }),
    activity({ phase: "live", scanned: 3, accredited: 0 }),
    activity({ phase: "live", scanned: 5, endsAt: "not a date" }),
    activity({
      phase: "live",
      scanned: 5,
      labels: { startsIn: "Empieza en", scanned: "Escaneados", scan: "Escanear" },
    }),
  ])("builds every staff presentation (%#)", (props) => {
    const layout = StaffActivityLayout(props, environment);
    expect(Object.keys(layout).sort()).toEqual([...SLOTS].sort());
  });

  it("shows scanned out of accredited, with the share as the ring and the bar", () => {
    const layout = StaffActivityLayout(
      activity({ phase: "live", scanned: 42, accredited: 180 }),
      environment,
    );
    // Compact: a short "42/180" whose denominator is the secondary part.
    expect(texts(layout.compactTrailing)).toEqual(["42", "/180"]);
    expect(nodes(layout.minimal, "Gauge")[0]?.props?.value).toBeCloseTo(42 / 180, 5);
    expect(texts(layout.expandedTrailing)).toEqual(["Scanned", "42", "/180"]);
    expect(texts(layout.banner)).toEqual(expect.arrayContaining(["Scanned", "42", "/180"]));
    expect(nodes(layout.banner, "ProgressView")[0]?.props?.value).toBeCloseTo(42 / 180, 5);
    expect(texts(layout.bannerSmall)).toEqual(expect.arrayContaining(["42", "/180"]));

    // More scans than accredited people (a badge removed later) fills the ring.
    const over = StaffActivityLayout(
      activity({ phase: "live", scanned: 200, accredited: 180 }),
      environment,
    );
    expect(nodes(over.minimal, "Gauge")[0]?.props?.value).toBe(1);
  });

  it("keeps the bare scanned count without a denominator", () => {
    for (const accredited of [undefined, null, 0]) {
      const layout = StaffActivityLayout(
        activity({ phase: "live", scanned: 37, accredited }),
        environment,
      );
      expect(texts(layout.compactTrailing)).toEqual(["37"]);
      expect(texts(layout.minimal)).toEqual(["37"]);
      expect(nodes(layout.minimal, "Gauge")).toHaveLength(0);
    }
  });

  it("keeps the countdown while upcoming, whatever the counts", () => {
    const layout = StaffActivityLayout(activity({ scanned: 0, accredited: 180 }), environment);
    expect(nodes(layout.compactTrailing, "Text")[0]?.props?.timerInterval).toBeTruthy();
    expect(nodes(layout.minimal, "Gauge")).toHaveLength(0);
  });

  it("offers the single Scan action only while live", () => {
    const upcoming = StaffActivityLayout(activity(), environment);
    expect(SLOTS.flatMap((slot) => nodes(upcoming[slot], "Link"))).toHaveLength(0);
    const live = StaffActivityLayout(activity({ phase: "live", scanned: 3 }), environment);
    expect(nodes(live.banner, "Link")).toHaveLength(1);
    expect(nodes(live.bannerSmall, "Link")).toHaveLength(0);
    // Without a denominator the bar tracks elapsed time instead of a share.
    expect(nodes(live.banner, "ProgressView")[0]?.props?.timerInterval).toBeTruthy();
  });

  it("degrades a future props version to its title instead of reading unknown fields", () => {
    const future = {
      v: 2,
      kind: "queue",
      challengeTitle: "Open data",
    } as unknown as QueueLiveProps;
    const queueLayout = QueueActivityLayout(future, environment);
    expect(texts(queueLayout.banner)).toEqual(["Open data"]);

    const futureStaff = { v: 2, kind: "activity", name: "Lunch" } as unknown as ActivityLiveProps;
    const staffLayout = StaffActivityLayout(futureStaff, environment);
    expect(texts(staffLayout.banner)).toEqual(["Lunch"]);
  });
});

// ── Attendee, deadline and accreditation kinds (H59, H19, H22) ──

const NOW = Date.parse("2026-02-20T12:00:00.000Z");

function attendee(overrides: Partial<AttendeeActivityLiveProps> = {}): AttendeeActivityLiveProps {
  return {
    v: 1,
    kind: "attendee_activity",
    phase: "upcoming",
    scheduleId: 21,
    name: "Rust workshop",
    category: "workshop",
    location: "Room A2",
    startsAt: "2026-02-20T12:10:00.000Z",
    endsAt: "2026-02-20T13:10:00.000Z",
    url: "hackos://schedule/21",
    labels: attendeeActivityLiveLabels("en"),
    updatedAt: "2026-02-20T12:00:00.000Z",
    ...overrides,
  };
}

function deadline(overrides: Partial<DeadlineLiveProps> = {}): DeadlineLiveProps {
  return {
    v: 1,
    kind: "deadline",
    phase: "open",
    startsAt: "2026-02-19T00:00:00.000Z",
    endsAt: "2026-02-20T14:00:00.000Z",
    submission: "draft",
    projectName: "Tidewatch",
    url: "hackos://project",
    labels: deadlineLiveLabels("en"),
    updatedAt: "2026-02-20T12:00:00.000Z",
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
    endsAt: "2026-02-20T13:00:00.000Z",
    scanUrl: "hackos://scan",
    url: "hackos://scan",
    labels: accreditationLiveLabels("en"),
    updatedAt: "2026-02-20T12:00:00.000Z",
    ...overrides,
  };
}

function allTexts(layout: Record<string, unknown>): string[] {
  return SLOTS.flatMap((slot) => texts(layout[slot]));
}

/** Every `foregroundStyle` colour applied within a presentation. */
function colors(node: unknown): string[] {
  if (node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(colors);
  const current = node as Node;
  const own = ((current.props?.modifiers as { modifier: string; args: unknown[] }[]) ?? [])
    .filter((modifier) => modifier?.modifier === "foregroundStyle")
    .map((modifier) => {
      const [color] = modifier.args;
      return typeof color === "string" ? color : JSON.stringify(color);
    });
  const image = typeof current.props?.color === "string" ? [current.props.color as string] : [];
  return [...own, ...image, ...colors(current.props?.children)];
}

describe("New Live Activity kinds (#966)", () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ["attendee", AttendeeActivityLayout, attendee()],
    [
      "attendee live",
      AttendeeActivityLayout,
      attendee({ phase: "live", startsAt: "2026-02-20T11:40:00.000Z" }),
    ],
    ["attendee no place", AttendeeActivityLayout, attendee({ location: null, updatedAt: "bad" })],
    ["attendee bad dates", AttendeeActivityLayout, attendee({ phase: "live", endsAt: "bad" })],
    ["deadline open", DeadlineActivityLayout, deadline()],
    ["deadline unknown", DeadlineActivityLayout, deadline({ submission: null, projectName: null })],
    ["deadline no start", DeadlineActivityLayout, deadline({ startsAt: null })],
    ["deadline closing", DeadlineActivityLayout, deadline({ phase: "closing" })],
    [
      "deadline submitted",
      DeadlineActivityLayout,
      deadline({ phase: "submitted", submission: "submitted" }),
    ],
    ["accreditation", AccreditationActivityLayout, accreditation()],
    [
      "accreditation no estimate",
      AccreditationActivityLayout,
      accreditation({ inside: null, eligible: 0 }),
    ],
  ] as [
    string,
    Layout<never>,
    unknown,
  ][])("builds every presentation: %s", (_name, layout, props) => {
    const built = layout(props as never, environment);
    expect(Object.keys(built).sort()).toEqual([...SLOTS].sort());
  });

  describe("attendee activity (H59)", () => {
    it("counts down to the start, then shows Now with an elapsed-time bar", () => {
      const upcoming = AttendeeActivityLayout(attendee(), environment);
      expect(texts(upcoming.banner)).toEqual(
        expect.arrayContaining(["Starts in", "Rust workshop"]),
      );
      expect(nodes(upcoming.banner, "ProgressView")).toHaveLength(0);
      const [countdown] = nodes(upcoming.compactTrailing, "Text");
      expect((countdown?.props?.timerInterval as { upper: Date }).upper).toEqual(
        new Date("2026-02-20T12:10:00.000Z"),
      );

      const live = AttendeeActivityLayout(
        attendee({ phase: "live", startsAt: "2026-02-20T11:40:00.000Z" }),
        environment,
      );
      expect(texts(live.banner)).toEqual(expect.arrayContaining(["Now", "Ends in"]));
      expect(nodes(live.banner, "ProgressView")[0]?.props?.timerInterval).toBeTruthy();
      expect(nodes(live.minimal, "ProgressView")[0]?.props?.timerInterval).toBeTruthy();
    });

    it("has no buttons on any presentation", () => {
      const live = AttendeeActivityLayout(attendee({ phase: "live" }), environment);
      expect(SLOTS.flatMap((slot) => nodes(live[slot], "Link"))).toHaveLength(0);
    });

    it("omits the labels a payload lacks instead of inventing copy", () => {
      const live = AttendeeActivityLayout(
        attendee({
          phase: "live",
          labels: { startsIn: "", now: "", endsIn: "" } as AttendeeActivityLiveProps["labels"],
        }),
        environment,
      );
      expect(allTexts(live).join(" ")).not.toMatch(/Now|Ends in|Starts in/);
      expect(allTexts(live)).toContain("Rust workshop");
    });
  });

  describe("submission deadline (H19)", () => {
    it("shows a known draft as not submitted and an unknown status not at all", () => {
      const draft = DeadlineActivityLayout(deadline(), environment);
      expect(texts(draft.banner)).toEqual(
        expect.arrayContaining(["Submissions close", "Closes in", "Tidewatch", "Not submitted"]),
      );
      // The window's elapsed share is a real timer bar.
      expect(nodes(draft.banner, "ProgressView")[0]?.props?.timerInterval).toBeTruthy();

      const unknown = DeadlineActivityLayout(
        deadline({ submission: null, projectName: null }),
        environment,
      );
      expect(allTexts(unknown).join(" ")).not.toMatch(/Not submitted|Submitted/);
    });

    it("turns red while closing and calm green once submitted", () => {
      const closing = DeadlineActivityLayout(deadline({ phase: "closing" }), environment);
      expect(colors(closing.compactLeading)).toContain("#FF453A");
      expect(texts(closing.bannerSmall)).toContain("Not submitted");

      const submitted = DeadlineActivityLayout(
        deadline({ phase: "submitted", submission: "submitted" }),
        environment,
      );
      expect(colors(submitted.compactLeading)).toContain("#30D158");
      expect(texts(submitted.banner)).toEqual(expect.arrayContaining(["Submitted", "Closes in"]));
      expect(texts(submitted.bannerSmall)).toContain("Submitted");
      // Calm: no urgency bar, the time left stays small.
      expect(nodes(submitted.banner, "ProgressView")).toHaveLength(0);
    });

    it("works without a window start (no bar, plain minimal symbol)", () => {
      const layout = DeadlineActivityLayout(deadline({ startsAt: null }), environment);
      expect(nodes(layout.banner, "ProgressView")).toHaveLength(0);
      expect(nodes(layout.minimal, "Image")).toHaveLength(1);
    });
  });

  describe("accreditation desk (H22)", () => {
    it("leads with accredited of eligible, a bar of that share and recent arrivals", () => {
      const layout = AccreditationActivityLayout(accreditation(), environment);
      expect(texts(layout.banner)).toEqual(
        expect.arrayContaining([
          "Accredited",
          "412",
          "/600",
          "Last 10 min",
          "+23",
          "Inside",
          "380",
        ]),
      );
      expect(nodes(layout.banner, "ProgressView")[0]?.props?.value).toBeCloseTo(412 / 600, 5);
      expect(nodes(layout.minimal, "Gauge")[0]?.props?.value).toBeCloseTo(412 / 600, 5);
      expect(texts(layout.compactTrailing)).toEqual(["412"]);
    });

    it("offers the single Scan action, never on the watch", () => {
      const layout = AccreditationActivityLayout(accreditation(), environment);
      expect(nodes(layout.banner, "Link")).toHaveLength(1);
      expect(nodes(layout.expandedBottom, "Link")).toHaveLength(1);
      expect(nodes(layout.bannerSmall, "Link")).toHaveLength(0);
      expect(nodes(layout.banner, "Link")[0]?.props?.destination).toBe("hackos://scan");
    });

    it("drops the inside estimate and the ring when they are unknown", () => {
      const layout = AccreditationActivityLayout(
        accreditation({ inside: null, eligible: 0 }),
        environment,
      );
      expect(texts(layout.banner)).not.toContain("Inside");
      expect(nodes(layout.minimal, "Gauge")).toHaveLength(0);
      expect(nodes(layout.banner, "ProgressView")).toHaveLength(0);
    });
  });

  it("drops accent colours on the Always-On Lock Screen", () => {
    const reduced = { colorScheme: "dark", isLuminanceReduced: true } as LiveActivityEnvironment;
    const layout = DeadlineActivityLayout(deadline({ phase: "closing" }), reduced);
    expect(colors(layout.banner).filter((color) => color.includes("dynamic"))).toEqual([]);
  });

  it("degrades a future props version to its title", () => {
    const future = (kind: string, extra: object) => ({ v: 2, kind, ...extra }) as never;
    expect(
      texts(
        AttendeeActivityLayout(future("attendee_activity", { name: "Talk" }), environment).banner,
      ),
    ).toEqual(["Talk"]);
    expect(Object.keys(DeadlineActivityLayout(future("deadline", {}), environment)).sort()).toEqual(
      [...SLOTS].sort(),
    );
    expect(
      Object.keys(AccreditationActivityLayout(future("accreditation", {}), environment)).sort(),
    ).toEqual([...SLOTS].sort());
  });
});
