import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import {
  Pressable as MockPressable,
  Text as MockText,
  TextInput as MockTextInput,
  View as MockView,
} from "react-native";

const mockApiFetch = jest.fn();

jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/help-desk", () => ({ helpMutation: jest.fn() }));
jest.mock("@/lib/help-topic-selection", () => ({
  setOtherSelection: jest.fn(),
  setTopicSelection: jest.fn(),
  useTopicSelection: () => ({
    selected: [],
    maximum: 5,
    other: false,
    allowOther: false,
    allowAdd: false,
  }),
}));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string) => ({ helpNoTopics: "No matching topics", retry: "Retry" })[key] ?? key,
  }),
}));
jest.mock("@/components/native-ui", () => ({
  EmptyState: ({ title }: { title: string }) => <MockText>{title}</MockText>,
  Section: ({ children }: { children: ReactNode }) => <MockView>{children}</MockView>,
  Separator: () => null,
}));
jest.mock("@/components/project-ui", () => ({ NavRow: () => null }));
jest.mock("@/components/RequestFeedback", () => ({
  RequestFeedback: ({
    error,
    loading,
    onRetry,
  }: {
    error?: Error | null;
    loading?: boolean;
    onRetry?: () => void;
  }) =>
    loading ? (
      <MockText>loading</MockText>
    ) : error ? (
      <MockView>
        <MockText>{error.message}</MockText>
        {onRetry ? <MockPressable accessibilityLabel="retry" onPress={onRetry} /> : null}
      </MockView>
    ) : null,
}));
jest.mock("@/components/searchable-picker", () => ({
  CheckRow: ({ label }: { label: string }) => <MockText>{label}</MockText>,
  SearchablePickerSheet: ({
    children,
    onQuery,
  }: {
    children: ReactNode;
    onQuery: (query: string) => void;
  }) => (
    <MockView>
      <MockTextInput accessibilityLabel="search" onChangeText={onQuery} />
      {children}
    </MockView>
  ),
}));

import { HelpTopicPickerScreen } from "@/components/help-desk/topic-picker-screen";
import { renderMobile } from "./render";

describe("help topic picker: a failed search", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockApiFetch.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it("does not keep presenting the previous query's topics as the answer", async () => {
    mockApiFetch.mockResolvedValueOnce({ topics: [{ id: 1, name: "Docker" }] });
    await renderMobile(<HelpTopicPickerScreen />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
    expect(screen.getByText("Docker")).toBeTruthy();

    mockApiFetch.mockRejectedValueOnce(new Error("search failed"));
    await fireEvent.changeText(screen.getByLabelText("search"), "kub");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    await waitFor(() => expect(screen.getByText("search failed")).toBeTruthy());
    expect(screen.queryByText("Docker")).toBeNull();
    expect(screen.queryByText("No matching topics")).toBeNull();

    mockApiFetch.mockResolvedValueOnce({ topics: [{ id: 2, name: "Kubernetes" }] });
    await fireEvent.press(screen.getByLabelText("retry"));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    expect(await screen.findByText("Kubernetes")).toBeTruthy();
    expect(screen.queryByText("search failed")).toBeNull();
  });
});
