import { act } from "@testing-library/react-native";
import { Dimensions } from "react-native";
import {
  SCREEN_TITLE,
  SCREEN_TITLE_CENTER,
  TWO_PANE_BAND,
  twoPaneBandHeight,
} from "@/theme/screen-title";

const initialWindow = Dimensions.get("window");
const initialScreen = Dimensions.get("screen");

async function setFontScale(fontScale: number) {
  await act(async () => {
    Dimensions.set({
      window: { ...initialWindow, fontScale },
      screen: { ...initialScreen, fontScale },
    });
  });
}

afterEach(() => setFontScale(initialWindow.fontScale));

describe("twoPaneBandHeight", () => {
  it("is exactly the fixed band at default size", () => {
    expect(twoPaneBandHeight(1)).toBe(TWO_PANE_BAND);
    expect(twoPaneBandHeight(0.85)).toBe(TWO_PANE_BAND);
  });

  it("grows with the font scale and the number of lines", () => {
    expect(twoPaneBandHeight(2)).toBeGreaterThan(TWO_PANE_BAND);
    expect(twoPaneBandHeight(3.1)).toBeGreaterThan(twoPaneBandHeight(2));
    expect(twoPaneBandHeight(2, 2)).toBeGreaterThan(twoPaneBandHeight(2));
    // The title's scaled line box always fits inside the band.
    const top = SCREEN_TITLE_CENTER - SCREEN_TITLE.lineHeight / 2;
    expect(twoPaneBandHeight(2) - top).toBeGreaterThanOrEqual(SCREEN_TITLE.lineHeight * 2);
  });
});

describe("two-pane band at Dynamic Type sizes", () => {
  it.each([1, 2])("reserves a growing band for the system scale %s", async (scale) => {
    await setFontScale(scale);
    const fontScale = Dimensions.get("window").fontScale;
    expect(fontScale).toBe(scale);
    expect(twoPaneBandHeight(fontScale)).toBe(scale === 1 ? TWO_PANE_BAND : 106);
  });
});
