import { act, render, screen } from "@testing-library/react-native";
import type { ComponentType } from "react";
import { Dimensions, StyleSheet, type TextProps } from "react-native";
import { InfoRow } from "@/components/native-ui";
import { CHROME_MAX_FONT_SIZE_MULTIPLIER, isAccessibilityTextSize } from "@/theme/dynamic-type";

// The jest preset replaces Text with a mock; the patch lives in the real one.
const Text: ComponentType<TextProps> = jest.requireActual(
  "react-native/Libraries/Text/Text",
).default;

/**
 * patches/react-native@0.86.3.patch: Fabric re-measures text only on its
 * native branch when the system text size changes, so the next React commit
 * restored frames measured at the previous size and clipped every label.
 * The patched `Text` remounts its root paragraph once per font-scale change.
 */
const initialWindow = Dimensions.get("window");
const initialScreen = Dimensions.get("screen");

async function setWindow(overrides: Partial<typeof initialWindow>) {
  await act(async () => {
    Dimensions.set({
      window: { ...initialWindow, ...overrides },
      screen: { ...initialScreen, ...overrides },
    });
  });
}

afterEach(() => setWindow({}));

describe("Text font-scale remount (Dynamic Type)", () => {
  it("remounts the paragraph when the font scale changes", async () => {
    await render(<Text>Activities</Text>);
    const paragraph = screen.getByText("Activities");

    await setWindow({ fontScale: 3.1 });

    expect(screen.getByText("Activities")).not.toBe(paragraph);
  });

  it("keeps the paragraph mounted for other dimension changes", async () => {
    await render(<Text>Activities</Text>);
    const paragraph = screen.getByText("Activities");

    await setWindow({ width: initialWindow.width + 100 });

    expect(screen.getByText("Activities")).toBe(paragraph);
  });
});

describe("accessibility text sizes", () => {
  it("starts above the largest standard size, where chrome stops growing", () => {
    // React Native's multipliers for iOS Large, xxxLarge and AX1 (Accessibility Medium).
    expect(isAccessibilityTextSize(1)).toBe(false);
    expect(isAccessibilityTextSize(CHROME_MAX_FONT_SIZE_MULTIPLIER)).toBe(false);
    expect(isAccessibilityTextSize(1.786)).toBe(true);
  });

  it("stacks an InfoRow value under its label instead of squeezing it", async () => {
    await setWindow({ fontScale: 1 });
    await render(<InfoRow label="Language" value="English" />);
    expect(StyleSheet.flatten(screen.getByText("English").props.style).textAlign).toBe("right");

    await setWindow({ fontScale: 3.571 });

    const value = StyleSheet.flatten(screen.getByText("English").props.style);
    expect(value.textAlign).toBeUndefined();
    expect(value.flex).toBeUndefined();
  });

  it("drops an empty value line when stacked", async () => {
    await setWindow({ fontScale: 3.571 });
    await render(<InfoRow label="Legal" value="" accessoryIcon="chevron.right" />);

    expect(JSON.stringify(screen.toJSON()).match(/"type":"Text"/g)).toHaveLength(1);
  });
});
