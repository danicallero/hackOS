// Exercise the React Native implementation; iOS uses the system SwiftUI button.
jest.mock("@/components/scanner-action-button", () =>
  jest.requireActual("../components/scanner-action-button.tsx"),
);

import { act, render, screen } from "@testing-library/react-native";
import type { ComponentType } from "react";
import { Dimensions, StyleSheet, type TextProps } from "react-native";
import { InfoRow } from "@/components/native-ui";
import { QuickAction } from "@/components/profile-parts";
import { ScannerActionButton } from "@/components/scanner-action-button";
import { WheelPicker } from "@/components/wheel-picker";
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

describe("primary action labels (#1166)", () => {
  it("reflows mounted labels at AX5 and restores their standard-size limit", async () => {
    await setWindow({ fontScale: 1 });
    await render(
      <QuickAction
        icon="person"
        title="Invite a teammate"
        label="Invite a teammate"
        busy={false}
        onPress={() => {}}
      />,
    );
    expect(screen.getByText("Invite a teammate").props.numberOfLines).toBe(1);
    await setWindow({ fontScale: 3.571 });
    expect(screen.getByText("Invite a teammate").props.numberOfLines).toBeUndefined();
    expect(screen.getByText("Invite a teammate").props.maxFontSizeMultiplier).toBeUndefined();
    await setWindow({ fontScale: 1 });
    expect(screen.getByText("Invite a teammate").props.numberOfLines).toBe(1);
  });

  it("lets compact scanner actions grow instead of shrinking accessibility text", async () => {
    await setWindow({ fontScale: 3.571 });
    await render(<ScannerActionButton label="Search people" size="compact" onPress={() => {}} />);
    const label = screen.getByText("Search people");
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.adjustsFontSizeToFit).toBe(false);
    expect(label.props.maxFontSizeMultiplier).toBeUndefined();
  });
});

it("grows picker rows at AX5 without losing the selected value (#1166)", async () => {
  await setWindow({ fontScale: 1, height: 600 });
  const onChange = jest.fn();
  await render(
    <WheelPicker
      accessibilityLabel="Month"
      options={[{ label: "September", value: 9 }]}
      selectedIndex={0}
      onChange={onChange}
    />,
  );
  expect(screen.getByText("September").props.numberOfLines).toBe(1);
  await setWindow({ fontScale: 3.571, height: 600 });
  expect(screen.getByText("September").props.numberOfLines).toBe(2);
  const wheel = screen.getByLabelText("Month");
  expect(wheel.props.accessibilityValue.text).toBe("September");
  expect(StyleSheet.flatten(wheel.props.style).height).toBeLessThan(600);
  expect(onChange).not.toHaveBeenCalled();
});
