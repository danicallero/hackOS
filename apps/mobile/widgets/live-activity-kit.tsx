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
import type { ComponentProps } from "react";

type SFSymbol = ComponentProps<typeof Image>["systemName"];
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

  // Hard caps for the Dynamic Island (HIG: compact regions hug their content,
  // snug against the camera): whatever the value, locale or text size, the
  // island never grows past them. The frame only caps (`maxWidth`): it carries
  // no ideal width, so a slot is exactly as wide as its content (a 24 pt
  // figure no longer sits in a 56 pt box with empty space beside it, #1171)
  // and text scales down rather than truncating at the cap. `fixedSize` is
  // not used here: it asked for an open width and the content spilled past the
  // island's edge.
  const islandSlot = (
    view: Parameters<typeof HStack>[0]["children"],
    { width, alignment }: Slot,
  ) => (
    <HStack
      spacing={0}
      modifiers={[
        frame({ maxWidth: width, alignment }),
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
        slots?.compactLeading ?? { width: 32, alignment: "center" },
      ),
      compactTrailing: islandSlot(
        layout.compactTrailing as never,
        slots?.compactTrailing ?? { width: 56, alignment: "center" },
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

  // Presentation pieces every kind repeats. Callers keep their own JSX tree and
  // pass only their content.
  const islandAccent = "#0A84FF";
  const neutral = "#8E8E93";
  // Lock Screen accent: dynamic light/dark, dropped in Always-On.
  const bannerAccent = (reduced?: boolean) =>
    reduced ? null : ({ dynamic: { light: "#007AFF", dark: "#0A84FF" } } as unknown as string);

  // Lock Screen banner: one 14 pt margin on every edge.
  const bannerMods = [frame({ maxWidth: 10000, alignment: "leading" }), padding({ all: 14 })];
  const bottomMods = (bottom: number) => [
    frame({ maxWidth: 10000, alignment: "leading" }),
    padding({ horizontal: 8, bottom }),
  ];
  // watchOS Smart Stack / CarPlay (`.small`).
  const watchMods = [
    frame({ maxWidth: 10000, alignment: "leading" }),
    padding({ horizontal: 10, vertical: 8 }),
    dynamicTypeSize({ max: "xLarge" }),
  ];
  const watchHeader = (glyph: SFSymbol, glyphColor: string | null, title: string | undefined) => (
    <HStack spacing={5}>
      <Image systemName={glyph} color={glyphColor ?? neutral} size={13} />
      <Text modifiers={[font({ size: 13, weight: "medium" }), lineLimit(1), secondary]}>
        {title}
      </Text>
    </HStack>
  );

  // A newer, incompatible props shape (`v` bumped) degrades to the name and a
  // symbol; the caller wraps the result in its `capped(...)`.
  const fallback = (name: unknown, symbolName: SFSymbol) => {
    const title = (
      <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>
        {typeof name === "string" ? name : ""}
      </Text>
    );
    const symbol = <Image systemName={symbolName} color={islandAccent} size={15} />;
    return {
      banner: (
        <VStack alignment="leading" modifiers={bannerMods}>
          {title}
        </VStack>
      ),
      bannerSmall: <VStack modifiers={[padding({ all: 8 })]}>{title}</VStack>,
      compactLeading: symbol,
      compactTrailing: <Text> </Text>,
      minimal: symbol,
      expandedLeading: symbol,
      expandedTrailing: <Text> </Text>,
      expandedBottom: <VStack modifiers={[padding({ horizontal: 8 })]}>{title}</VStack>,
    };
  };

  return {
    bannerAccent,
    bannerMods,
    bottomMods,
    capped,
    caption,
    colorMods,
    counter,
    fallback,
    islandAccent,
    islandSide,
    neutral,
    ratioParts,
    ratioView,
    scanButton,
    secondary,
    watchHeader,
    watchMods,
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
