import { act, fireEvent, screen } from "@testing-library/react-native";
import { View } from "react-native";
import { ErrorNotice, OfflineNotice, resetStatusNoticeAttempts } from "@/components/status-notice";
import { renderMobile } from "./render";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({ language: "en", t: (key: string) => key }),
}));

describe("status notices", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetStatusNoticeAttempts();
  });
  afterEach(() => jest.useRealTimers());

  it("shows one offline notice when several requests on a screen fail", async () => {
    await renderMobile(
      <View>
        <OfflineNotice />
        <OfflineNotice updatedAt="2026-11-09T09:00:00Z" />
      </View>,
    );
    expect(screen.getAllByText(/offlineMode/)).toHaveLength(1);
  });

  it("merges an offline notice and a failed load into one that retries both", async () => {
    const reconnect = jest.fn().mockResolvedValue(true);
    const retry = jest.fn().mockResolvedValue(true);
    await renderMobile(
      <View>
        <OfflineNotice updatedAt="2026-11-09T07:00:00Z" onReconnect={reconnect} />
        <ErrorNotice message="Couldn't load" onRetry={retry} />
      </View>,
    );
    expect(screen.queryByText("Couldn't load")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await act(async () => fireEvent.press(screen.getByRole("button")));
    expect(reconnect).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows a spinner for a minimum time, then a cross, then the label again", async () => {
    const onReconnect = jest.fn().mockResolvedValue(false);
    await renderMobile(
      <OfflineNotice updatedAt="2026-11-09T08:00:00Z" onReconnect={onReconnect} />,
    );
    await act(async () => fireEvent.press(screen.getByRole("button")));
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button").props.accessibilityState).toMatchObject({ busy: true });
    await act(async () => jest.advanceTimersByTime(600));
    expect(screen.getByRole("button").props.accessibilityState).toMatchObject({ busy: false });
    // Inert while the cross shows, usable again after.
    await act(async () => fireEvent.press(screen.getByRole("button")));
    expect(onReconnect).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(3100));
    await act(async () => fireEvent.press(screen.getByRole("button")));
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it("renders a real failure as an alert with a retry action", async () => {
    const onRetry = jest.fn().mockResolvedValue(true);
    await renderMobile(<ErrorNotice message="Server error" onRetry={onRetry} />);
    expect(screen.getByText("Server error")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByLabelText("retry")));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
