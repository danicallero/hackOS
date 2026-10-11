import { Gauge, HStack, Image, Link, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  allowsTightening,
  background,
  contentTransition,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  gaugeStyle,
  labelsHidden,
  lineLimit,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  scaleEffect,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ActivityLiveProps } from "@hackos/shared/live-activities";
import { LIVE_ACTIVITY_WIDGET_NAMES } from "@hackos/shared/live-activities";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

/**
 * H25/H26 staff activity Live Activity (#966). Upcoming: "how long until it
 * starts?" (countdown). Live meal (H24/H27, `inside`/`remaining` set): "how
 * many still to eat?" — served, still to eat (hero) and inside, with a bar of
 * the served share. Live, anything else: the scanned count and a bar of the
 * elapsed time. While live, the single Scan action opens the scanner bound to
 * the activity.
 *
 * See `queue-activity.tsx` for the `'widget'` runtime constraints: everything
 * the layout needs is declared inside the function or arrives in props.
 * Countdowns and time bars are SwiftUI timers, so they tick without updates.
 * Fields and labels added after v1 are optional: an absent one hides its
 * element, never falls back to hardcoded copy.
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
  const labels = props.labels;
  // Dynamic Island is always dark; the Lock Screen follows the system scheme,
  // which `environment.colorScheme` does not reliably report, so the Lock
  // Screen accent is a dynamic colour resolved by the view's own appearance.
  // Always-On (reduced luminance) drops accent fills and lets the system dim.
  const islandAccent = "#0A84FF";
  const neutral = "#8E8E93";
  const bannerAccent = environment.isLuminanceReduced
    ? null
    : ({ dynamic: { light: "#007AFF", dark: "#0A84FF" } } as unknown as string);
  const colorMods = (color: string | null) => (color ? [foregroundStyle(color)] : []);
  const secondary = foregroundStyle({
    type: "hierarchical",
    style: "secondary",
  });
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
  const validEnd = Number.isFinite(endsAt.getTime()) && endsAt.getTime() > startsAt.getTime();
  // A ClosedRange needs lower <= upper; the server timestamp can trail the start.
  // Any earlier lower bound renders the same remaining time; an unparsable
  // timestamp must not produce an invalid range.
  const updatedAt = Date.parse(props.updatedAt);
  const lower = new Date(
    Number.isFinite(updatedAt)
      ? Math.min(updatedAt, startsAt.getTime())
      : startsAt.getTime() - 3_600_000,
  );

  // Live meal breakdown (H24/H27): served share = (inside - remaining) / inside.
  // `scanned` stays the "served" headline (distinct people, incl. ones who left).
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const inside = count(props.inside);
  const remaining = count(props.remaining);
  const meal = live && inside !== null && remaining !== null;
  const servedShare =
    meal && inside! > 0 ? Math.min(1, Math.max(0, (inside! - remaining!) / inside!)) : null;
  const scanned = String(count(props.scanned) ?? 0);
  // The one number each live state is about.
  const heroCount = meal ? String(remaining) : scanned;

  const countdown = (size: number, color: string | null, width: number | null) => (
    <Text
      timerInterval={{ lower, upper: startsAt }}
      countsDown
      modifiers={[
        font({ size, weight: "semibold" }),
        monospacedDigit(),
        multilineTextAlignment("trailing"),
        ...(width ? [frame({ maxWidth: width, alignment: "trailing" })] : []),
        ...colorMods(color),
      ]}
    />
  );

  // Countdown to the end, for the live bar's trailing label.
  const endsIn = (size: number, width: number) =>
    validEnd ? (
      <HStack spacing={4} modifiers={[fixedSize({ horizontal: true })]}>
        {labels.endsIn ? (
          <Text modifiers={[font({ size, weight: "medium" }), secondary, lineLimit(1)]}>
            {labels.endsIn}
          </Text>
        ) : null}
        <Text
          timerInterval={{ lower: startsAt, upper: endsAt }}
          countsDown
          modifiers={[
            font({ size, weight: "semibold" }),
            monospacedDigit(),
            multilineTextAlignment("trailing"),
            frame({ width, alignment: "trailing" }),
          ]}
        />
      </HStack>
    ) : null;

  const counter = (value: string, size: number, color: string | null, weight = "bold") => (
    <Text
      modifiers={[
        font({ size, weight: weight as "bold" | "semibold" }),
        monospacedDigit(),
        contentTransition("numericText"),
        lineLimit(1),
        allowsTightening(true),
        fixedSize({ horizontal: true }),
        ...colorMods(color),
      ]}
    >
      {value}
    </Text>
  );

  const stat = (
    label: string | undefined,
    value: string,
    color: string | null,
    align: "leading" | "trailing",
    size = 28,
    weight = "semibold",
  ) => (
    <VStack alignment={align} spacing={0}>
      {label ? (
        <Text modifiers={[font({ size: 12, weight: "medium" }), secondary, lineLimit(1)]}>
          {label}
        </Text>
      ) : null}
      {counter(value, size, color, weight)}
    </VStack>
  );

  // Meals: the served share. Anything else: elapsed time from start to end.
  const bar = (color: string | null) =>
    servedShare !== null ? (
      <ProgressView value={servedShare} modifiers={[tint(color ?? neutral)]} />
    ) : !meal && validEnd ? (
      <ProgressView
        timerInterval={{ lower: startsAt, upper: endsAt }}
        countsDown={false}
        modifiers={[tint(color ?? neutral), labelsHidden()]}
      />
    ) : null;

  // The bare category symbol: no tile behind it (fewer containers, and a
  // squircle would not be concentric with the activity's corners).
  const glyph = (color: string | null, size: number) => (
    <Image systemName={symbol} color={color ?? neutral} size={size} />
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
  // It sits in the bottom trailing corner at the same margin as every other
  // edge, so its shape is the container-relative one: concentric with the
  // Live Activity's (or the island's) corner, radius = outer radius − margin.
  const scanButton = (color: string | null) =>
    live ? (
      <Link destination={props.scanUrl}>
        <HStack
          spacing={5}
          modifiers={[
            padding({ horizontal: 14, vertical: 8 }),
            background(color ?? "#3A3A3C", { shape: "containerRelativeShape" }),
          ]}
        >
          <Image systemName="qrcode.viewfinder" color="#FFFFFF" size={14} />
          <Text
            modifiers={[
              font({ size: 15, weight: "semibold" }),
              lineLimit(1),
              foregroundStyle("#FFFFFF"),
            ]}
          >
            {labels.scan}
          </Text>
        </HStack>
      </Link>
    ) : null;

  const compactLeading = <Image systemName={symbol} color={islandAccent} size={15} />;
  const compactTrailing = live
    ? counter(heroCount, 15, null, "semibold")
    : countdown(15, islandAccent, 52);

  // Minimal: the served share as a ring for meals, else the count or countdown.
  const minimal =
    servedShare !== null ? (
      <Gauge
        value={servedShare}
        modifiers={[
          gaugeStyle("circularCapacity"),
          tint(islandAccent),
          scaleEffect(0.46),
          frame({ width: 28, height: 28 }),
        ]}
      />
    ) : live ? (
      counter(heroCount, 13, islandAccent, "semibold")
    ) : (
      countdown(11, islandAccent, 34)
    );

  const expandedLeading = meal ? (
    <VStack modifiers={[padding({ leading: 8, top: 4 })]}>
      {stat(labels.served, scanned, null, "leading")}
    </VStack>
  ) : (
    <VStack modifiers={[padding({ leading: 8, top: 6 })]}>{glyph(islandAccent, 24)}</VStack>
  );
  // Inset from the island's rounded corners so labels never clip.
  const expandedTrailing = (
    <VStack alignment="trailing" modifiers={[padding({ trailing: 8, top: 4 })]}>
      {meal ? (
        stat(labels.remaining, heroCount, islandAccent, "trailing", 28, "bold")
      ) : live ? (
        stat(labels.scanned, scanned, islandAccent, "trailing", 28, "bold")
      ) : (
        <VStack alignment="trailing" spacing={0}>
          <Text modifiers={[font({ size: 12, weight: "medium" }), secondary, lineLimit(1)]}>
            {labels.startsIn}
          </Text>
          {countdown(28, islandAccent, 120)}
        </VStack>
      )}
    </VStack>
  );

  const nameBlock = (nameSize: number) => (
    <VStack
      alignment="leading"
      spacing={1}
      modifiers={[frame({ maxWidth: 10000, alignment: "leading" })]}
    >
      <Text modifiers={[font({ size: nameSize, weight: "semibold" }), lineLimit(1)]}>
        {props.name}
      </Text>
      <HStack modifiers={[font({ size: 13, weight: "medium" }), secondary, lineLimit(1)]}>
        {timeRange}
      </HStack>
    </VStack>
  );

  const expandedBottom = live ? (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[frame({ maxWidth: 10000, alignment: "leading" }), padding({ horizontal: 8 })]}
    >
      {bar(islandAccent)}
      <HStack spacing={8}>
        <VStack alignment="leading" spacing={1}>
          {meal && labels.inside ? (
            <Text modifiers={[font({ size: 13, weight: "medium" }), lineLimit(1)]}>
              {`${labels.inside} ${inside}`}
            </Text>
          ) : (
            <Text modifiers={[font({ size: 13, weight: "medium" }), lineLimit(1)]}>
              {props.name}
            </Text>
          )}
          {endsIn(13, 52)}
        </VStack>
        <Spacer />
        {scanButton(islandAccent)}
      </HStack>
    </VStack>
  ) : (
    <VStack modifiers={[padding({ horizontal: 8 })]}>{nameBlock(15)}</VStack>
  );

  // Lock Screen: unique layout, one 14 pt margin on every edge, default
  // background. Header: symbol, name, time · place, and the countdown to the
  // start (upcoming) or to the end (live). Live adds the stats row and a
  // bottom row with the bar and the Scan action in the trailing corner.
  const caption = (text: string | undefined) =>
    text ? (
      <Text modifiers={[font({ size: 12, weight: "medium" }), secondary, lineLimit(1)]}>
        {text}
      </Text>
    ) : null;
  // Live packs the header into one line (name … ends in; the place is
  // known by then and shown before the start) so the
  // stats and the bottom row fit the Lock Screen's 160 pt height with the
  // full 14 pt margin at the bottom too.
  const header = live ? (
    <HStack alignment="firstTextBaseline" spacing={8}>
      {glyph(bannerAccent, 17)}
      <Text modifiers={[font({ size: 17, weight: "semibold" }), lineLimit(1)]}>{props.name}</Text>
      <Spacer />
      {endsIn(13, 56)}
    </HStack>
  ) : (
    <HStack alignment="center" spacing={10}>
      <HStack modifiers={[frame({ width: 26 })]}>{glyph(bannerAccent, 20)}</HStack>
      {nameBlock(17)}
      <VStack alignment="trailing" spacing={0}>
        {caption(labels.startsIn)}
        {countdown(28, bannerAccent, 120)}
      </VStack>
    </HStack>
  );

  const stats = meal ? (
    <HStack alignment="top" spacing={8}>
      <VStack alignment="leading" modifiers={[frame({ maxWidth: 10000, alignment: "leading" })]}>
        {stat(labels.served, scanned, null, "leading")}
      </VStack>
      <VStack alignment="leading" modifiers={[frame({ maxWidth: 10000, alignment: "leading" })]}>
        {stat(labels.remaining, heroCount, bannerAccent, "leading", 28, "bold")}
      </VStack>
      <VStack alignment="trailing" modifiers={[frame({ maxWidth: 10000, alignment: "trailing" })]}>
        {stat(labels.inside, String(inside), null, "trailing")}
      </VStack>
    </HStack>
  ) : (
    <HStack alignment="top">
      {stat(labels.scanned, scanned, bannerAccent, "leading", 28, "bold")}
      <Spacer />
    </HStack>
  );

  const banner = (
    <VStack
      alignment="leading"
      spacing={10}
      modifiers={[frame({ maxWidth: 10000, alignment: "leading" }), padding({ all: 14 })]}
    >
      {header}
      {live ? stats : null}
      {live ? (
        <HStack alignment="center" spacing={14}>
          {bar(bannerAccent) ?? <Spacer />}
          {scanButton(bannerAccent)}
        </HStack>
      ) : null}
    </VStack>
  );

  // watchOS Smart Stack and CarPlay: name plus the countdown or hero count, no buttons.
  const bannerSmall = (
    <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 8 })]}>
      <HStack spacing={4}>
        <Image systemName={symbol} color={bannerAccent ?? neutral} size={12} />
        <Text modifiers={[font({ size: 13, weight: "medium" }), lineLimit(1), secondary]}>
          {props.name}
        </Text>
      </HStack>
      {live ? (
        <HStack spacing={4} alignment="firstTextBaseline">
          {counter(heroCount, 20, bannerAccent)}
          {meal && labels.remaining ? (
            <Text modifiers={[font({ size: 13, weight: "medium" }), secondary, lineLimit(1)]}>
              {labels.remaining}
            </Text>
          ) : null}
        </HStack>
      ) : (
        countdown(20, bannerAccent, null)
      )}
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
