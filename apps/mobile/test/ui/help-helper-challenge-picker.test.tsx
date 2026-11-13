import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Pressable as MockPressable, Text as MockText, View as MockView } from "react-native";

const mockBack = jest.fn();
const mockHelpMutation = jest.fn();
const mockSetData = jest.fn();
const mockProfile = {
  published: true,
  topics: [{ id: 4, name: "Docker" }],
  challengeIds: [2],
  challengeOptions: [
    { id: 1, name: "Best Beginner Hack" },
    { id: 2, name: "Best Use of AI" },
  ],
};

jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/help-desk", () => ({
  helpMutation: (...args: unknown[]) => mockHelpMutation(...args),
}));
jest.mock("@/lib/use-help-resource", () => ({
  useHelpResource: () => ({
    data: mockProfile,
    error: null,
    loading: false,
    load: jest.fn(),
    setData: mockSetData,
  }),
}));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/components/native-ui", () => ({
  EmptyState: ({ title }: { title: string }) => <MockText>{title}</MockText>,
  Section: ({ children }: { children: ReactNode }) => <MockView>{children}</MockView>,
  Separator: () => null,
}));
jest.mock("@/components/no-results-state", () => ({ NoResultsState: () => null }));
jest.mock("@/components/RequestFeedback", () => ({
  RequestFeedback: ({ error }: { error?: Error | null }) =>
    error ? <MockText>{error.message}</MockText> : null,
}));
jest.mock("@/components/searchable-picker", () => ({
  CheckRow: ({
    label,
    selected,
    onPress,
  }: {
    label: string;
    selected: boolean;
    onPress: () => void;
  }) => (
    <MockPressable accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} />
  ),
  SearchablePickerSheet: ({
    children,
    onConfirm,
  }: {
    children: ReactNode;
    onConfirm: () => void;
  }) => (
    <MockView>
      <MockPressable accessibilityLabel="confirm" onPress={onConfirm} />
      {children}
    </MockView>
  ),
}));

import { HelperChallengePickerScreen } from "@/components/help-desk/helper-challenge-picker-screen";
import { renderMobile } from "./render";

const selected = (label: string) => screen.getByLabelText(label).props.accessibilityState.selected;

describe("helper challenge alerts picker (H61)", () => {
  beforeEach(() => {
    mockBack.mockReset();
    mockHelpMutation.mockReset();
    mockSetData.mockReset();
  });

  it("shows the saved choice and closes without a request when nothing changed", async () => {
    await renderMobile(<HelperChallengePickerScreen />);
    expect(selected("Best Use of AI")).toBe(true);
    expect(selected("helpAlertsAll")).toBe(false);

    await fireEvent.press(screen.getByLabelText("confirm"));
    expect(mockHelpMutation).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("saves the edited draft with the rest of the profile, then closes", async () => {
    const saved = { ...mockProfile, challengeIds: [2, 1] };
    mockHelpMutation.mockResolvedValueOnce(saved);
    await renderMobile(<HelperChallengePickerScreen />);
    await fireEvent.press(screen.getByLabelText("Best Beginner Hack"));
    await fireEvent.press(screen.getByLabelText("confirm"));

    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    expect(mockHelpMutation).toHaveBeenCalledWith(
      "/api/me/helper-profile",
      { published: true, topicIds: [4], challengeIds: [2, 1] },
      "PUT",
    );
    expect(mockSetData).toHaveBeenCalledWith(saved);
  });

  it("clears every challenge with All requests and stays open when the save fails", async () => {
    mockHelpMutation.mockRejectedValueOnce(new Error("save failed"));
    await renderMobile(<HelperChallengePickerScreen />);
    await fireEvent.press(screen.getByLabelText("helpAlertsAll"));
    expect(selected("helpAlertsAll")).toBe(true);
    expect(selected("Best Use of AI")).toBe(false);

    await fireEvent.press(screen.getByLabelText("confirm"));
    expect(await screen.findByText("save failed")).toBeTruthy();
    expect(mockHelpMutation.mock.calls[0][1]).toMatchObject({ challengeIds: [] });
    expect(mockBack).not.toHaveBeenCalled();
  });
});
