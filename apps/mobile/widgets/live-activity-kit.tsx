import { HStack, Image, Link, Text, VStack } from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  allowsTightening,
  background,
  contentTransition,
  dynamicTypeSize,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  layoutPriority,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  padding,
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
  // `fixedSize` asks the frame for its ideal width: without `idealWidth` the
  // frame passed that open request on, the content kept its full width and
  // spilled past the island's edge, and `minimumScaleFactor` never applied
  // (#1171). The ideal width turns the cap into the content's proposal.
  const islandSlot = (
    view: Parameters<typeof HStack>[0]["children"],
    { width, alignment }: Slot,
  ) => (
    <HStack
      spacing={0}
      modifiers={[
        frame({ idealWidth: width, maxWidth: width, alignment }),
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
        slots?.compactLeading ?? { width: 22, alignment: "center" },
      ),
      compactTrailing: islandSlot(
        layout.compactTrailing as never,
        slots?.compactTrailing ?? { width: 56, alignment: "leading" },
      ),
      minimal: islandSlot(layout.minimal as never, { width: 36, alignment: "center" }),
    });

  // Expanded leading/trailing sit beside the TrueDepth camera, in a region
  // the system sizes. Content that refuses its proposal (`fixedSize`) grows
  // past the region into the sensor housing (#1171), so nothing inside these
  // regions is fixed: text shrinks to the region, at a fixed type size like
  // the compact slots. 8 pt keeps labels off the island's curved corners.
  const islandSide = (
    view: Parameters<typeof VStack>[0]["children"],
    edge: "leading" | "trailing",
    top = 4,
  ) => (
    <VStack
      alignment={edge}
      modifiers={[padding({ [edge]: 8, top }), minimumScaleFactor(0.6), dynamicTypeSize("large")]}
    >
      {view}
    </VStack>
  );

  // `412/600` where width is scarce (island slots, beside the camera): past
  // `maxChars` characters only the count remains, and the bar keeps the share.
  const ratioParts = (count: number, total: number | null, maxChars = 7) =>
    total !== null && `${count}/${total}`.length <= maxChars
      ? { count: String(count), total: `/${total}` }
      : { count: String(count), total: null };

  // Full width on the Lock Screen (`fixed`); inside the island nothing is
  // fixed, so a value shrinks to its slot instead of spilling under the
  // camera (#1171).
  const counter = (
    value: string,
    size: number,
    color: string | null,
    weight = "bold",
    fixed = true,
  ) => (
    <Text
      modifiers={[
        font({ size, weight: weight as "bold" | "semibold" }),
        monospacedDigit(),
        contentTransition("numericText"),
        lineLimit(1),
        allowsTightening(true),
        ...(fixed ? [fixedSize({ horizontal: true })] : [layoutPriority(1)]),
        ...colorMods(color),
      ]}
    >
      {value}
    </Text>
  );

  // A hero count with its denominator, smaller and secondary (`42/180`).
  const ratioView = (
    parts: { count: string; total: string | null },
    o: {
      size: number;
      denominatorSize: number;
      spacing: number;
      color: string | null;
      weight?: string;
      fixed?: boolean;
      animateTotal?: boolean;
    },
  ) => {
    const fixed = o.fixed ?? true;
    return (
      <HStack
        alignment="firstTextBaseline"
        spacing={o.spacing}
        modifiers={fixed ? [fixedSize({ horizontal: true })] : []}
      >
        {counter(parts.count, o.size, o.color, o.weight ?? "bold", fixed)}
        {parts.total ? (
          <Text
            modifiers={[
              font({ size: o.denominatorSize, weight: "semibold" }),
              monospacedDigit(),
              ...(o.animateTotal ? [contentTransition("numericText")] : []),
              secondary,
              lineLimit(1),
            ]}
          >
            {parts.total}
          </Text>
        ) : null}
      </HStack>
    );
  };

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

  return {
    capped,
    caption,
    colorMods,
    counter,
    islandSide,
    ratioParts,
    ratioView,
    scanButton,
    secondary,
  };
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
