import { screen, waitFor } from "@testing-library/react-native";

/**
 * H374 — the schedule opens on "what's happening now", not on day 1.
 *
 * Three separate defects used to make this never fire on device, and each of
 * them is asserted here:
 *  1. `scrollToLocation`'s itemIndex counts the section header as 0, so the raw
 *     `section.data` index landed one card too high.
 *  2. `onScrollToIndexFailed` only re-issued the same doomed call — the list
 *     never moves, so it never measures new rows. It must jump to the estimated
 *     offset first.
 *  3. "tabPress" is emitted targeted at the *screen's* route key, so the
 *     listener has to live on this screen's own navigation object.
 */

const mockPush = jest.fn();
const mockScrollCalls: { sectionIndex: number; itemIndex: number; animated?: boolean }[] = [];
const mockScrollToCalls: { y: number }[] = [];
const mockTabPressListeners: (() => void)[] = [];
let mockFailNextScroll = false;
/** "tabPress" fires before the tab switch, so this is true only for a second
 * press on an already-open Schedule. */
let mockIsFocused = false;

jest.mock("react-native", () => {
  const RN = jest.requireActual("react-native");
  const React = require("react");
  const Actual = RN.SectionList;
  const Spy = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    // Untyped on purpose: babel-plugin-jest-hoist rejects the parameter names
    // in a function type annotation written inside a jest.mock factory.
    const onFail = props.onScrollToIndexFailed;
    React.useImperativeHandle(ref, () => ({
      scrollToLocation: (params: {
        sectionIndex: number;
        itemIndex: number;
        animated?: boolean;
      }) => {
        mockScrollCalls.push(params);
        if (mockFailNextScroll && typeof onFail === "function") {
          mockFailNextScroll = false;
          onFail({ averageItemLength: 100, highestMeasuredFrameIndex: 2, index: 12 });
        }
      },
      getScrollResponder: () => ({
        scrollTo: (params: { y: number }) => mockScrollToCalls.push(params),
      }),
    }));
    return React.createElement(Actual, props);
  });
  Spy.displayName = "SectionListSpy";
  return new Proxy(RN, {
    get: (target, prop, receiver) =>
      prop === "SectionList" ? Spy : Reflect.get(target, prop, receiver),
  });
});

jest.mock("expo-router", () => ({
  useFocusEffect: () => {},
  useNavigation: () => ({
    setOptions: jest.fn(),
    // The real screen-level navigation object react-navigation hands a tab
    // screen: `tabPress` is delivered here, targeted at this route's key.
    isFocused: () => mockIsFocused,
    addListener: (type: string, callback: () => void) => {
      if (type === "tabPress") mockTabPressListeners.push(callback);
      return () => {};
    },
  }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("expo-router/stack", () => ({ __esModule: true, default: { Screen: () => null } }));
jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: jest.fn(),
}));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 1, capabilities: [] } }),
}));
jest.mock("@/lib/use-android-top-inset", () => ({ useAndroidTopInset: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => ({
  __esModule: true,
  default: ({ children }: { children: unknown }) => {
    const ReactLib = require("react");
    return ReactLib.createElement(ReactLib.Fragment, null, children);
  },
}));
jest.mock("react-native-reanimated", () => ({
  __esModule: true,
  default: {
    View: ({ children }: { children: unknown }) => {
      const ReactLib = require("react");
      return ReactLib.createElement(ReactLib.Fragment, null, children);
    },
  },
  interpolate: () => 1,
  useAnimatedStyle: (factory: () => unknown) => factory(),
}));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({ language: "en", t: (key: string) => key }),
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    background: "#f5f5f7",
    label: "#171717",
    secondaryLabel: "#5f6368",
    separator: "#d1d1d6",
    surface: "#ffffff",
    tertiaryLabel: "#7c7c80",
  },
}));

import ScheduleScreen from "@/app/(tabs)/schedule";
import { apiFetch } from "@/lib/api";
import { renderMobile } from "./render";

