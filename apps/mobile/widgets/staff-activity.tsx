import { HStack, Image, Link, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  allowsTightening,
  background,
  contentTransition,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  multilineTextAlignment,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { ActivityLiveProps } from "@hackos/shared/live-activities";
import { LIVE_ACTIVITY_WIDGET_NAMES } from "@hackos/shared/live-activities";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

/**
 * H25/H26 staff activity Live Activity (#966): a countdown to the start of a
 * meal or scannable activity, then the live attendance count and the single
 * Scan action that opens the scanner bound to the activity.
 *
 * See `queue-activity.tsx` for the `'widget'` runtime constraints: everything
 * the layout needs is declared inside the function or arrives in props.
 * Countdowns are SwiftUI timer texts, so they tick without any update.
 */
export const StaffActivityLayout = (
  props: ActivityLiveProps,
  environment: LiveActivityEnvironment,
) => {
  "widget";
  // APNs delivers props straight to this layout, so a newer, incompatible
  // shape (`v` bumped, see LIVE_ACTIVITY_PROPS_VERSION) degrades to the name
  // instead of rendering half-understood fields (or an invalid timer range).
  if (props.v !== 1 || !props.labels) {
    const title = (
      <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>
        {typeof props.name === "string" ? props.name : ""}
      </Text>
    );
    const symbol = <Image systemName="person.3.fill" color="#0A84FF" size={15} />;
    return {
      banner: (
        <VStack
          alignment="leading"
          modifiers={[frame({ maxWidth: 10000, alignment: "leading" }), padding({ all: 14 })]}
        >
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
  }
  const islandAccent = "#0A84FF";
  const bannerAccent = environment.isLuminanceReduced
    ? null
    : environment.colorScheme === "light"
      ? "#007AFF"
      : "#0A84FF";
  const accentMods = (color: string | null) => (color ? [foregroundStyle(color)] : []);
  const live = props.phase === "live";
  const symbol =
    props.category === "meal"
      ? "fork.knife"
      : props.category === "talk" || props.category === "workshop"
        ? "mic.fill"
        : props.category === "ceremony"
          ? "party.popper.fill"
          : "person.3.fill";
  const startsAt = new Date(props.startsAt);
  const endsAt = new Date(props.endsAt);
  // A ClosedRange needs lower <= upper; the server timestamp can trail the start.
  // Any earlier lower bound renders the same remaining time; an unparsable
  // timestamp must not produce an invalid range.
  const updatedAt = Date.parse(props.updatedAt);
  const lower = new Date(
    Number.isFinite(updatedAt)
      ? Math.min(updatedAt, startsAt.getTime())
      : startsAt.getTime() - 3_600_000,
  );
  const count = String(props.scanned);

  const countdown = (size: number, color: string | null, width: number | null) => (
    <Text
      timerInterval={{ lower, upper: startsAt }}
      countsDown
      modifiers={[
        font({ size, weight: "semibold" }),
        monospacedDigit(),
        multilineTextAlignment("trailing"),
        ...(width ? [frame({ maxWidth: width, alignment: "trailing" })] : []),
        ...accentMods(color),
      ]}
    />
  );

  const counter = (size: number, color: string | null) => (
    <Text
      modifiers={[
        font({ size, weight: "semibold" }),
        monospacedDigit(),
        contentTransition("numericText"),
        lineLimit(1),
        allowsTightening(true),
        ...accentMods(color),
      ]}
    >
      {count}
    </Text>
  );

  const compactLeading = <Image systemName={symbol} color={islandAccent} size={15} />;
  const compactTrailing = live ? counter(15, islandAccent) : countdown(15, islandAccent, 52);
  const minimal = live ? counter(13, islandAccent) : countdown(11, islandAccent, 34);

  const metric = (color: string | null, align: "leading" | "trailing") => (
    <VStack alignment={align} spacing={0}>
      <Text
        modifiers={[
          font({ size: 12, weight: "medium" }),
          foregroundStyle({ type: "hierarchical", style: "secondary" }),
        ]}
      >
        {live ? props.labels.scanned : props.labels.startsIn}
      </Text>
      {live ? counter(28, color) : countdown(28, color, 120)}
    </VStack>
  );

  const timeRange = (
    <HStack spacing={0}>
      <Text date={startsAt} dateStyle="time" />
      <Text>–</Text>
      <Text date={endsAt} dateStyle="time" />
      {props.location ? <Text modifiers={[lineLimit(1)]}>{` · ${props.location}`}</Text> : null}
    </HStack>
  );

  // The single interactive element (HIG): only while the activity is live.
  const scanButton = (color: string | null) =>
    live ? (
      <Link destination={props.scanUrl}>
        <HStack
          spacing={6}
          modifiers={[
            frame({ maxWidth: 10000 }),
            padding({ vertical: 8 }),
            background(color ?? "#3A3A3C", { shape: "capsule", roundedCornerStyle: "continuous" }),
          ]}
        >
          <Image systemName="qrcode.viewfinder" color="#FFFFFF" size={15} />
          <Text modifiers={[font({ size: 15, weight: "semibold" }), foregroundStyle("#FFFFFF")]}>
            {props.labels.scan}
          </Text>
        </HStack>
      </Link>
    ) : null;

  const expandedLeading = (
    <Image
      systemName={symbol}
      color={islandAccent}
      size={26}
      modifiers={[padding({ leading: 8, top: 4 })]}
    />
  );
  // Inset from the island's rounded corners so labels never clip.
  const expandedTrailing = (
    <VStack modifiers={[padding({ trailing: 8, top: 4 })]}>
      {metric(islandAccent, "trailing")}
    </VStack>
  );
  const expandedBottom = (
    <VStack alignment="leading" spacing={6} modifiers={[padding({ horizontal: 8 })]}>
      <VStack
        alignment="leading"
        spacing={1}
        modifiers={[frame({ maxWidth: 10000, alignment: "leading" })]}
      >
        <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>{props.name}</Text>
        <HStack
          modifiers={[
            font({ size: 13, weight: "medium" }),
            foregroundStyle({ type: "hierarchical", style: "secondary" }),
          ]}
        >
          {timeRange}
        </HStack>
      </VStack>
      {scanButton(islandAccent)}
    </VStack>
  );

  // Lock Screen: unique layout, 14 pt margins, default background.
  const banner = (
    <VStack alignment="leading" spacing={10} modifiers={[padding({ all: 14 })]}>
      <HStack alignment="center" spacing={12}>
        <Image systemName={symbol} color={bannerAccent ?? "#8E8E93"} size={22} />
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[font({ size: 17, weight: "semibold" }), lineLimit(1)]}>
            {props.name}
          </Text>
          <HStack
            modifiers={[
              font({ size: 13, weight: "medium" }),
              foregroundStyle({ type: "hierarchical", style: "secondary" }),
            ]}
          >
            {timeRange}
          </HStack>
        </VStack>
        <Spacer />
        {metric(bannerAccent, "trailing")}
      </HStack>
      {scanButton(bannerAccent)}
    </VStack>
  );

  // watchOS Smart Stack and CarPlay: name plus countdown or count, no buttons.
  const bannerSmall = (
    <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 8 })]}>
      <HStack spacing={4}>
        <Image systemName={symbol} color={bannerAccent ?? "#8E8E93"} size={12} />
        <Text
          modifiers={[
            font({ size: 13, weight: "medium" }),
            lineLimit(1),
            foregroundStyle({ type: "hierarchical", style: "secondary" }),
          ]}
        >
          {props.name}
        </Text>
      </HStack>
      {live ? counter(20, bannerAccent) : countdown(20, bannerAccent, null)}
    </VStack>
  );

  return {
    banner,
    bannerSmall,
    compactLeading,
    compactTrailing,
    minimal,
    expandedLeading,
    expandedTrailing,
    expandedBottom,
  };
};

export const StaffActivity = createLiveActivity<ActivityLiveProps>(
  LIVE_ACTIVITY_WIDGET_NAMES.activity,
  StaffActivityLayout,
);
