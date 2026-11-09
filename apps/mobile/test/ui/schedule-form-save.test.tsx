import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Pressable as MockPressable, View as MockView } from "react-native";
import type { AdminScheduleItem } from "@/lib/schedule";

const mockAlert = jest.fn();
const mockSaveTranslations = jest.fn();

jest.mock("@/lib/auth-client", () => ({ authClient: {} }));
jest.mock("@/lib/api", () => ({ ApiError: class ApiError extends Error {}, apiFetch: jest.fn() }));
jest.mock("@/lib/alert", () => ({ alert: (...args: unknown[]) => mockAlert(...args) }));
jest.mock("@/components/app-menu", () => ({ MenuView: () => null }));
jest.mock("@/components/date-time-field", () => ({ DateTimeField: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/components/pressable-feedback", () => ({ PressableFeedback: () => null }));
jest.mock("@/components/app-activity-indicator", () => ({ AppActivityIndicator: () => null }));
jest.mock("@/components/native-ui", () => ({
  Section: ({ children }: { children: ReactNode }) => <MockView>{children}</MockView>,
  ToggleRow: () => null,
}));
jest.mock("@/components/form-modal-sections", () => ({
  FormModalShell: ({ children, onSave }: { children: ReactNode; onSave: () => void }) => (
    <MockView>
      <MockPressable accessibilityLabel="save-form" onPress={onSave} />
      {children}
    </MockView>
  ),
  FormModalPeoplePicker: () => null,
  FormModalTranslationsDisclosure: () => null,
}));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    language: "en",
    t: (key: string) =>
      ({
        scheduleTitleLabel: "Title",
        mobileStatesScheduleTranslationsError: "Saved, but the translations weren't.",
      })[key] ?? key,
  }),
}));
jest.mock("@/lib/schedule", () => ({
  ...jest.requireActual("@/lib/schedule"),
  fetchScheduleTranslateAvailability: jest.fn().mockResolvedValue(false),
  saveScheduleTranslations: (...args: unknown[]) => mockSaveTranslations(...args),
}));

import { ScheduleFormModal } from "@/components/schedule-form-modal";
import { renderMobile } from "./render";

const saved = { id: 42, title: "Opening" } as unknown as AdminScheduleItem;

const baseForm = {
  title: "Opening",
  description: null,
  location: null,
  type: "talk",
  requiresScan: false,
  startsAt: "2026-08-29T20:00:00.000Z",
  endsAt: "2026-08-29T21:00:00.000Z",
  visibility: "shown",
  publishAt: null,
  audiences: ["participant"],
  liveActivityAudience: false,
  contactNote: null,
  notes: null,
} as never;

describe("schedule form: new entry saved, translations failed", () => {
  beforeEach(() => {
    mockAlert.mockClear();
    mockSaveTranslations.mockReset();
  });

  it("closes on the saved entry and says the translations are missing, so a retry cannot create it twice", async () => {
    mockSaveTranslations.mockRejectedValue(new Error("translations down"));
    const onSubmit = jest.fn().mockResolvedValue(saved);
    const onSaved = jest.fn();
    await renderMobile(
      <ScheduleFormModal
        visible
        onClose={jest.fn()}
        initial={baseForm}
        initialTranslations={{ es: { title: "Apertura", description: null } }}
        onSubmit={onSubmit}
        onSaved={onSaved}
      />,
    );
    await fireEvent.press(screen.getByLabelText("save-form"));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(mockAlert).toHaveBeenCalledWith("Saved, but the translations weren't.");
    // The form handed the entry back instead of staying open in create mode.
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("reports the saved entry once when everything succeeds, with no warning", async () => {
    const withTranslations = { ...saved, titleI18n: { es: "Apertura" } } as AdminScheduleItem;
    mockSaveTranslations.mockResolvedValue(withTranslations);
    const onSaved = jest.fn();
    await renderMobile(
      <ScheduleFormModal
        visible
        onClose={jest.fn()}
        initial={baseForm}
        initialTranslations={{ es: { title: "Apertura", description: null } }}
        onSubmit={jest.fn().mockResolvedValue(saved)}
        onSaved={onSaved}
      />,
    );
    await fireEvent.press(screen.getByLabelText("save-form"));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(withTranslations));
    expect(mockAlert).not.toHaveBeenCalled();
  });
});
