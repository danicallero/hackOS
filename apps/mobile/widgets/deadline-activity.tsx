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
import type { DeadlineLiveProps } from "@hackos/shared/live-activities";
import { LIVE_ACTIVITY_WIDGET_NAMES } from "@hackos/shared/live-activities";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

/**
 * H19/H20 submission deadline Live Activity (#966). Open answers "how long
 * do we have?" (countdown hero, blue, with a bar of the hacking window and
 * the team's status when known); closing — the last minutes of a known
 * draft — turns the same layout red with "Not submitted"; submitted is the
 * calm state: a green "Submitted" hero, the time left kept small. A `null`
 * submission is unknown (e.g. a Devpost team not imported yet) and shows no
 * status at all, never "not submitted".
 *
 * See `queue-activity.tsx` for the `'widget'` runtime constraints: everything
 * the layout needs is declared inside the function or arrives in props.
 */
export const DeadlineActivityLayout = (
  props: DeadlineLiveProps,
  environment: LiveActivityEnvironment,
) => {
  "widget";
  // A newer, incompatible props shape degrades to the title.
  if (props.v !== 1 || !props.labels) {
    const title = (
      <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>
        {typeof props.projectName === "string" ? props.projectName : ""}
      </Text>
    );
    const symbol = <Image systemName="hourglass" color="#0A84FF" size={15} />;
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
  const closing = props.phase === "closing";
  const submitted = props.phase === "submitted";
  // Open = blue, closing = red (urgent), submitted = green (done); a draft
  // status while open is amber. Island colours are the dark variants; the
  // Lock Screen ones are dynamic (accessible light variants). Always-On
  // drops the accents and lets the system dim.
  const reduced = environment.isLuminanceReduced === true;
  const neutral = "#8E8E93";
  const adaptive = (light: string, dark: string) =>
    ({ dynamic: { light, dark } }) as unknown as string;
  const island = { blue: "#0A84FF", red: "#FF453A", green: "#30D158", amber: "#FF9F0A" };
  const lock = {
    blue: adaptive("#007AFF", "#0A84FF"),
    red: adaptive("#D70015", "#FF453A"),
    green: adaptive("#248A3D", "#30D158"),
    amber: adaptive("#C93400", "#FF9F0A"),
  };
  const tone = submitted ? "green" : closing ? "red" : "blue";
  const islandColor = island[tone];
  const bannerColor = reduced ? null : lock[tone];
  const colorMods = (color: string | null) => (color ? [foregroundStyle(color)] : []);
  const secondary = foregroundStyle({ type: "hierarchical", style: "secondary" });
  const symbol = submitted
    ? "checkmark.circle.fill"
    : closing
      ? "exclamationmark.circle.fill"
      : "hourglass";

  const endsAt = new Date(props.endsAt);
  const validEnd = Number.isFinite(endsAt.getTime());
  const startMs = typeof props.startsAt === "string" ? Date.parse(props.startsAt) : Number.NaN;
  const startsAt =
    Number.isFinite(startMs) && startMs < endsAt.getTime() ? new Date(startMs) : null;
  // Lower bound of the countdown: any earlier instant renders the same time
  // left, and a ClosedRange needs lower <= upper.
  const updatedAt = Date.parse(props.updatedAt);
  const lower = new Date(
    Math.min(
      Number.isFinite(updatedAt) ? updatedAt : endsAt.getTime() - 86_400_000,
      endsAt.getTime(),
      startsAt ? startsAt.getTime() : Number.POSITIVE_INFINITY,
    ),
  );

  // `1h 20m`, `10m`, `59s` (`labels.units`; an older server's props keep the
  // greedy H:MM:SS timer, which `width` caps), on one line that scales down
  // rather than truncating.
  const countdown = (
    size: number,
    color: string | null,
    width: number | null,
    weight = "bold",
    align: "leading" | "trailing" = "trailing",
    maxUnits = 2,
  ) =>
    validEnd ? (
      <Text
        timerInterval={{ lower, upper: endsAt }}
        countsDown
        countdownUnits={labels.units}
        countdownMaxUnits={maxUnits}
        modifiers={[
          font({ size, weight: weight as "bold" | "semibold" }),
          monospacedDigit(),
          lineLimit(1),
          minimumScaleFactor(0.6),
          multilineTextAlignment(align),
          ...(width ? [frame({ maxWidth: width, alignment: align })] : []),
          ...colorMods(color),
        ]}
      />
    ) : null;

  // The hacking window's elapsed share (real time, not a fake fill).
  const bar = (color: string | null) =>
    startsAt && validEnd && !submitted ? (
      <ProgressView
        timerInterval={{ lower: startsAt, upper: endsAt }}
        countsDown={false}
        modifiers={[tint(color ?? neutral), labelsHidden()]}
      />
    ) : null;

  // The team's status. Submitted: green check; draft: amber (red while
  // closing) "Not submitted"; unknown: nothing.
  const statusText =
    props.submission === "submitted"
      ? labels.submitted
      : props.submission === "draft"
        ? labels.notSubmitted
        : null;
  const statusColor = (onIsland: boolean) =>
    props.submission === "submitted"
      ? onIsland
        ? island.green
        : reduced
          ? null
          : lock.green
      : closing
        ? onIsland
          ? island.red
          : reduced
            ? null
            : lock.red
        : onIsland
          ? island.amber
          : reduced
            ? null
            : lock.amber;
  const status = (size: number, onIsland: boolean) =>
    statusText ? (
      <HStack spacing={4} modifiers={[fixedSize({ horizontal: true })]}>
        <Image
          systemName={
            props.submission === "submitted"
              ? "checkmark.circle.fill"
              : "exclamationmark.circle.fill"
          }
          color={statusColor(onIsland) ?? neutral}
          size={size - 2}
        />
        <Text
          modifiers={[
            font({ size, weight: "semibold" }),
            lineLimit(1),
            ...colorMods(statusColor(onIsland)),
          ]}
        >
          {statusText}
        </Text>
      </HStack>
    ) : null;

  const caption = (text: string | null | undefined, align: "leading" | "trailing" = "leading") =>
    text ? (
      <Text
        modifiers={[
          font({ size: 12, weight: "medium" }),
          secondary,
          lineLimit(1),
          multilineTextAlignment(align),
        ]}
      >
        {text}
      </Text>
    ) : null;

  const glyph = (color: string | null, size: number) => (
    <Image systemName={symbol} color={color ?? neutral} size={size} />
  );

  const compactLeading = glyph(islandColor, 15);
  const compactTrailing = countdown(15, submitted ? neutral : islandColor, 64, "semibold") ?? (
    <Text> </Text>
  );

  // Minimal: the time left in its leading unit (`2h`, `45m`); done: the
  // check alone.
  const minimal = submitted
    ? glyph(islandColor, 14)
    : (countdown(11, islandColor, 34, "semibold", "trailing", 1) ?? glyph(islandColor, 14));

  const expandedLeading = (
    <VStack modifiers={[padding({ leading: 8, top: 6 })]}>{glyph(islandColor, 24)}</VStack>
  );
  // Inset from the island's rounded corners so labels never clip. Submitted
  // keeps the time left, smaller and neutral.
  const expandedTrailing = (
    <VStack alignment="trailing" spacing={0} modifiers={[padding({ trailing: 8, top: 4 })]}>
      {caption(labels.closesIn, "trailing")}
      {submitted
        ? countdown(17, neutral, 120, "semibold")
        : // Hours long: a little smaller than the other kinds' 28 pt.
          (countdown(24, islandColor, 120) ?? <Text> </Text>)}
    </VStack>
  );
  const expandedBottom = (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[frame({ maxWidth: 10000, alignment: "leading" }), padding({ horizontal: 8 })]}
    >
      {bar(islandColor)}
      <HStack spacing={8}>
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>
            {labels.title}
          </Text>
          {props.projectName ? (
            <Text modifiers={[font({ size: 13, weight: "medium" }), secondary, lineLimit(1)]}>
              {props.projectName}
            </Text>
          ) : null}
        </VStack>
        <Spacer />
        {status(15, true)}
      </HStack>
    </VStack>
  );

  // Lock Screen: one 14 pt margin on every edge. Header: symbol and title.
  // Hero row: the countdown (or "Submitted") with the project and its status
  // opposite; then the window bar.
  const header = (
    <HStack alignment="center" spacing={8}>
      {glyph(bannerColor, 17)}
      <Text modifiers={[font({ size: 17, weight: "semibold" }), lineLimit(1)]}>{labels.title}</Text>
      <Spacer />
    </HStack>
  );
  const hero = submitted ? (
    <HStack alignment="bottom" spacing={12}>
      <VStack alignment="leading" spacing={0}>
        {caption(props.projectName)}
        <Text
          modifiers={[
            font({ size: 28, weight: "bold" }),
            lineLimit(1),
            minimumScaleFactor(0.6),
            ...colorMods(bannerColor),
          ]}
        >
          {labels.submitted}
        </Text>
      </VStack>
      <Spacer />
      <VStack alignment="trailing" spacing={0}>
        {caption(labels.closesIn, "trailing")}
        {countdown(17, null, 120, "semibold")}
      </VStack>
    </HStack>
  ) : (
    <HStack alignment="bottom" spacing={12}>
      <VStack alignment="leading" spacing={0}>
        {caption(labels.closesIn)}
        {countdown(34, bannerColor, 180, "bold", "leading")}
      </VStack>
      <Spacer />
      {statusText ? (
        <VStack alignment="trailing" spacing={2} modifiers={[padding({ bottom: 4 })]}>
          {caption(props.projectName, "trailing")}
          {status(15, false)}
        </VStack>
      ) : props.projectName ? (
        <VStack alignment="trailing" modifiers={[padding({ bottom: 4 })]}>
          {caption(props.projectName, "trailing")}
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
      {hero}
      {bar(bannerColor)}
    </VStack>
  );

  // watchOS Smart Stack and CarPlay: the title, then the countdown (with
  // "Not submitted" while closing) or "Submitted".
  const bannerSmall = (
    <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 8 })]}>
      <HStack spacing={4}>
        <Image systemName={symbol} color={bannerColor ?? neutral} size={12} />
        <Text modifiers={[font({ size: 13, weight: "medium" }), lineLimit(1), secondary]}>
          {labels.title}
        </Text>
      </HStack>
      {submitted ? (
        <Text
          modifiers={[font({ size: 20, weight: "bold" }), lineLimit(1), ...colorMods(bannerColor)]}
        >
          {labels.submitted}
        </Text>
      ) : (
        <HStack spacing={6} alignment="firstTextBaseline">
          {countdown(20, bannerColor, null)}
          {closing && props.submission === "draft" ? (
            <Text
              modifiers={[
                font({ size: 13, weight: "semibold" }),
                lineLimit(1),
                ...colorMods(bannerColor),
              ]}
            >
              {labels.notSubmitted}
            </Text>
          ) : null}
        </HStack>
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

export const DeadlineActivity = createLiveActivity<DeadlineLiveProps>(
  LIVE_ACTIVITY_WIDGET_NAMES.deadline,
  DeadlineActivityLayout,
);
