import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Pressable as MockPressable, Text as MockText, View as MockView } from "react-native";
import type { ScheduleItem } from "@/lib/schedule";

const mockFetchAdminSchedule = jest.fn();
const mockLoad = jest.fn();
const mockData: unknown[] = [];

const mockActivity = {
  id: 1,
  title: "Opening keynote",
  description: null,
  location: "Hall",
  type: "talk",
  startsAt: "2026-08-29T20:00:00.000Z",
  endsAt: "2026-08-29T21:00:00.000Z",
  audiences: ["participant"],
  primaryLanguage: "en",
  titleI18n: {},
  descriptionI18n: {},
} as unknown as ScheduleItem;
mockData.push(mockActivity);

jest.mock("expo-router", () => ({
  useFocusEffect: () => {},
  useLocalSearchParams: () => ({ id: "1" }),
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));
jest.mock("expo-router/stack", () => ({
  __esModule: true,
  default: { Screen: () => null, Toolbar: () => null },
}));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: ReactNode }) => <MockView>{children}</MockView>,
  isRealLiquidGlassAvailable: () => false,
}));
jest.mock("@/components/native-ui", () => ({
  AndroidDetailHeader: () => null,
  EmptyState: () => null,
  LegacyHeaderIconButton: () => null,
  useAndroidDetailHeaderInset: () => 0,
}));
jest.mock("@/components/RequestFeedback", () => ({
  RequestFeedback: ({ error, onRetry }: { error?: Error | null; onRetry?: () => void }) =>
    error ? (
      <MockView>
        <MockText>{error.message}</MockText>
        {onRetry ? <MockPressable accessibilityLabel="retry" onPress={onRetry} /> : null}
      </MockView>
    ) : null,
}));
jest.mock("@/components/schedule-form-modal", () => ({
  ScheduleFormModal: ({
    scheduleId,
    initialOwners,
  }: {
    scheduleId: number;
    initialOwners: unknown[];
  }) => <MockText>{`editor:${scheduleId}:owners=${initialOwners.length}`}</MockText>,
  scheduleItemToForm: () => ({}),
  scheduleItemToTranslations: () => ({}),
}));
jest.mock("@/components/stale-data-banner", () => ({ StaleDataBanner: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string) => ({ scheduleEdit: "Edit" })[key] ?? key,
  }),
}));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 1, capabilities: ["staff"] } }),
}));
jest.mock("@/lib/schedule", () => ({
  collapseBlankLines: (value: string) => value,
  fetchAdminSchedule: (...args: unknown[]) => mockFetchAdminSchedule(...args),
  fetchPublicSchedule: jest.fn(),
  resolveScheduleText: (value: { title: string; description: string | null }) => ({
    title: value.title,
    description: value.description,
  }),
  scheduleDurationLabel: () => "1 h",
  scheduleTypeLabel: () => "Talk",
  updateScheduleItem: jest.fn(),
  upsertScheduleItem: jest.fn(),
}));
jest.mock("@/lib/tabs", () => ({
  has: () => true,
  canManageSchedule: () => true,
  canReadFullSchedule: () => true,
}));
jest.mock("@/lib/use-cached-api", () => ({
  useCachedApi: () => ({
    data: mockData,
    loading: false,
    error: null,
    staleSince: null,
    load: mockLoad,
    setData: jest.fn(),
  }),
}));
jest.mock("@/lib/use-schedule-notifications", () => ({
  itemCategory: (id: number) => `schedule:${id}`,
  useScheduleNotifications: () => ({
    ready: false,
    load: jest.fn(),
    isEntrySubscribed: () => false,
    savingKey: null,
    error: null,
    retry: jest.fn(),
    toggleEntry: jest.fn(),
  }),
}));
jest.mock("@/theme/colors", () => ({
  colors: new Proxy({}, { get: () => "#000" }),
}));

import { ScheduleDetailScreen } from "@/components/schedule-detail-screen";
import { renderMobile } from "./render";

const adminCopy = { ...mockActivity, owners: [{ id: 1 }, { id: 2 }] };

describe("schedule detail: editing when the staff copy fails to load", () => {
  beforeEach(() => mockFetchAdminSchedule.mockReset());

  it("shows the failure with Retry, and Retry opens the editor on the real staff copy", async () => {
    // The screen's own load and the one Edit triggers both fail; the user's Retry succeeds.
    mockFetchAdminSchedule
      .mockRejectedValueOnce(new Error("staff copy unavailable"))
      .mockRejectedValueOnce(new Error("staff copy unavailable"))
      .mockResolvedValue([adminCopy]);
    await renderMobile(<ScheduleDetailScreen />);

    await fireEvent.press(await screen.findByLabelText("Edit"));
    expect(await screen.findByText("staff copy unavailable")).toBeTruthy();
    expect(screen.queryByText(/^editor:/)).toBeNull();

    await fireEvent.press(screen.getByLabelText("retry"));

    expect(await screen.findByText("editor:1:owners=2")).toBeTruthy();
    expect(screen.queryByText("staff copy unavailable")).toBeNull();
  });

  it("tapping Edit after a failed first load fetches the staff copy again and opens the editor", async () => {
    mockFetchAdminSchedule
      .mockRejectedValueOnce(new Error("staff copy unavailable"))
      .mockResolvedValue([adminCopy]);
    await renderMobile(<ScheduleDetailScreen />);

    await fireEvent.press(await screen.findByLabelText("Edit"));

    expect(await screen.findByText("editor:1:owners=2")).toBeTruthy();
  });

  it("does not open an editor on the public copy while the staff copy is still missing", async () => {
    mockFetchAdminSchedule.mockRejectedValue(new Error("staff copy unavailable"));
    await renderMobile(<ScheduleDetailScreen />);

    await fireEvent.press(await screen.findByLabelText("Edit"));
    await waitFor(() => expect(screen.getByText("staff copy unavailable")).toBeTruthy());
    expect(screen.queryByText(/^editor:/)).toBeNull();
  });
});
