import { act, fireEvent, screen } from "@testing-library/react-native";
import { OfflineScanningNote } from "@/components/offline-scanning-note";
import { renderMobile } from "./render";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

describe("OfflineScanningNote", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("shows Reconnect beside the note and returns to it after a failed attempt", async () => {
    const onReconnect = jest.fn().mockResolvedValue(false);
    await renderMobile(<OfflineScanningNote onReconnect={onReconnect} />);
    expect(screen.getByText("scannerOfflineScanning")).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByRole("button")));
    expect(onReconnect).toHaveBeenCalledTimes(1);
    // Failed: the label gives way to the red cross, and the control is inert meanwhile.
    expect(screen.queryByText("scannerReconnect")).toBeNull();
    await act(async () => fireEvent.press(screen.getByRole("button")));
    expect(onReconnect).toHaveBeenCalledTimes(1);

    await act(async () => jest.advanceTimersByTime(3100));
    expect(screen.getByText("scannerReconnect")).toBeTruthy();
  });

  it("is busy while reconnecting", async () => {
    let finish: (ok: boolean) => void = () => {};
    const onReconnect = jest.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    await renderMobile(<OfflineScanningNote onReconnect={onReconnect} />);
    await act(async () => fireEvent.press(screen.getByRole("button")));
    expect(screen.getByRole("button").props.accessibilityState).toMatchObject({ busy: true });
    await act(async () => finish(true));
    expect(screen.getByText("scannerReconnect")).toBeTruthy();
  });
});
