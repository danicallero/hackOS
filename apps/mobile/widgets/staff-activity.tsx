import { Gauge, HStack, Image, Link, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  allowsTightening,
  background,
  contentTransition,
  dynamicTypeSize,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  gaugeStyle,
  labelsHidden,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
  scaleEffect,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { ActivityLiveProps } from "@hackos/shared/live-activities";
import { LIVE_ACTIVITY_WIDGET_NAMES } from "@hackos/shared/live-activities";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

/**
 * H25/H26 staff activity Live Activity (#966). Upcoming: "how long until it
 * starts?" (countdown). Live (H24/H25): "how many have come through?" —
 * `scanned/accredited`, with the scanned share as a ring (minimal) or a bar;
 * without `accredited` (older server) the bare count and a bar of the elapsed
 * time. While live, the single Scan action opens the scanner bound to the
 * activity.
 *
 * Live begins at the start without a push: an upcoming state is stale from
 * `startsAt` (`liveActivityStaleDate`), and iOS re-renders it then with
 * `environment.isStale`, which this layout reads as live. Until the live
 * update brings the counts, the island shows "Live" where the ratio goes.
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

  // Hard caps for the Dynamic Island (HIG: narrow, balanced, snug against
  // the camera): whatever the value, locale or text size, the island never
  // grows past them. Each slot is as wide as its content up to the cap; text
  // scales down rather than truncating, and the type size stays fixed.
  const islandSlot = (
    view: Parameters<typeof HStack>[0]["children"],
    width: number,
    alignment: "leading" | "center" | "trailing",
    // The outer end's inset, so the content's margin to the pill's rounded
    // end matches its top and bottom margins (HIG: concentric margins).
    inset: { leading?: number; trailing?: number } = {},
  ) => (
    <HStack
      spacing={0}
      modifiers={[
        frame({ maxWidth: width, alignment }),
        fixedSize({ horizontal: true }),
        padding(inset),
        minimumScaleFactor(0.6),
        dynamicTypeSize("large"),
      ]}
    >
      {view}
    </HStack>
  );
  const capped = <
    L extends { compactLeading: unknown; compactTrailing: unknown; minimal: unknown },
  >(
    layout: L,
  ) => ({
    ...layout,
    compactLeading: islandSlot(layout.compactLeading as never, 24, "trailing", { leading: 3 }),
    compactTrailing: islandSlot(layout.compactTrailing as never, 56, "leading", { trailing: 7 }),
    minimal: islandSlot(layout.minimal as never, 36, "center"),
  });
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
  // An upcoming state goes stale at the start: it is live from then on, even
  // before the push that flips `phase` (and brings the counts) arrives.
  const live =
    props.phase === "live" || (props.phase === "upcoming" && environment.isStale === true);
  const liveLabel = labels.live;
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

  // H24/H25: distinct people scanned out of accredited people.
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const scannedCount = count(props.scanned) ?? 0;
  const accredited = props.phase === "live" ? count(props.accredited) : null;
  const share = accredited ? Math.min(1, scannedCount / accredited) : null;
  const scanned = String(scannedCount);

  // `2h 34m` from an hour, `34m 21s` below it, ticking live and never
  // H:MM:SS (`compactCountdown`); `short` keeps the leading unit (`2h`,
  // `34m`), `long` adds the seconds from an hour (`2h 34m 21s`). It is as wide as its value; a width cap scales it down rather
  // than truncating.
  const countdown = (
    size: number,
    color: string | null,
    width: number | null,
    form: "full" | "short" | "long" = "full",
  ) => (
    <Text
      timerInterval={{ lower, upper: startsAt }}
      countsDown
      compactCountdown={form}
      compactCountdownSize={size}
      modifiers={[
        lineLimit(1),
        minimumScaleFactor(0.6),
        ...(width ? [frame({ maxWidth: width, alignment: "trailing" })] : []),
        ...colorMods(color),
      ]}
    />
  );

  // Countdown to the end, for the live bar's trailing label.
  const endsIn = (size: number, width: number, stacked = true) => {
    if (!validEnd) return null;
    const label = labels.endsIn ? (
      <Text modifiers={[font({ size: 12, weight: "medium" }), secondary, lineLimit(1)]}>
        {labels.endsIn}
      </Text>
    ) : null;
    const value = (
      <Text
        timerInterval={{ lower: startsAt, upper: endsAt }}
        countsDown
        compactCountdown="full"
        compactCountdownSize={size}
        modifiers={[
          lineLimit(1),
          minimumScaleFactor(0.6),
          frame({ maxWidth: width, alignment: "leading" }),
        ]}
      />
    );
    return stacked ? (
      <VStack alignment="leading" spacing={0}>
        {label}
        {value}
      </VStack>
    ) : (
      <HStack alignment="firstTextBaseline" spacing={4}>
        {label}
        {value}
      </HStack>
    );
  };

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

  // "42/180": the scanned count with its denominator, smaller and secondary
  // (as the accreditation desk's `accredited/eligible`).
  const ratio = (size: number, denominatorSize: number, color: string | null, weight = "bold") => (
    <HStack alignment="firstTextBaseline" spacing={1} modifiers={[fixedSize({ horizontal: true })]}>
      {counter(scanned, size, color, weight)}
      {accredited ? (
        <Text
          modifiers={[
            font({ size: denominatorSize, weight: "semibold" }),
            monospacedDigit(),
            contentTransition("numericText"),
            secondary,
            lineLimit(1),
          ]}
        >
          {`/${accredited}`}
        </Text>
      ) : null}
    </HStack>
  );

  const stat = (label: string | undefined, color: string | null, align: "leading" | "trailing") => (
    <VStack alignment={align} spacing={0}>
      {label ? (
        <Text modifiers={[font({ size: 12, weight: "medium" }), secondary, lineLimit(1)]}>
          {label}
        </Text>
      ) : null}
      {ratio(28, 15, color)}
    </VStack>
  );

  // The scanned share; without a denominator, elapsed time from start to end.
  const bar = (color: string | null) =>
    share !== null ? (
      <ProgressView value={share} modifiers={[tint(color ?? neutral)]} />
    ) : validEnd ? (
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

  // H22/H25 / #966: one direct Scan action, with the same inset capsule
  // in the island and on the Lock Screen.
  const scanButton = (color: string | null) =>
    live ? (
      <Link destination={props.scanUrl}>
        <HStack
          spacing={5}
          modifiers={[
            padding({ horizontal: 12, vertical: 8 }),
            background(color ? "#0066CC" : "#3A3A3C", { shape: "capsule" }),
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
    ) : null;

  // The running badge: a dot and "Live" in the accent, no container.
  const liveBadge = (size: number, color: string) =>
    liveLabel ? (
      <HStack spacing={Math.round(size / 3)} modifiers={[fixedSize({ horizontal: true })]}>
        <Image systemName="circle.fill" color={color} size={Math.round(size * 0.5)} />
        <Text
          modifiers={[font({ size, weight: "semibold" }), lineLimit(1), foregroundStyle(color)]}
        >
          {liveLabel}
        </Text>
      </HStack>
    ) : null;

  // Compact: the symbol a little larger than the text so both sides weigh
  // about the same; the countdown is as wide as its value, snug to the camera.
  // Live shows `scanned/accredited`, the operational datum; until the counts
  // arrive (an older server, or the start before its update), "Live".
  const compactLeading = <Image systemName={symbol} color={islandAccent} size={15} />;
  const liveText = liveLabel ? (
    <Text
      modifiers={[
        font({ size: 12, weight: "semibold" }),
        lineLimit(1),
        minimumScaleFactor(0.6),
        foregroundStyle(islandAccent),
      ]}
    >
      {liveLabel}
    </Text>
  ) : null;
  // Past `142/180` the ratio no longer fits the 56 pt slot (`1142/1380`
  // clipped its denominator), so four-digit counts show the scanned count alone.
  const compactTrailing = !live
    ? countdown(12, islandAccent, 56)
    : accredited || !liveText
      ? `${scanned}/${accredited ?? ""}`.length > 7
        ? counter(scanned, 15, islandAccent, "semibold")
        : ratio(15, 11, islandAccent, "semibold")
      : liveText;

  // Minimal: the scanned share as a ring; live without it, the symbol with a
  // live dot (or the bare count from a build without the label); else the
  // countdown.
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
    ) : live && liveLabel ? (
      <HStack spacing={2}>
        {glyph(islandAccent, 12)}
        <Image systemName="circle.fill" color={islandAccent} size={5} />
      </HStack>
    ) : live ? (
      counter(scanned, 13, islandAccent, "semibold")
    ) : (
      countdown(10, islandAccent, 36, "short")
    );

  const expandedLeading = (
    <VStack modifiers={[padding({ leading: 8, top: 6 })]}>{glyph(islandAccent, 24)}</VStack>
  );
  // Inset from the island's rounded corners so labels never clip.
  const expandedTrailing = (
    <VStack alignment="trailing" modifiers={[padding({ trailing: 8, top: 4 })]}>
      {live ? (
        stat(labels.scanned, islandAccent, "trailing")
      ) : (
        <VStack alignment="trailing" spacing={0}>
          <Text modifiers={[font({ size: 12, weight: "medium" }), secondary, lineLimit(1)]}>
            {labels.startsIn}
          </Text>
          {countdown(28, islandAccent, 160, "long")}
        </VStack>
      )}
    </VStack>
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
        <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>{props.name}</Text>
        <Spacer />
        {live ? liveBadge(12, islandAccent) : null}
      </HStack>
      <HStack alignment="center" spacing={12}>
        {live ? (
          endsIn(17, 100, false)
        ) : (
          <HStack modifiers={[font({ size: 13, weight: "medium" }), secondary, lineLimit(1)]}>
            {timeRange}
          </HStack>
        )}
        {live ? <Spacer /> : null}
        {scanButton(islandAccent)}
      </HStack>
      {live ? bar(islandAccent) : null}
    </VStack>
  );

  // H25/H26 / #966: preserve the trailing hero across all presentations.
  const caption = (text: string | undefined) =>
    text ? (
      <Text modifiers={[font({ size: 12, weight: "medium" }), secondary, lineLimit(1)]}>
        {text}
      </Text>
    ) : null;
  const banner = (
    <VStack
      alignment="leading"
      spacing={10}
      modifiers={[frame({ maxWidth: 10000, alignment: "leading" }), padding({ all: 14 })]}
    >
      <HStack spacing={8}>
        {glyph(bannerAccent, 17)}
        <Text modifiers={[font({ size: 17, weight: "semibold" }), lineLimit(1)]}>{props.name}</Text>
        <Spacer />
        {live ? liveBadge(12, bannerAccent ?? neutral) : null}
      </HStack>
      <HStack alignment="bottom" spacing={12}>
        <VStack
          alignment="leading"
          spacing={2}
          modifiers={[frame({ maxWidth: 10000, alignment: "leading" })]}
        >
          {live ? (
            endsIn(17, 100)
          ) : (
            <HStack modifiers={[font({ size: 13, weight: "medium" }), secondary, lineLimit(1)]}>
              {timeRange}
            </HStack>
          )}
        </VStack>
        {live ? (
          stat(labels.scanned, bannerAccent, "trailing")
        ) : (
          <VStack alignment="trailing" spacing={0}>
            {caption(labels.startsIn)}
            {countdown(28, bannerAccent, 180, "long")}
          </VStack>
        )}
      </HStack>
      {live ? (
        <HStack alignment="center" spacing={12}>
          {bar(bannerAccent) ?? <Spacer />}
          {scanButton(bannerAccent)}
        </HStack>
      ) : null}
    </VStack>
  );

  // watchOS Smart Stack and CarPlay: name plus the countdown or the count, no buttons.
  const bannerSmall = (
    <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 8 })]}>
      <HStack spacing={4}>
        <Image systemName={symbol} color={bannerAccent ?? neutral} size={12} />
        <Text modifiers={[font({ size: 13, weight: "medium" }), lineLimit(1), secondary]}>
          {props.name}
        </Text>
      </HStack>
      {live ? ratio(20, 13, bannerAccent) : countdown(20, bannerAccent, null)}
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
};

export const StaffActivity = createLiveActivity<ActivityLiveProps>(
  LIVE_ACTIVITY_WIDGET_NAMES.activity,
  StaffActivityLayout,
);
