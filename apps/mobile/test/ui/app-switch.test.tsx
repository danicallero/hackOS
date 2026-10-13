import { screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import { renderMobile } from "./render";

// Android's Material Switch is teal by default; AppSwitch recolours it with the accent.

// The stock jest Switch drops colour props; expose them to assert what AppSwitch passes.
jest.mock("react-native/Libraries/Components/Switch/Switch", () => {
  const Native = require("react-native");
  return {
    __esModule: true,
    default: (props: object) => require("react").createElement(Native.View, props),
  };
});
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/components/glass-view", () => ({
  GlassView: () => null,
  isRealLiquidGlassAvailable: () => false,
}));
jest.mock("@/theme/colors", () => ({
  colors: new Proxy({}, { get: (_t, name) => `token:${String(name)}` }),
}));

const originalOs = Platform.OS;
afterEach(() => {
  Platform.OS = originalOs;
});

async function renderSwitch() {
  const { AppSwitch } = require("@/components/native-ui");
  await renderMobile(<AppSwitch accessibilityLabel="x" value onValueChange={() => {}} />);
  return screen.getByLabelText("x");
}

describe("AppSwitch", () => {
  it("uses the accent token for thumb and track on Android", async () => {
    Platform.OS = "android";
    const props = (await renderSwitch()).props;
    expect(props.thumbColor).toBe("token:accentText");
    expect(props.trackColor).toEqual({ false: "token:tertiaryLabel", true: "token:accent" });
  });

  it("leaves the native iOS control untouched", async () => {
    Platform.OS = "ios";
    const props = (await renderSwitch()).props;
    expect(props.trackColor).toBeUndefined();
    expect(props.thumbColor).toBeUndefined();
  });
});
