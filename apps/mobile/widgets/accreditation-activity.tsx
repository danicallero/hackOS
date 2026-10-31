import { Gauge, HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  dynamicTypeSize,
  fixedSize,
  font,
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
import { type LiveActivityKit, withLiveActivityKit } from "./live-activity-kit";

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
export const AccreditationActivityLayout = withLiveActivityKit(
  (props: AccreditationLiveProps, environment: LiveActivityEnvironment, kit: LiveActivityKit) => {
    "widget";

    const { caption, counter: number, islandSide, secondary } = kit;
    const capped = kit.capped();
    // A newer, incompatible props shape degrades to a bare symbol.
    if (props.v !== 1 || !props.labels) {
      const title = (
        <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>
          {typeof props.accredited === "number" ? String(props.accredited) : ""}
        </Text>
      );
      const symbol = <Image systemName="person.badge.key.fill" color="#0A84FF" size={15} />;
      return capped({
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
      });
    }
    const labels = props.labels;
    // Same colour logic as the staff activity.
    const islandAccent = "#0A84FF";
    const neutral = "#8E8E93";
    const bannerAccent = environment.isLuminanceReduced
      ? null
      : ({ dynamic: { light: "#007AFF", dark: "#0A84FF" } } as unknown as string);
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

    // "412 /600": the hero count with its denominator, smaller and secondary.
    // Beside the camera a ratio past seven characters (`1412/1600`) keeps
    // only the count; the bar below still shows the share.
    const accreditedValue = (size: number, color: string | null, fixed = true) =>
      kit.ratioView(
        fixed
          ? { count: String(accredited), total: eligible !== null ? `/${eligible}` : null }
          : kit.ratioParts(accredited, eligible),
        { size, denominatorSize: Math.round(size * 0.55), spacing: 2, color, fixed },
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

    // #966: one 44 pt circular action, named for VoiceOver, separate from progress.
    const scanButton = (color: string | null) => kit.scanButton(props.scanUrl, labels.scan, color);

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
    const compactTrailing = number(String(accredited), 12, islandAccent, "semibold", false);

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
        number(String(accredited), 13, islandAccent, "semibold", false)
      );

    const expandedLeading = islandSide(
      scanButton(islandAccent) ?? <Image systemName={symbol} color={islandAccent} size={24} />,
      "leading",
      6,
    );
    const expandedTrailing = islandSide(
      stat(labels.accredited, accreditedValue(28, islandAccent, false), "trailing"),
      "trailing",
    );
    const secondaryStats = (
      <HStack alignment="top" spacing={12}>
        {stat(labels.lastTenMinutes, recentValue(17), "leading")}
        {inside !== null
          ? stat(labels.inside, number(String(inside), 17, null, "semibold"), "trailing")
          : null}
      </HStack>
    );
    const expandedBottom = (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[
          frame({ maxWidth: 10000, alignment: "leading" }),
          padding({ horizontal: 8, bottom: 4 }),
        ]}
      >
        <HStack spacing={8}>
          <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>
            {labels.title}
          </Text>
          <Spacer />
          {closesAt(13)}
        </HStack>
        <HStack alignment="center" spacing={12}>
          <HStack alignment="firstTextBaseline" spacing={12}>
            <HStack alignment="firstTextBaseline" spacing={4}>
              {caption(labels.lastTenMinutes)}
              {recentValue(17)}
            </HStack>
            {inside !== null ? (
              <HStack alignment="firstTextBaseline" spacing={4}>
                {caption(labels.inside)}
                {number(String(inside), 17, null, "semibold")}
              </HStack>
            ) : null}
          </HStack>
        </HStack>
        {bar(islandAccent)}
      </VStack>
    );

    // H22 / #966: one primary metric; pace and occupancy stay secondary.
    const banner = (
      <VStack
        alignment="leading"
        spacing={10}
        modifiers={[frame({ maxWidth: 10000, alignment: "leading" }), padding({ all: 14 })]}
      >
        <HStack spacing={8}>
          <Image systemName={symbol} color={bannerAccent ?? neutral} size={17} />
          <Text modifiers={[font({ size: 17, weight: "semibold" }), lineLimit(1)]}>
            {labels.title}
          </Text>
          <Spacer />
          {closesAt(13)}
        </HStack>
        <HStack alignment="center" spacing={12}>
          {scanButton(bannerAccent)}
          {secondaryStats}
          <Spacer />
          {stat(labels.accredited, accreditedValue(28, bannerAccent), "trailing")}
        </HStack>
        {bar(bannerAccent)}
      </VStack>
    );

    // watchOS Smart Stack and CarPlay (`.small` family, #966, H22, H24): glyph and
    // title in secondary, one hero value, at most one status line. The accent
    // tints the glyph only; Always-On drops it.
    const watchGlyph = environment.isLuminanceReduced ? null : islandAccent;
    const bannerSmall = (
      <VStack
        alignment="leading"
        spacing={2}
        modifiers={[
          frame({ maxWidth: 10000, alignment: "leading" }),
          padding({ horizontal: 10, vertical: 8 }),
          dynamicTypeSize({ max: "xLarge" }),
        ]}
      >
        <HStack spacing={5}>
          <Image systemName={symbol} color={watchGlyph ?? neutral} size={13} />
          <Text modifiers={[font({ size: 13, weight: "medium" }), lineLimit(1), secondary]}>
            {labels.title}
          </Text>
        </HStack>
        {accreditedValue(26, null)}
        {caption(labels.accredited)}
      </VStack>
    );

    return capped({
      banner,
      bannerSmall,
      compactLeading,
      compactTrailing,
      minimal,
      expandedLeading,
      expandedTrailing,
      expandedBottom,
    });
  },
);

export const AccreditationActivity = createLiveActivity<AccreditationLiveProps>(
  LIVE_ACTIVITY_WIDGET_NAMES.accreditation,
  AccreditationActivityLayout,
);
