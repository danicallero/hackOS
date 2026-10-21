import { fireEvent, screen } from "@testing-library/react-native";
import { Alert, Platform } from "react-native";
import { AlertHost } from "@/components/alert-host";
import { BadgeReplacementDialog } from "@/components/badge-replacement-dialog.android";
import { currentAlert, dismissAlert } from "@/lib/alert";
import { renderMobile } from "./render";

jest.mock("@/lib/use-nfc-supported", () => ({ useNfcSupported: () => true }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));

beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "android");
});
afterEach(() => {
  jest.restoreAllMocks();
  while (currentAlert()) dismissAlert(currentAlert()?.id ?? 0);
});

describe("Android Apple-look replacements (H55, H59)", () => {
  it("shows the badge method dialog through AlertHost, not a Material dialog", async () => {
    const system = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const onSelect = jest.fn();
    await renderMobile(
      <>
        <AlertHost />
        <BadgeReplacementDialog visible onClose={jest.fn()} onSelect={onSelect} />
      </>,
    );
    expect(system).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Scan QR code"));
    expect(onSelect).toHaveBeenCalledWith("qr");
  });

  it("Cancel in the badge dialog closes it", async () => {
    const onClose = jest.fn();
    await renderMobile(
      <>
        <AlertHost />
        <BadgeReplacementDialog visible onClose={onClose} onSelect={jest.fn()} />
      </>,
    );
    await fireEvent.press(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
