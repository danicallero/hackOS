import { fireEvent, screen } from "@testing-library/react-native";
import { renderMobile } from "./render";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  ...jest.requireActual("expo-router"),
  Stack: { Screen: () => null },
  useRouter: () => ({ push: mockPush }),
  useScrollToTop: jest.fn(),
}));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarScrollBottomInset: () => 0 }));
jest.mock("@/assets/licenses.json", () => [
  { name: "@scope/kit", version: "1.2.0", license: "MIT", text: "Copyright (c) 2026 Kit" },
  { name: "bare", version: "0.1.0", license: "ISC", text: null },
]);

const { LicenseScreen, LicensesScreen } =
  require("@/components/licenses-screen") as typeof import("@/components/licenses-screen");
const LegalScreen = (
  require("@/components/legal-screen") as typeof import("@/components/legal-screen")
).default;

describe("open-source licenses", () => {
  beforeEach(() => mockPush.mockReset());

  it("links from Legal", async () => {
    await renderMobile(<LegalScreen />);
    fireEvent.press(screen.getByLabelText("legalLicenses"));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/others/licenses");
  });

  it("lists every bundled package with its license and opens its notice", async () => {
    await renderMobile(<LicensesScreen />);
    expect(screen.getByText("@scope/kit")).toBeTruthy();
    expect(screen.getByText("ISC")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("@scope/kit, MIT"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(tabs)/others/licenses/[name]",
      params: { name: "@scope/kit" },
    });
  });

  it("shows the notice, or only the license id when the package ships none", async () => {
    await renderMobile(<LicenseScreen name="@scope/kit" />);
    expect(screen.getByText("1.2.0 · MIT")).toBeTruthy();
    expect(screen.getByText("Copyright (c) 2026 Kit")).toBeTruthy();

    await renderMobile(<LicenseScreen name="bare" />);
    expect(screen.getByText("0.1.0 · ISC")).toBeTruthy();
  });
});
