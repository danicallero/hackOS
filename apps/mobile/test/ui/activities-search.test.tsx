import { act, screen, waitFor } from "@testing-library/react-native";

const mockSetOptions = jest.fn();
const mockPush = jest.fn();
const mockListActivities = jest.fn();
const mockSync = jest.fn().mockResolvedValue(undefined);
let mockSyncing = false;

jest.mock("expo-router", () => ({
  useFocusEffect: () => {},
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("@expo/ui/community/menu", () => ({
  MenuView: ({ children }: { children: unknown }) => {
    const ReactLib = require("react");
    return ReactLib.createElement(ReactLib.Fragment, null, children);
  },
}));
jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: jest.fn(),
}));
jest.mock("@/lib/scanner-db", () => ({ listScannerActivities: () => mockListActivities() }));
jest.mock("@/lib/use-scanner", () => ({
  useScannerSync: () => ({
    autoRetryPaused: false,
    error: null,
    lastSync: null,
    sync: mockSync,
    syncing: mockSyncing,
  }),
}));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string) =>
      ({
        scannerActivitiesNext: "Next",
        scannerActivitiesNoMatches: "No matching activities",
        scannerActivitiesNoMatchesBody: "Try another search term.",
        scheduleNow: "Now",
        typeMeal: "Meal",
        typeTalk: "Talk",
      })[key] ?? key,
  }),
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    accentSurface: "#eaf2ff",
    elevatedSurface: "#ffffff",
    label: "#171717",
    secondaryLabel: "#5f6368",
    tertiaryLabel: "#7c7c80",
    transparent: "transparent",
    warning: "#b25000",
    warningSurface: "#fff4e5",
  },
}));

import { ActivitiesScreen } from "@/components/activities-screen";
import type { ScannerActivity } from "@/lib/scanner-types";
import { renderMobile } from "./render";

const NOW = Date.parse("2026-08-22T12:00:00.000Z");
const hours = (offset: number) => new Date(NOW + offset * 3600_000).toISOString();

const ACTIVITIES: ScannerActivity[] = [
  { id: 1, name: "Cena Sábado", category: "meal", requiresScan: true, startsAt: hours(-0.25) },
  { id: 2, name: "Charla Grafana", category: "talk", requiresScan: true, startsAt: hours(2) },
  { id: 3, name: "Comida Domingo", category: "meal", requiresScan: true, startsAt: hours(20) },
];

/** Drives the native `headerSearchBarOptions` search bar the screen installs. */
async function search(text: string) {
  const options = mockSetOptions.mock.calls.at(-1)?.[0];
  await act(async () => {
    options.headerSearchBarOptions.onChangeText({ nativeEvent: { text } });
  });
}

/** Picks an entry from the `headerRight` kind menu. */
async function chooseKind(id: string) {
  const options = mockSetOptions.mock.calls.at(-1)?.[0];
  const menu = options.headerRight();
  await act(async () => {
    menu.props.onPressAction({ nativeEvent: { event: id } });
  });
}

describe("activities list search, filter and now marker (H25, H26)", () => {
  beforeEach(() => {
    mockSyncing = false;
    mockSetOptions.mockClear();
    mockSync.mockClear();
    mockListActivities.mockReset().mockResolvedValue(ACTIVITIES);
    jest.useFakeTimers({ doNotFake: ["nextTick"], now: NOW });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("narrows the list by name", async () => {
    await renderMobile(<ActivitiesScreen />);
    await waitFor(() => expect(screen.getByText("Charla Grafana")).toBeTruthy());

    await search("grafana");

    expect(screen.getByText("Charla Grafana")).toBeTruthy();
    expect(screen.queryByText("Cena Sábado")).toBeNull();
  });

  it("offers the kinds actually present, and filters by the chosen one", async () => {
    await renderMobile(<ActivitiesScreen />);
    await waitFor(() => expect(screen.getByText("Charla Grafana")).toBeTruthy());

    expect(
      mockSetOptions.mock.calls
        .at(-1)?.[0]
        .headerRight()
        .props.actions.map((a: { id: string }) => a.id),
    ).toEqual(["all", "meal", "talk"]);

    await chooseKind("talk");

    expect(screen.getByText("Charla Grafana")).toBeTruthy();
    expect(screen.queryByText("Comida Domingo")).toBeNull();
  });

  it("falls back to a search-specific empty state", async () => {
    await renderMobile(<ActivitiesScreen />);
    await waitFor(() => expect(screen.getByText("Charla Grafana")).toBeTruthy());

    await search("nothing here");

    expect(screen.getByText("No matching activities")).toBeTruthy();
  });

  it("marks the running activity as Now and the following one as Next once it ends", async () => {
    await renderMobile(<ActivitiesScreen />);
    await waitFor(() => expect(screen.getByText("Charla Grafana")).toBeTruthy());

    expect(screen.getByText("Now")).toBeTruthy();
    expect(screen.queryByText("Next")).toBeNull();

    // Once every started activity is past the two-hour "still running"
    // window, the marker looks ahead to the next one instead.
    jest.setSystemTime(NOW + 5 * 3600_000);
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(screen.queryByText("Now")).toBeNull();
    expect(screen.getByText("Next")).toBeTruthy();
  });

  it("keeps the pull-to-refresh spinner out of the background sync tick", async () => {
    mockSyncing = true;
    await renderMobile(<ActivitiesScreen />);
    await waitFor(() => expect(screen.getByText("Charla Grafana")).toBeTruthy());

    const list = screen.getByTestId("activities-list");
    expect(list.props.refreshControl.props.refreshing).toBe(false);

    await act(async () => {
      list.props.refreshControl.props.onRefresh();
    });
    expect(mockSync).toHaveBeenCalled();
  });
});
