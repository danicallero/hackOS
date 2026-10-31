import { Gauge, HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  allowsTightening,
  contentTransition,
  dynamicTypeSize,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  gaugeStyle,
  labelsHidden,
  layoutPriority,
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
import { type LiveActivityKit, withLiveActivityKit } from "./live-activity-kit";

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
export const StaffActivityLayout = withLiveActivityKit(
  (props: ActivityLiveProps, environment: LiveActivityEnvironment, kit: LiveActivityKit) => {
    "widget";

    const { caption, colorMods, islandSide, secondary } = kit;
    const capped = kit.capped();
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

    // #966: unit values carry no leading zero (`1h 5m`, `9m`, `9s`); the last five minutes use colon notation (`4:05`).
    // The native timer removes seconds entirely in Always-On and fits its width.
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

    // "42/180": the scanned count with its denominator, smaller and secondary
    // (as the accreditation desk's `accredited/eligible`). Inside the island a
    // ratio past seven characters (`1142/1380`) keeps only the count.
    const ratio = (
      size: number,
      denominatorSize: number,
      color: string | null,
      weight = "bold",
      fixed = true,
    ) => {
      const parts = fixed
        ? { count: scanned, total: accredited ? `/${accredited}` : null }
        : kit.ratioParts(scannedCount, accredited || null);
      return (
        <HStack
          alignment="firstTextBaseline"
          spacing={1}
          modifiers={fixed ? [fixedSize({ horizontal: true })] : []}
        >
          {counter(parts.count, size, color, weight, fixed)}
          {parts.total ? (
            <Text
              modifiers={[
                font({ size: denominatorSize, weight: "semibold" }),
                monospacedDigit(),
                contentTransition("numericText"),
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

    const stat = (
      label: string | undefined,
      color: string | null,
      align: "leading" | "trailing",
      fixed = true,
    ) => (
      <VStack alignment={align} spacing={0}>
        {label ? (
          <Text modifiers={[font({ size: 12, weight: "medium" }), secondary, lineLimit(1)]}>
            {label}
          </Text>
        ) : null}
        {ratio(28, 15, color, "bold", fixed)}
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

    // #966: one 44 pt circular action, named for VoiceOver, separate from progress.
    const scanButton = (color: string | null) =>
      live ? kit.scanButton(props.scanUrl, labels.scan, color) : null;

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
      ? countdown(12, islandAccent, 56, "short")
      : accredited || !liveText
        ? ratio(12, 9, islandAccent, "semibold", false)
        : liveText;

    // Minimal: the scanned share as a ring; live without it, the symbol with a
    // live dot (or the bare count from a build without the label); upcoming
    // keeps the category recognizable instead of shrinking a multi-unit timer.
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
          {glyph(islandAccent, 18)}
          <Image systemName="circle.fill" color={islandAccent} size={5} />
        </HStack>
      ) : live ? (
        counter(scanned, 13, islandAccent, "semibold", false)
      ) : (
        glyph(islandAccent, 20)
      );

    const expandedLeading = islandSide(
      scanButton(islandAccent) ?? glyph(islandAccent, 24),
      "leading",
      6,
    );
    const expandedTrailing = islandSide(
      live ? (
        stat(labels.scanned, islandAccent, "trailing", false)
      ) : (
        <VStack alignment="trailing" spacing={0}>
          <Text modifiers={[font({ size: 12, weight: "medium" }), secondary, lineLimit(1)]}>
            {labels.startsIn}
          </Text>
          {countdown(28, islandAccent, 160, "long")}
        </VStack>
      ),
      "trailing",
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
            {props.name}
          </Text>
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
        </HStack>
        {live ? bar(islandAccent) : null}
      </VStack>
    );

    // H25/H26 / #966: preserve the trailing hero across all presentations.
    const banner = (
      <VStack
        alignment="leading"
        spacing={10}
        modifiers={[frame({ maxWidth: 10000, alignment: "leading" }), padding({ all: 14 })]}
      >
        <HStack spacing={8}>
          {glyph(bannerAccent, 17)}
          <Text modifiers={[font({ size: 17, weight: "semibold" }), lineLimit(1)]}>
            {props.name}
          </Text>
          <Spacer />
          {live ? liveBadge(12, bannerAccent ?? neutral) : null}
        </HStack>
        <HStack alignment="center" spacing={12}>
          {scanButton(bannerAccent)}
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
        {live ? bar(bannerAccent) : null}
      </VStack>
    );

    // watchOS Smart Stack and CarPlay (`.small` family, #966, H25, H26): glyph and
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
            {props.name}
          </Text>
        </HStack>
        {live ? (
          ratio(26, 14, null)
        ) : (
          <Text
            timerInterval={{ lower, upper: startsAt }}
            countsDown
            compactCountdown="full"
            compactCountdownSize={26}
            compactCountdownWeight="bold"
            modifiers={[
              lineLimit(1),
              minimumScaleFactor(0.6),
              frame({ maxWidth: 10000, alignment: "leading" }),
            ]}
          />
        )}
        {live && labels.scanned ? (
          <Text modifiers={[font({ size: 13, weight: "medium" }), secondary, lineLimit(1)]}>
            {labels.scanned}
          </Text>
        ) : null}
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

export const StaffActivity = createLiveActivity<ActivityLiveProps>(
  LIVE_ACTIVITY_WIDGET_NAMES.activity,
  StaffActivityLayout,
);
