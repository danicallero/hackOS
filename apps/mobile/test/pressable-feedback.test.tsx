import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { AppText } from "@/components/app-text";
import { PressableFeedback } from "@/components/pressable-feedback";
import { colors, pointer, pressed, radius, type } from "@/theme";

const flatten = (style: unknown): Record<string, unknown> =>
  Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

describe("PressableFeedback (H55, H59)", () => {
  it.each([
    "row",
    "opacity",
    "scale",
    "none",
  ] as const)("presses with %s feedback", async (feedback) => {
    const onPress = jest.fn();
    await render(
      <PressableFeedback accessibilityRole="button" feedback={feedback} onPress={onPress}>
        <Text>Go</Text>
      </PressableFeedback>,
    );
    await fireEvent.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("blocks presses and dims when disabled", async () => {
    const onPress = jest.fn();
    await render(
      <PressableFeedback accessibilityRole="button" disabled onPress={onPress}>
        <Text>Go</Text>
      </PressableFeedback>,
    );
    const button = screen.getByRole("button");
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
    expect(flatten(button.props.style).opacity).toBe(pressed.disabledOpacity);
  });
});

describe("PressableFeedback pointer and keyboard feedback (H55, H59)", () => {
  const press = (feedback: "row" | "opacity" | "scale" | "none", extra = {}) => (
    <PressableFeedback accessibilityRole="button" feedback={feedback} {...extra}>
      <Text>Go</Text>
    </PressableFeedback>
  );

  it("washes a hovered row and clears it on hover out", async () => {
    await render(press("row"));
    const button = screen.getByRole("button");
    expect(flatten(button.props.style).backgroundColor).toBeUndefined();
    await fireEvent(button, "hoverIn");
    expect(flatten(screen.getByRole("button").props.style).backgroundColor).toBe(colors.hover);
    await fireEvent(screen.getByRole("button"), "hoverOut");
    expect(flatten(screen.getByRole("button").props.style).backgroundColor).toBeUndefined();
  });

  it("highlights over a caller background", async () => {
    await render(press("row", { style: { backgroundColor: "#ffffff", padding: 4 } }));
    await fireEvent(screen.getByRole("button"), "hoverIn");
    const hovered = flatten(screen.getByRole("button").props.style);
    expect(hovered.backgroundColor).toBe(colors.hover);
    expect(hovered.padding).toBe(4);
  });

  it("ignores hover when disabled", async () => {
    await render(press("row", { disabled: true }));
    await fireEvent(screen.getByRole("button"), "hoverIn");
    expect(flatten(screen.getByRole("button").props.style).backgroundColor).toBeUndefined();
  });

  it.each([
    "row",
    "opacity",
  ] as const)("draws a focus ring for %s on focus only", async (feedback) => {
    await render(press(feedback, { focusRadius: radius.container }));
    expect(flatten(screen.getByRole("button").props.style).outlineWidth).toBeUndefined();
    await fireEvent(screen.getByRole("button"), "focus");
    const style = flatten(screen.getByRole("button").props.style);
    expect(style.outlineColor).toBe(colors.accent);
    expect(style.outlineWidth).toBe(pointer.focusRingWidth);
    expect(style.borderRadius).toBe(radius.container);
    await fireEvent(screen.getByRole("button"), "blur");
    expect(flatten(screen.getByRole("button").props.style).outlineWidth).toBeUndefined();
  });

  it("drops the ring once the control is pressed", async () => {
    await render(press("row"));
    await fireEvent(screen.getByRole("button"), "focus");
    await fireEvent(screen.getByRole("button"), "pressIn");
    expect(flatten(screen.getByRole("button").props.style).outlineWidth).toBeUndefined();
  });
});

describe("AppText", () => {
  it("applies the ramp step and lets style override layout last", async () => {
    await render(
      <AppText variant="footnote" style={{ textAlign: "right" }}>
        Hi
      </AppText>,
    );
    const style = flatten(screen.getByText("Hi").props.style);
    expect(style.fontSize).toBe(type.footnote.fontSize);
    expect(style.textAlign).toBe("right");
  });
});
