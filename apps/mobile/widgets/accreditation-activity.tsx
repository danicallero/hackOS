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
  lineLimit,
  monospacedDigit,
  padding,
  scaleEffect,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { AccreditationLiveProps } from "@hackos/shared/live-activities";
import { LIVE_ACTIVITY_WIDGET_NAMES } from "@hackos/shared/live-activities";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

/**
 * H22/H24/H27 accreditation desk Live Activity (#966), for `accredit:scan`
 * holders during the arrival rush. It answers "how far along is check-in?":
 * accredited out of eligible is the hero, with a bar of that share; people
 * inside and the arrivals in the last 10 minutes (desk pace) are secondary.
 * The single Scan action opens the accreditation scanner; the window's end
 * shows as a clock time.
 *
 * See `queue-activity.tsx` for the `'widget'` runtime constraints: everything
 * the layout needs is declared inside the function or arrives in props.
 */
export const AccreditationActivityLayout = (
  props: AccreditationLiveProps,
  environment: LiveActivityEnvironment,
) => {
  "widget";
  // A newer, incompatible props shape degrades to a bare symbol.
  if (props.v !== 1 || !props.labels) {
    const title = (
      <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>
        {typeof props.accredited === "number" ? String(props.accredited) : ""}
      </Text>
    );
    const symbol = <Image systemName="person.badge.key.fill" color="#0A84FF" size={15} />;
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
  // Same colour logic as the staff activity.
  const islandAccent = "#0A84FF";
  const neutral = "#8E8E93";
  const bannerAccent = environment.isLuminanceReduced
    ? null
    : ({ dynamic: { light: "#007AFF", dark: "#0A84FF" } } as unknown as string);
  const colorMods = (color: string | null) => (color ? [foregroundStyle(color)] : []);
  const secondary = foregroundStyle({ type: "hierarchical", style: "secondary" });
  const symbol = "person.badge.key.fill";

  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const accredited = count(props.accredited) ?? 0;
  const eligible = count(props.eligible);
  const inside = count(props.inside);
  const recent = count(props.recentArrivals) ?? 0;
  const share = eligible && eligible > 0 ? Math.min(1, accredited / eligible) : null;
  const endsAt = new Date(props.endsAt);
  const validEnd = Number.isFinite(endsAt.getTime());

  const number = (value: string, size: number, color: string | null, weight = "bold") => (
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
  const caption = (text: string | undefined) =>
    text ? (
      <Text modifiers={[font({ size: 12, weight: "medium" }), secondary, lineLimit(1)]}>
        {text}
      </Text>
    ) : null;

  // "412 /600": the hero count with its denominator, smaller and secondary.
  const accreditedValue = (size: number, color: string | null) => (
    <HStack alignment="firstTextBaseline" spacing={2} modifiers={[fixedSize({ horizontal: true })]}>
      {number(String(accredited), size, color)}
      {eligible !== null ? (
        <Text
          modifiers={[
            font({ size: Math.round(size * 0.55), weight: "semibold" }),
            monospacedDigit(),
            secondary,
            lineLimit(1),
          ]}
        >
          {`/${eligible}`}
        </Text>
      ) : null}
    </HStack>
  );
  const stat = (
    label: string | undefined,
    value: ReturnType<typeof number>,
    align: "leading" | "trailing",
  ) => (
    <VStack alignment={align} spacing={0}>
      {caption(label)}
      {value}
    </VStack>
  );
  const recentValue = (size: number) => number(`+${recent}`, size, null, "semibold");

  const bar = (color: string | null) =>
    share !== null ? <ProgressView value={share} modifiers={[tint(color ?? neutral)]} /> : null;

  // The single interactive element (HIG), concentric with the corner it sits
  // in: radius = outer radius − margin (`containerRelativeShape`).
  const scanButton = (color: string | null) => (
    <Link destination={props.scanUrl}>
      <HStack
        spacing={5}
        modifiers={[
          padding({ horizontal: 14, vertical: 8 }),
          background(color ?? "#3A3A3C", { shape: "containerRelativeShape" }),
        ]}
      >
        <Image systemName="wave.3.right" color="#FFFFFF" size={14} />
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
  );

  // The window's end as a clock time beside a clock symbol.
  const closesAt = (size: number) =>
    validEnd ? (
      <HStack spacing={3} modifiers={[fixedSize({ horizontal: true }), secondary]}>
        <Image systemName="clock" color={neutral} size={size - 1} />
        <Text
          date={endsAt}
          dateStyle="time"
          modifiers={[font({ size, weight: "medium" }), monospacedDigit(), secondary]}
        />
      </HStack>
    ) : null;

  const compactLeading = <Image systemName={symbol} color={islandAccent} size={15} />;
  const compactTrailing = number(String(accredited), 15, null, "semibold");

  // Minimal: the accredited share as a ring.
  const minimal =
    share !== null ? (
      <Gauge
        value={share}
        modifiers={[
          gaugeStyle("circularCapacity"),
          tint(islandAccent),
          scaleEffect(0.46),
          frame({ width: 28, height: 28 }),
        ]}
      />
    ) : (
      number(String(accredited), 13, islandAccent, "semibold")
    );

  const expandedLeading = (
    <VStack modifiers={[padding({ leading: 8, top: 4 })]}>
      {stat(labels.accredited, accreditedValue(28, islandAccent), "leading")}
    </VStack>
  );
  // Inset from the island's rounded corners so labels never clip.
  const expandedTrailing = (
    <VStack alignment="trailing" modifiers={[padding({ trailing: 8, top: 4 })]}>
      {stat(labels.lastTenMinutes, recentValue(28), "trailing")}
    </VStack>
  );
  const expandedBottom = (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[frame({ maxWidth: 10000, alignment: "leading" }), padding({ horizontal: 8 })]}
    >
      {bar(islandAccent)}
      <HStack spacing={8}>
        <VStack alignment="leading" spacing={1}>
          {inside !== null && labels.inside ? (
            <Text modifiers={[font({ size: 13, weight: "medium" }), lineLimit(1)]}>
              {`${labels.inside} ${inside}`}
            </Text>
          ) : (
            <Text modifiers={[font({ size: 13, weight: "medium" }), lineLimit(1)]}>
              {labels.title}
            </Text>
          )}
          {closesAt(13)}
        </VStack>
        <Spacer />
        {scanButton(islandAccent)}
      </HStack>
    </VStack>
  );

  // Lock Screen: one 14 pt margin on every edge. Header: symbol, title …
  // closing time; stats (accredited hero · last 10 min · inside); bar with
  // Scan in the bottom trailing corner.
  const header = (
    <HStack alignment="center" spacing={8}>
      <Image systemName={symbol} color={bannerAccent ?? neutral} size={17} />
      <Text modifiers={[font({ size: 17, weight: "semibold" }), lineLimit(1)]}>{labels.title}</Text>
      <Spacer />
      {closesAt(13)}
    </HStack>
  );
  const stats = (
    <HStack alignment="top" spacing={8}>
      <VStack alignment="leading" modifiers={[frame({ maxWidth: 10000, alignment: "leading" })]}>
        {stat(labels.accredited, accreditedValue(28, bannerAccent), "leading")}
      </VStack>
      <VStack
        alignment={inside !== null ? "leading" : "trailing"}
        modifiers={[
          frame({ maxWidth: 10000, alignment: inside !== null ? "leading" : "trailing" }),
        ]}
      >
        {stat(labels.lastTenMinutes, recentValue(28), inside !== null ? "leading" : "trailing")}
      </VStack>
      {inside !== null ? (
        <VStack
          alignment="trailing"
          modifiers={[frame({ maxWidth: 10000, alignment: "trailing" })]}
        >
          {stat(labels.inside, number(String(inside), 28, null, "semibold"), "trailing")}
        </VStack>
      ) : null}
    </HStack>
  );
  const banner = (
    <VStack
      alignment="leading"
      spacing={10}
      modifiers={[frame({ maxWidth: 10000, alignment: "leading" }), padding({ all: 14 })]}
    >
      {header}
      {stats}
      <HStack alignment="center" spacing={14}>
        {bar(bannerAccent) ?? <Spacer />}
        {scanButton(bannerAccent)}
      </HStack>
    </VStack>
  );

  // watchOS Smart Stack and CarPlay: title and accredited/eligible, no buttons.
  const bannerSmall = (
    <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 8 })]}>
      <HStack spacing={4}>
        <Image systemName={symbol} color={bannerAccent ?? neutral} size={12} />
        <Text modifiers={[font({ size: 13, weight: "medium" }), lineLimit(1), secondary]}>
          {labels.title}
        </Text>
      </HStack>
      {accreditedValue(20, bannerAccent)}
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

export const AccreditationActivity = createLiveActivity<AccreditationLiveProps>(
  LIVE_ACTIVITY_WIDGET_NAMES.accreditation,
  AccreditationActivityLayout,
);
