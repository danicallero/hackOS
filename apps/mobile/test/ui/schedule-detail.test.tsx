import { screen } from "@testing-library/react-native";
import type { ScheduleItem } from "@/lib/schedule";

const mockLoad = jest.fn();
const mockNotificationLoad = jest.fn();
const mockFetchAdminSchedule = jest.fn();

type MockScheduleItem = ScheduleItem & { requiresScan?: boolean };

const mockActivity: MockScheduleItem = {
  id: 1,
  title: "Conecta 4 powered by Gradiente Labs and the community",
  description: "A long activity title should remain readable on a narrow phone.",
  location: "Aula 3.4",
  type: "talk",
  startsAt: "2026-08-29T20:00:00.000Z",
  endsAt: "2026-08-29T21:00:00.000Z",
  audiences: [],
  primaryLanguage: "en",
  titleI18n: {},
  descriptionI18n: {},
};

let mockSchedule: MockScheduleItem[] = [mockActivity];

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "1" }),
}));
jest.mock("expo-router/stack", () => ({
  __esModule: true,
  default: {
    Screen: () => null,
  },
}));
jest.mock("@/components/glass-view", () => ({ GlassView: () => null }));
jest.mock("@/components/native-ui", () => ({ EmptyState: () => null }));
jest.mock("@/components/RequestFeedback", () => ({ RequestFeedback: () => null }));
jest.mock("@/components/schedule-form-modal", () => ({
  ScheduleFormModal: () => null,
  scheduleItemToForm: jest.fn(),
  scheduleItemToTranslations: jest.fn(),
}));
jest.mock("@/components/stale-data-banner", () => ({ StaleDataBanner: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string) =>
      ({
        accountNotSet: "Not set",
        noLabel: "No",
        scheduleDetails: "Activity details",
        scheduleDescription: "Description",
        scheduleDuration: "Duration",
        scheduleFilterAudience: "Audience",
        scheduleInformation: "Information",
        scheduleLocation: "Location",
        schedulePublishAtLabel: "Scheduled publish time",
        scheduleRequiresScanLabel: "Requires check-in scan",
        scheduleStaffInformation: "Staff information",
        scheduleStaffOnlyBadge: "Staff only",
        scheduleTime: "Time",
        scheduleType: "Type",
        scheduleVisibilityLabel: "Visible",
        yesLabel: "Yes",
      })[key] ?? key,
  }),
}));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 1, capabilities: [] } }),
}));
jest.mock("@/lib/schedule", () => ({
  collapseBlankLines: (value: string) => value,
  fetchAdminSchedule: (...args: unknown[]) => mockFetchAdminSchedule(...args),
  fetchPublicSchedule: jest.fn(),
  resolveScheduleText: (value: typeof mockActivity) => ({
    title: value.title,
    description: value.description,
  }),
  scheduleDurationLabel: () => "1 h",
  scheduleTypeLabel: () => "Talk",
  updateScheduleItem: jest.fn(),
  upsertScheduleItem: jest.fn(),
}));
jest.mock("@/lib/tabs", () => ({ has: () => false }));
jest.mock("@/lib/use-cached-api", () => ({
  useCachedApi: () => ({
    data: mockSchedule,
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
    load: mockNotificationLoad,
    isEntrySubscribed: () => false,
    savingKey: null,
    error: null,
    retry: jest.fn(),
    toggleEntry: jest.fn(),
  }),
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    background: "#f5f5f7",
    label: "#171717",
    secondaryLabel: "#5f6368",
    separator: "#d1d1d6",
    surface: "#ffffff",
  },
}));

import ScheduleDetailScreen from "@/app/schedule/[id]";
import { renderMobile } from "./render";

describe("schedule detail staff fields (H59)", () => {
  beforeEach(() => {
    mockSchedule = [mockActivity];
    mockFetchAdminSchedule.mockResolvedValue([]);
    jest.clearAllMocks();
  });

  it("hides scan, visibility, and publish fields for staff-only items", async () => {
    mockSchedule = [
      {
        ...mockActivity,
        title: "Staff briefing",
        notes: null,
        requiresScan: true,
        visibility: "hidden" as const,
        publishAt: null,
      },
    ];

    await renderMobile(<ScheduleDetailScreen />);

    expect(await screen.findByText("Staff information")).toBeTruthy();
    expect(screen.getByText("Staff only")).toBeTruthy();
    expect(screen.queryByText("Requires check-in scan")).toBeNull();
    expect(screen.queryByText("Visible")).toBeNull();
    expect(screen.queryByText("Scheduled publish time")).toBeNull();
  });

  it("does not show a spent publish date once the item is visible", async () => {
    mockSchedule = [
      {
        ...mockActivity,
        title: "Participant talk",
        audiences: ["participant" as const],
        notes: null,
        visibility: "shown" as const,
        publishAt: "2026-08-29T18:00:00.000Z",
      },
    ];

    await renderMobile(<ScheduleDetailScreen />);

    expect(await screen.findByText("Visible")).toBeTruthy();
    expect(screen.queryByText("Scheduled publish time")).toBeNull();
  });
});
