import { fireEvent, screen } from "@testing-library/react-native";
import { renderMobile } from "./render";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockPush = jest.fn();
const mockOpenBrowser = jest.fn();
jest.mock("expo-web-browser", () => ({ openBrowserAsync: (url: string) => mockOpenBrowser(url) }));
jest.mock("expo-router", () => ({
  ...jest.requireActual("expo-router"),
  Stack: { Screen: () => null },
  useRouter: () => ({ push: mockPush }),
  useScrollToTop: jest.fn(),
}));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarScrollBottomInset: () => 0 }));
jest.mock("@/assets/licenses.json", () => [
  {
    name: "@scope/kit",
    version: "1.2.0",
    license: "MIT",
    source: "https://github.com/scope/kit",
    text: "Copyright (c) 2026 Kit",
  },
  { name: "bare", version: "0.1.0", license: "ISC", source: null, text: null },
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
    await fireEvent.press(screen.getByLabelText("legalLicenses"));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/others/licenses");
  });

  it("lists every bundled package with its notice and source, and opens it", async () => {
    await renderMobile(<LicensesScreen />);
    expect(screen.getByText("@scope/kit")).toBeTruthy();
    expect(screen.getByText("Copyright (c) 2026 Kit").props.numberOfLines).toBe(4);
    // Without a notice file the license id stands in.
    expect(screen.getByText("ISC")).toBeTruthy();
    await fireEvent.press(screen.getByText("github.com/scope/kit"));
    expect(mockOpenBrowser).toHaveBeenCalledWith("https://github.com/scope/kit");
    await fireEvent.press(screen.getByLabelText("@scope/kit, MIT"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(tabs)/others/licenses/[name]",
      params: { name: "@scope/kit" },
    });
  });

  it("shows the notice, or only the license id when the package ships none", async () => {
    await renderMobile(<LicenseScreen name="@scope/kit" />);
    expect(screen.getByText("1.2.0 · MIT")).toBeTruthy();
    expect(screen.getByText("Copyright (c) 2026 Kit").props.numberOfLines).toBeUndefined();
    expect(screen.getByText("github.com/scope/kit")).toBeTruthy();

    await renderMobile(<LicenseScreen name="bare" />);
    expect(screen.getByText("0.1.0 · ISC")).toBeTruthy();
    expect(screen.queryByText(/github\.com/)).toBeNull();
  });
});
