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
const mockSetTopicSelection = jest.fn();
const mockSelection = {
  selected: [] as { id: number; name: string }[],
  maximum: 5,
  other: false,
  allowOther: false,
  allowAdd: false,
};
jest.mock("@/lib/help-topic-selection", () => ({
  setOtherSelection: jest.fn(),
  setTopicSelection: (...args: unknown[]) => mockSetTopicSelection(...args),
  useTopicSelection: () => mockSelection,
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

describe("help topic picker: what a request can ask for (H64)", () => {
  const backEnd = { id: 9, name: "Back End" };
  const docker = { id: 1, name: "Docker" };
  beforeEach(() => {
    jest.useFakeTimers();
    mockApiFetch.mockReset();
    mockSetTopicSelection.mockReset();
    mockApiFetch.mockResolvedValue({ topics: [docker] });
  });
  afterEach(() => {
    jest.useRealTimers();
    Object.assign(mockSelection, { selected: [], allowOther: false, allowAdd: false });
  });
  const open = async () => {
    await renderMobile(<HelpTopicPickerScreen />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10);
    });
  };

  it("offers a request only covered topics and drops a chosen one that lost its helper", async () => {
    Object.assign(mockSelection, { selected: [backEnd, docker], allowOther: true });
    await open();
    expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining("&available=1"));
    expect(mockSetTopicSelection).toHaveBeenCalledWith([docker]);
  });

  it("leaves a helper's own knowledge on the whole catalogue", async () => {
    Object.assign(mockSelection, { selected: [backEnd], allowAdd: true });
    await open();
    expect(mockApiFetch).toHaveBeenCalledWith(expect.not.stringContaining("available"));
    expect(mockSetTopicSelection).not.toHaveBeenCalled();
  });
});
