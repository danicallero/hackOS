import { fireEvent, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

import { UpgradeRequiredScreen } from "@/components/upgrade-required-screen";
import { renderMobile } from "./render";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

describe("UpgradeRequiredScreen (#999)", () => {
  it("blocks the app and sends the user to the store", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await renderMobile(<UpgradeRequiredScreen />);
    expect(screen.getByText("upgradeRequiredTitle")).toBeTruthy();
    fireEvent.press(screen.getByTestId("upgrade-required-action"));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^(itms-apps|market|https):/));
  });
});
