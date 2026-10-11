import { HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  fixedSize,
  font,
  foregroundStyle,
  frame,
  labelsHidden,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { AttendeeActivityLiveProps } from "@hackos/shared/live-activities";
import { LIVE_ACTIVITY_WIDGET_NAMES } from "@hackos/shared/live-activities";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

/**
 * H59 attendee Live Activity (#966): a schedule item organizers opted in for
 * its audience. Upcoming answers "how long until it starts?" (countdown hero,
 * name, time · place); live answers "how long is left?" ("Now", the name, an
 * ends-in countdown and a bar of the elapsed time). No buttons: the whole
 * surface opens the item (`hackos://schedule/<id>`).
 *
 * See `queue-activity.tsx` for the `'widget'` runtime constraints: everything
 * the layout needs is declared inside the function or arrives in props.
 * Countdowns (`1h 20m`, never H:MM:SS) and the time bar are SwiftUI
 * timers, so they tick without updates. A missing label hides its element, never falls back to copy.
 */
export const AttendeeActivityLayout = (
  props: AttendeeActivityLiveProps,
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
    const symbol = <Image systemName="calendar" color="#0A84FF" size={15} />;
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
  // Same colour logic as the staff activity: the island is always dark, the
  // Lock Screen accent is dynamic, Always-On drops the accent.
  const islandAccent = "#0A84FF";
  const neutral = "#8E8E93";
  const bannerAccent = environment.isLuminanceReduced
    ? null
    : ({ dynamic: { light: "#007AFF", dark: "#0A84FF" } } as unknown as string);
  const colorMods = (color: string | null) => (color ? [foregroundStyle(color)] : []);
  const secondary = foregroundStyle({ type: "hierarchical", style: "secondary" });
  const live = props.phase === "live";
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

  // Upcoming counts down to the start, live to the end: `1h 20m`, `10m`,
  // `59s` (`labels.units`; an older server's props keep the H:MM:SS timer).
  // One line that scales down rather than truncating in every presentation.
  const timer = (
    size: number,
    color: string | null,
    width: number | null,
    weight = "semibold",
    maxUnits = 2,
  ) =>
    (live ? validEnd : validStart) ? (
      <Text
        timerInterval={live ? { lower: startsAt, upper: endsAt } : { lower, upper: startsAt }}
        countsDown
        countdownUnits={labels.units}
        countdownMaxUnits={maxUnits}
        modifiers={[
          font({ size, weight: weight as "semibold" | "bold" }),
          monospacedDigit(),
          lineLimit(1),
          minimumScaleFactor(0.6),
          multilineTextAlignment("trailing"),
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

  // Countdown with its caption above ("Starts in" / "Ends in").
  const countdownStat = (size: number, color: string | null, width: number) => {
    const value = timer(size, color, width, "bold");
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

  // Name with "Now" ahead of it while live, then time · place.
  const nameBlock = (nameSize: number) => (
    <VStack
      alignment="leading"
      spacing={1}
      modifiers={[frame({ maxWidth: 10000, alignment: "leading" })]}
    >
      {live && labels.now ? (
        <Text
          modifiers={[
            font({ size: 12, weight: "semibold" }),
            lineLimit(1),
            ...colorMods(bannerAccent ?? neutral),
          ]}
        >
          {labels.now}
        </Text>
      ) : null}
      <Text modifiers={[font({ size: nameSize, weight: "semibold" }), lineLimit(1)]}>
        {props.name}
      </Text>
      <HStack modifiers={[font({ size: 13, weight: "medium" }), secondary, lineLimit(1)]}>
        {timeAndPlace}
      </HStack>
    </VStack>
  );

  const compactLeading = glyph(islandAccent, 15);
  // Upcoming: the accent countdown to the start; live: the plain one to the end.
  const compactTrailing = timer(15, live ? null : islandAccent, 64) ?? <Text> </Text>;

  // Minimal: the time left in its leading unit (`2h`, `45m`).
  const minimal = timer(11, islandAccent, 34, "semibold", 1) ?? glyph(islandAccent, 14);

  const expandedLeading = (
    <VStack modifiers={[padding({ leading: 8, top: 6 })]}>{glyph(islandAccent, 24)}</VStack>
  );
  // Inset from the island's rounded corners so labels never clip.
  const expandedTrailing = (
    <VStack alignment="trailing" modifiers={[padding({ trailing: 8, top: 4 })]}>
      {countdownStat(28, live ? null : islandAccent, 120) ?? <Text> </Text>}
    </VStack>
  );
  // Live: "Now" leads the name on one line, so the bar, the name and the
  // time · place fit the island's expanded height.
  const expandedBottom = (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[frame({ maxWidth: 10000, alignment: "leading" }), padding({ horizontal: 8 })]}
    >
      {bar(islandAccent)}
      {live ? (
        <VStack
          alignment="leading"
          spacing={1}
          modifiers={[frame({ maxWidth: 10000, alignment: "leading" })]}
        >
          <HStack spacing={6}>
            {labels.now ? (
              <Text
                modifiers={[
                  font({ size: 15, weight: "semibold" }),
                  lineLimit(1),
                  fixedSize({ horizontal: true }),
                  foregroundStyle(islandAccent),
                ]}
              >
                {labels.now}
              </Text>
            ) : null}
            <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>
              {props.name}
            </Text>
          </HStack>
          <HStack modifiers={[font({ size: 13, weight: "medium" }), secondary, lineLimit(1)]}>
            {timeAndPlace}
          </HStack>
        </VStack>
      ) : (
        nameBlock(15)
      )}
    </VStack>
  );

  // Lock Screen: one 14 pt margin on every edge, default background. The
  // symbol, name and time · place lead; the countdown is the hero on the
  // trailing side. Live adds the elapsed-time bar below.
  const banner = (
    <VStack
      alignment="leading"
      spacing={12}
      modifiers={[frame({ maxWidth: 10000, alignment: "leading" }), padding({ all: 14 })]}
    >
      <HStack alignment="center" spacing={10}>
        <HStack modifiers={[frame({ width: 26 })]}>{glyph(bannerAccent, 20)}</HStack>
        {nameBlock(17)}
        {countdownStat(28, live ? null : bannerAccent, 120)}
      </HStack>
      {bar(bannerAccent)}
    </VStack>
  );

  // watchOS Smart Stack and CarPlay: name plus the countdown (or "Now").
  const bannerSmall = (
    <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 8 })]}>
      <HStack spacing={4}>
        <Image systemName={symbol} color={bannerAccent ?? neutral} size={12} />
        <Text modifiers={[font({ size: 13, weight: "medium" }), lineLimit(1), secondary]}>
          {props.name}
        </Text>
      </HStack>
      {live ? (
        <HStack spacing={6} alignment="firstTextBaseline">
          {labels.now ? (
            <Text
              modifiers={[
                font({ size: 20, weight: "bold" }),
                lineLimit(1),
                fixedSize({ horizontal: true }),
                ...colorMods(bannerAccent),
              ]}
            >
              {labels.now}
            </Text>
          ) : null}
          <Spacer />
          {timer(15, null, 72)}
        </HStack>
      ) : (
        timer(20, bannerAccent, null)
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

export const AttendeeActivity = createLiveActivity<AttendeeActivityLiveProps>(
  LIVE_ACTIVITY_WIDGET_NAMES.attendee_activity,
  AttendeeActivityLayout,
);
