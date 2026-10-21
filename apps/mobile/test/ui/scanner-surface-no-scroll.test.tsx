import { act, fireEvent, screen } from "@testing-library/react-native";
import { Dimensions } from "react-native";

jest.mock("expo-router", () => ({ useIsFocused: () => true }));
jest.mock("@/theme/colors", () => ({
  colors: new Proxy({}, { get: (_target, key) => (key === "__esModule" ? false : "black") }),
}));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/components/scanner-code-entry", () => ({ ScannerCodeEntry: () => null }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarBottomInset: () => 0 }));
jest.mock("@/components/scanner-action-button", () => ({
  ScannerActionButton: (props: { label: string; size?: string }) => {
    const { Text } = require("react-native");
    return <Text>{`${props.label}:${props.size}`}</Text>;
  },
}));

import { NfcScannerSurface } from "@/components/scanner-nfc-surface";
import { renderMobile } from "./render";

async function resize(height: number) {
  await act(async () => {
    fireEvent(screen.getByTestId("scanner-surface"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 440, height } },
    });
  });
}

describe("scanner surface (H22-H26)", () => {
  beforeEach(async () => {
    const window = Dimensions.get("window");
    await act(async () => {
      Dimensions.set({ window: { ...window, fontScale: 1 }, screen: { ...window, fontScale: 1 } });
    });
  });

  it("is never a scroll view and keeps every action when the pane is short", async () => {
    await renderMobile(
      <NfcScannerSurface
        onCamera={() => {}}
        onOpenPeople={() => {}}
        onValue={() => {}}
        scanningEnabled
      />,
    );
    expect(JSON.stringify(screen.toJSON())).not.toContain("RCTScrollView");

    await resize(800);
    expect(screen.getByText("scannerCamera:large")).toBeTruthy();

    await resize(330);
    for (const label of ["scannerViewPeople", "scannerCamera", "scannerEnterManually"]) {
      expect(screen.getByText(`${label}:compact`)).toBeTruthy();
    }
    expect(JSON.stringify(screen.toJSON())).not.toContain("RCTScrollView");
  });
});
