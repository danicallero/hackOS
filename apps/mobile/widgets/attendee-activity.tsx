import { HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  dynamicTypeSize,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  labelsHidden,
  lineLimit,
  minimumScaleFactor,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { AttendeeActivityLiveProps } from "@hackos/shared/live-activities";
import { LIVE_ACTIVITY_WIDGET_NAMES } from "@hackos/shared/live-activities";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

/**
 * H59 attendee Live Activity (#966): a schedule item organizers opted in for
 * its audience. Upcoming answers "how long until it starts?" (countdown hero,
 * name, time · place); live answers "how long is left?" (a "Live" badge, the
 * name, an ends-in countdown and a bar of the elapsed time). No buttons: the
 * whole surface opens the item (`hackos://schedule/<id>`).
 *
 * Live begins at the start without a push: an upcoming state is stale from
 * `startsAt` (`liveActivityStaleDate`), and iOS re-renders it then with
 * `environment.isStale`, which this layout reads as live.
 *
 * See `queue-activity.tsx` for the `'widget'` runtime constraints: everything
 * the layout needs is declared inside the function or arrives in props.
 * Countdowns and the time bar are SwiftUI timers, so they tick without
 * updates. A missing label hides its element, never falls back to copy.
 */
export const AttendeeActivityLayout = (
  props: AttendeeActivityLiveProps,
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
    const symbol = <Image systemName="calendar" color="#0A84FF" size={15} />;
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
  // Same colour logic as the staff activity: the island is always dark, the
  // Lock Screen accent is dynamic, Always-On drops the accent.
  const islandAccent = "#0A84FF";
  const neutral = "#8E8E93";
  const bannerAccent = environment.isLuminanceReduced
    ? null
    : ({ dynamic: { light: "#007AFF", dark: "#0A84FF" } } as unknown as string);
  const colorMods = (color: string | null) => (color ? [foregroundStyle(color)] : []);
  const secondary = foregroundStyle({ type: "hierarchical", style: "secondary" });
  // An upcoming state goes stale at the start: it is live from then on, even
  // before the push that flips `phase` arrives.
  const live =
    props.phase === "live" || (props.phase === "upcoming" && environment.isStale === true);
  // "Live" (older servers: "Now"); absent, the badge is left out.
  const liveLabel = labels.live || labels.now;
  // Mirrors `ActivityKind.symbol` (packages/shared/src/activity-kinds.ts).
  const symbol =
    props.category === "meal"
      ? "fork.knife"
      : props.category === "talk" || props.category === "workshop"
        ? "mic.fill"
        : props.category === "ceremony"
          ? "party.popper.fill"
          : props.category === "deadline"
            ? "flag.fill"
            : props.category === "activity"
              ? "sparkles"
              : "calendar";

  const startsAt = new Date(props.startsAt);
  const endsAt = new Date(props.endsAt);
  const validStart = Number.isFinite(startsAt.getTime());
  const validEnd = validStart && Number.isFinite(endsAt.getTime()) && endsAt > startsAt;
  // A ClosedRange needs lower <= upper; the server timestamp can trail the
  // start. Any earlier lower bound renders the same remaining time.
  const updatedAt = Date.parse(props.updatedAt);
  const lower = new Date(
    Number.isFinite(updatedAt)
      ? Math.min(updatedAt, startsAt.getTime())
      : startsAt.getTime() - 3_600_000,
  );

  // #966: minute precision normally; seconds only in the last five minutes.
  // The native timer removes seconds and their spacing in Always-On.
  const timer = (
    size: number,
    color: string | null,
    width: number | null,
    weight: "semibold" | "bold" = "semibold",
    form: "full" | "short" | "long" = "full",
  ) =>
    (live ? validEnd : validStart) ? (
      <Text
        timerInterval={live ? { lower: startsAt, upper: endsAt } : { lower, upper: startsAt }}
        countsDown
        compactCountdown={form}
        compactCountdownSize={size}
        compactCountdownWeight={weight}
        modifiers={[
          lineLimit(1),
          minimumScaleFactor(0.6),
          ...(width ? [frame({ maxWidth: width, alignment: "trailing" })] : []),
          ...colorMods(color),
        ]}
      />
    ) : null;

  const caption = (text: string | undefined) =>
    text ? (
      <Text modifiers={[font({ size: 12, weight: "medium" }), secondary, lineLimit(1)]}>
        {text}
      </Text>
    ) : null;

  // Countdown with its caption above: "Starts in" with the seconds, or
  // "Ends in" (`1h 05m` / `34m 21s`).
  const countdownStat = (size: number, color: string | null, width: number) => {
    const value = timer(size, color, width, "bold", live ? "full" : "long");
    return value ? (
      <VStack alignment="trailing" spacing={0}>
        {caption(live ? labels.endsIn : labels.startsIn)}
        {value}
      </VStack>
    ) : null;
  };

  // Elapsed time between the start and the end (live only).
  const bar = (color: string | null) =>
    live && validEnd ? (
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

  const timeAndPlace = (
    <HStack spacing={0}>
      {validStart ? <Text date={startsAt} dateStyle="time" /> : null}
      {validEnd ? <Text>–</Text> : null}
      {validEnd ? <Text date={endsAt} dateStyle="time" /> : null}
      {props.location ? (
        <Text modifiers={[lineLimit(1)]}>
          {validStart ? ` · ${props.location}` : props.location}
        </Text>
      ) : null}
    </HStack>
  );

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

  const context = (
    <HStack modifiers={[font({ size: 13, weight: "medium" }), secondary, lineLimit(1)]}>
      {timeAndPlace}
    </HStack>
  );

  // Compact: the symbol a little larger than the text so both sides weigh
  // about the same; the countdown is as wide as its value, snug to the camera.
  const compactLeading = glyph(islandAccent, 15);
  // The accent countdown to the start, then "Live" (one colour with the
  // symbol, so both sides read as one piece of information).
  const liveText = (size: number) =>
    liveLabel ? (
      <Text
        modifiers={[
          font({ size, weight: "semibold" }),
          lineLimit(1),
          minimumScaleFactor(0.6),
          foregroundStyle(islandAccent),
        ]}
      >
        {liveLabel}
      </Text>
    ) : null;
  const compactTrailing = (live ? liveText(12) : timer(12, islandAccent, 56)) ?? <Text> </Text>;

  // #966: minimal keeps the category recognizable; live adds a status dot.
  const minimal = live ? (
    <HStack spacing={2}>
      {glyph(islandAccent, 18)}
      <Image systemName="circle.fill" color={islandAccent} size={5} />
    </HStack>
  ) : (
    glyph(islandAccent, 20)
  );

  const expandedLeading = (
    <VStack modifiers={[padding({ leading: 8, top: 6 })]}>{glyph(islandAccent, 24)}</VStack>
  );
  // Inset from the island's rounded corners so labels never clip.
  const expandedTrailing = (
    <VStack alignment="trailing" modifiers={[padding({ trailing: 8, top: 4 })]}>
      {countdownStat(28, live ? null : islandAccent, 160) ?? <Text> </Text>}
    </VStack>
  );
  const expandedBottom = (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[
        frame({ maxWidth: 10000, alignment: "leading" }),
        padding({ horizontal: 8, bottom: 8 }),
      ]}
    >
      <HStack spacing={8}>
        <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>{props.name}</Text>
        <Spacer />
        {live ? liveBadge(12, islandAccent) : null}
      </HStack>
      {context}
      {bar(islandAccent)}
    </VStack>
  );

  // H59 / #966: shared header, context + trailing hero, optional progress.
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
          {context}
        </VStack>
        {countdownStat(28, live ? null : bannerAccent, 180)}
      </HStack>
      {bar(bannerAccent)}
    </VStack>
  );

  // watchOS Smart Stack and CarPlay (`.small` family, #966, H59): glyph and
  // title in secondary, one hero value, at most one status line. The accent
  // tints the glyph only; Always-On drops it.
  const watchGlyph = environment.isLuminanceReduced ? null : islandAccent;
  const watchTimer = (size: number, weight: "semibold" | "bold", muted: boolean) =>
    (live ? validEnd : validStart) ? (
      <Text
        timerInterval={live ? { lower: startsAt, upper: endsAt } : { lower, upper: startsAt }}
        countsDown
        compactCountdown="full"
        compactCountdownSize={size}
        compactCountdownWeight={weight}
        modifiers={[
          lineLimit(1),
          minimumScaleFactor(0.6),
          frame({ maxWidth: 10000, alignment: "leading" }),
          ...(muted ? [secondary] : []),
        ]}
      />
    ) : null;
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
      {live && liveLabel ? (
        <Text
          modifiers={[font({ size: 24, weight: "bold" }), lineLimit(1), minimumScaleFactor(0.6)]}
        >
          {liveLabel}
        </Text>
      ) : (
        watchTimer(26, "bold", false)
      )}
      {live && liveLabel ? (
        <HStack alignment="firstTextBaseline" spacing={4}>
          {labels.endsIn ? (
            <Text modifiers={[font({ size: 13, weight: "medium" }), secondary, lineLimit(1)]}>
              {labels.endsIn}
            </Text>
          ) : null}
          {watchTimer(13, "semibold", true)}
        </HStack>
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
};

export const AttendeeActivity = createLiveActivity<AttendeeActivityLiveProps>(
  LIVE_ACTIVITY_WIDGET_NAMES.attendee_activity,
  AttendeeActivityLayout,
);
