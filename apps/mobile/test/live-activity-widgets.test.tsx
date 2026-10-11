/**
 * #966 (H38, H25/H26): the iOS Live Activity layouts receive APNs props
 * directly, so they must build every presentation for edge-case and
 * future-version payloads without throwing.
 */

import * as SwiftUI from "@expo/ui/swift-ui";
import * as SwiftUIModifiers from "@expo/ui/swift-ui/modifiers";
import {
  type ActivityLiveProps,
  activityLiveLabels,
  type QueueLiveProps,
  queueLiveLabels,
} from "@hackos/shared/live-activities";
import type { LiveActivityEnvironment } from "expo-widgets";
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
    queue({ position: 4, startPosition: 9, calledAt: null }),
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
    // #4 after starting at #9: 5/9 of the first segment, split over its two units.
    [{ position: 4, startPosition: 9 }, [1, 1 / 9, 0]],
    // #1 of 4 → 0.75.
    [{ position: 1, startPosition: 4 }, [1, 0.5, 0]],
    // First sighting, unknown start, or a position behind the start: empty.
    [{ position: 9, startPosition: 9 }, [0, 0, 0]],
    [{ position: 4, startPosition: null }, [0, 0, 0]],
    [{ position: 4 }, [0, 0, 0]],
    [{ position: 12, startPosition: 9 }, [0, 0, 0]],
    [{ position: 4, startPosition: 0 }, [0, 0, 0]],
  ] as const)("fills the queue track from real progress only (%o)", (overrides, expected) => {
    const fill = trackFill(QueueActivityLayout(queue(overrides), environment));
    expect(fill).toHaveLength(3);
    for (const [index, value] of fill.entries()) expect(value).toBeCloseTo(expected[index]!, 5);
  });

  it("completes the track stage by stage once called and in the room", () => {
    const called = { position: null, etaMinutes: null, roomName: "Room B", startPosition: 9 };
    expect(
      trackFill(QueueActivityLayout(queue({ ...called, phase: "called" }), environment)),
    ).toEqual([1, 1, 0]);
    expect(
      trackFill(QueueActivityLayout(queue({ ...called, phase: "in_room" }), environment)),
    ).toEqual([1, 1, 1]);
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
    activity({ phase: "live", scanned: 142, inside: 310, remaining: 168, location: "Cafeteria" }),
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

  it("breaks a live meal down into served, still to eat and inside", () => {
    const layout = StaffActivityLayout(
      activity({ phase: "live", scanned: 142, inside: 310, remaining: 168 }),
      environment,
    );
    const banner = texts(layout.banner);
    expect(banner).toEqual(
      expect.arrayContaining(["Served", "142", "Still to eat", "168", "Inside", "310"]),
    );
    const [bar] = nodes(layout.banner, "ProgressView");
    expect(bar?.props?.value).toBeCloseTo((310 - 168) / 310, 5);
    expect(nodes(layout.minimal, "Gauge")[0]?.props?.value).toBeCloseTo((310 - 168) / 310, 5);
    // The question a meal answers: how many still to eat.
    expect(texts(layout.compactTrailing)).toEqual(["168"]);
  });

  it("keeps the scanned count when a meal's breakdown is missing or empty", () => {
    const missing = StaffActivityLayout(
      activity({ phase: "live", scanned: 37, inside: 310, remaining: null }),
      environment,
    );
    expect(texts(missing.compactTrailing)).toEqual(["37"]);
    expect(nodes(missing.minimal, "Gauge")).toHaveLength(0);

    const empty = StaffActivityLayout(
      activity({ phase: "live", scanned: 0, inside: 0, remaining: 0 }),
      environment,
    );
    // Nobody inside: no served-share bar, no ring.
    expect(
      nodes(empty.banner, "ProgressView").filter((bar) => "value" in (bar.props ?? {})),
    ).toHaveLength(0);
    expect(nodes(empty.minimal, "Gauge")).toHaveLength(0);
  });

  it("offers the single Scan action only while live", () => {
    const upcoming = StaffActivityLayout(activity(), environment);
    expect(SLOTS.flatMap((slot) => nodes(upcoming[slot], "Link"))).toHaveLength(0);
    const live = StaffActivityLayout(activity({ phase: "live", scanned: 3 }), environment);
    expect(nodes(live.banner, "Link")).toHaveLength(1);
    expect(nodes(live.bannerSmall, "Link")).toHaveLength(0);
    // A non-meal live activity tracks elapsed time instead of a share.
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
