import { HStack, Image, Link, Text } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  background,
  dynamicTypeSize,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  multilineTextAlignment,
} from "@expo/ui/swift-ui/modifiers";
import type { LiveActivityEnvironment } from "expo-widgets";

type Slot = { width: number; alignment: "leading" | "center" | "trailing" };

/**
 * Layout pieces shared by every Live Activity (#1134). A `'widget'` function is
 * serialized into the extension on its own, so a module import is not available
 * there; `withLiveActivityKit` instead serializes this function next to the
 * layout and hands its result in as the third argument. Same constraints as the
 * layouts: only `@expo/ui/swift-ui` names, everything declared inside.
 */
export const liveActivityKit = () => {
  "widget";

  const secondary = foregroundStyle({ type: "hierarchical", style: "secondary" });
  const colorMods = (color: string | null) => (color ? [foregroundStyle(color)] : []);

  // Hard caps for the Dynamic Island (HIG: narrow, balanced, snug against
  // the camera): whatever the value, locale or text size, the island never
  // grows past them. Each slot is as wide as its content up to the cap; text
  // scales down rather than truncating, and the type size stays fixed.
  const islandSlot = (
    view: Parameters<typeof HStack>[0]["children"],
    { width, alignment }: Slot,
  ) => (
    <HStack
      spacing={0}
      modifiers={[
        frame({ maxWidth: width, alignment }),
        fixedSize({ horizontal: true }),
        minimumScaleFactor(0.6),
        dynamicTypeSize("large"),
      ]}
    >
      {view}
    </HStack>
  );
  const capped =
    (slots?: { compactLeading?: Slot; compactTrailing?: Slot }) =>
    <L extends { compactLeading: unknown; compactTrailing: unknown; minimal: unknown }>(
      layout: L,
    ) => ({
      ...layout,
      compactLeading: islandSlot(
        layout.compactLeading as never,
        slots?.compactLeading ?? { width: 24, alignment: "trailing" },
      ),
      compactTrailing: islandSlot(
        layout.compactTrailing as never,
        slots?.compactTrailing ?? { width: 56, alignment: "leading" },
      ),
      minimal: islandSlot(layout.minimal as never, { width: 36, alignment: "center" }),
    });

  const caption = (text: string | null | undefined, align?: "leading" | "trailing") =>
    text ? (
      <Text
        modifiers={[
          font({ size: 12, weight: "medium" }),
          secondary,
          lineLimit(1),
          ...(align ? [multilineTextAlignment(align)] : []),
        ]}
      >
        {text}
      </Text>
    ) : null;

  // #966: one 44 pt circular action, named for VoiceOver, separate from progress.
  const scanButton = (destination: string, label: string | undefined, color: string | null) =>
    label ? (
      <Link destination={destination} modifiers={[accessibilityLabel(label)]}>
        <HStack
          modifiers={[
            frame({ width: 44, height: 44, alignment: "center" }),
            background(color ? "#0066CC" : "#3A3A3C", { shape: "circle" }),
          ]}
        >
          <Image systemName="wave.3.right" color="#FFFFFF" size={20} />
        </HStack>
      </Link>
    ) : null;

  return { capped, caption, colorMods, scanButton, secondary };
};

export type LiveActivityKit = ReturnType<typeof liveActivityKit>;

type KitLayout<P, R> = (props: P, environment: LiveActivityEnvironment, kit: LiveActivityKit) => R;

/**
 * Both arguments are already source text by the time this runs (the `'widget'`
 * Babel transform replaced the functions), so composing them is string
 * concatenation. The result is the single-function source the extension expects.
 */
export function withLiveActivityKit<P, R>(
  layout: KitLayout<P, R>,
): (props: P, environment: LiveActivityEnvironment) => R {
  return `function(props,environment){return (${layout})(props,environment,(${liveActivityKit})())}` as never;
}