const preferences = { channels: ["push"], mandatoryCategories: [], overrides: [] };

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function entry(id: number, title: string, startMinutes: number, endMinutes: number) {
  return {
    id,
    title,
    description: null,
    location: null,
    audiences: [],
    owners: [],
    type: "other",
    startsAt: minutesFromNow(startMinutes),
    endsAt: minutesFromNow(endMinutes),
  };
}

// Yesterday's section pushes today's rows past what a fresh list has measured.
const items = [
  entry(101, "Yesterday A", -24 * 60 - 120, -24 * 60 - 90),
  entry(102, "Yesterday B", -24 * 60 - 60, -24 * 60 - 30),
  entry(1, "Earlier today", -180, -150),
  entry(2, "Happening now", -10, 50),
  entry(3, "Later today", 180, 210),
];

beforeEach(() => {
  jest.clearAllMocks();
  mockScrollCalls.length = 0;
  mockScrollToCalls.length = 0;
  mockTabPressListeners.length = 0;
  mockFailNextScroll = false;
  mockIsFocused = false;
  (apiFetch as jest.Mock).mockImplementation((path: string) => {
    if (path === "/api/public/activities") return Promise.resolve({ items });
    if (path === "/api/me/notification-preferences") return Promise.resolve(preferences);
    return Promise.resolve({});
  });
});

describe("schedule scroll-to-active (H374)", () => {
  it("targets the active card, offset by the section header", async () => {
    await renderMobile(<ScheduleScreen />);
    await screen.findByText("Happening now");

    await waitFor(() => expect(mockScrollCalls.length).toBeGreaterThan(0));
    // Today is the second section; "Happening now" is at data index 1, which is
    // itemIndex 2 once the section header takes slot 0. The list should *open*
    // there rather than animate from a position the user never saw.
    expect(mockScrollCalls[0]).toMatchObject({
      animated: false,
      itemIndex: 2,
      sectionIndex: 1,
    });
  });

  it("jumps to the estimated offset before retrying an unmeasured target", async () => {
    mockFailNextScroll = true;
    await renderMobile(<ScheduleScreen />);
    await screen.findByText("Happening now");

    await waitFor(() => expect(mockScrollToCalls.length).toBeGreaterThan(0));
    // averageItemLength 100 * index 12, less the 80pt viewOffset.
    expect(mockScrollToCalls[0].y).toBe(1120);
    await waitFor(() => expect(mockScrollCalls.length).toBeGreaterThan(1));
  });

  it("animates back to the active card when Schedule is tapped while already open", async () => {
    await renderMobile(<ScheduleScreen />);
    await screen.findByText("Happening now");
    await waitFor(() => expect(mockTabPressListeners.length).toBeGreaterThan(0));
    // Let the mount scroll land first, so the counts below are only about the
    // tab press.
    await waitFor(() => expect(mockScrollCalls.length).toBeGreaterThan(0));
    const before = mockScrollCalls.length;

    mockIsFocused = true;
    mockTabPressListeners[mockTabPressListeners.length - 1]();

    await waitFor(() => expect(mockScrollCalls.length).toBeGreaterThan(before));
    expect(mockScrollCalls[mockScrollCalls.length - 1]).toMatchObject({
      animated: true,
      itemIndex: 2,
      sectionIndex: 1,
    });
  });

  it("leaves the list where it was when returning from another tab", async () => {
    await renderMobile(<ScheduleScreen />);
    await screen.findByText("Happening now");
    await waitFor(() => expect(mockTabPressListeners.length).toBeGreaterThan(0));
    // Let the mount scroll land first, so the counts below are only about the
    // tab press.
    await waitFor(() => expect(mockScrollCalls.length).toBeGreaterThan(0));
    const before = mockScrollCalls.length;

    // Not focused yet: this press is the switch *back* to Schedule.
    mockTabPressListeners[mockTabPressListeners.length - 1]();

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(mockScrollCalls.length).toBe(before);
  });
});
