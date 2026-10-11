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

describe("Live Activity layouts (#966)", () => {
  it.each([
    queue(),
    queue({ position: null, etaMinutes: null }),
    queue({ phase: "called", position: null, etaMinutes: null, roomName: "Room B" }),
    queue({ phase: "called", position: null, etaMinutes: null, roomName: null }),
    queue({ phase: "in_room", position: null, etaMinutes: null, roomName: "Room B" }),
  ])("builds every queue presentation (%#)", (props) => {
    const layout = QueueActivityLayout(props, environment);
    expect(Object.keys(layout).sort()).toEqual([...SLOTS].sort());
  });

  it("never shows an empty minimal when the room is unknown", () => {
    const layout = QueueActivityLayout(
      queue({ phase: "called", position: null, etaMinutes: null, roomName: null }),
      environment,
    );
    expect(texts(layout.minimal).join("")).toBe("–");
  });

  it.each([
    activity(),
    activity({ phase: "live", scanned: 37, location: "Cafeteria" }),
    activity({ updatedAt: "not a date" }),
  ])("builds every staff presentation (%#)", (props) => {
    const layout = StaffActivityLayout(props, environment);
    expect(Object.keys(layout).sort()).toEqual([...SLOTS].sort());
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
