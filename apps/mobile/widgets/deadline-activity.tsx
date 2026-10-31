import { HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  fixedSize,
  font,
  frame,
  labelsHidden,
  layoutPriority,
  lineLimit,
  minimumScaleFactor,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { DeadlineLiveProps } from "@hackos/shared/live-activities";
import { LIVE_ACTIVITY_WIDGET_NAMES } from "@hackos/shared/live-activities";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";
import { type LiveActivityKit, withLiveActivityKit } from "./live-activity-kit";

/**
 * H19/H20 submission deadline Live Activity (#966). Open answers "how long
 * do we have?" (countdown hero, blue, with a bar of the hacking window and
 * the team's status when known); closing — the last minutes of a known
 * draft — marks only the symbol and "Not submitted" red (never the
 * countdown or bar); submitted is the
 * calm state: a green "Submitted" hero, the time left kept small. A `null`
 * submission is unknown (e.g. a project submission team not imported yet) and shows no
 * status at all, never "not submitted".
 *
 * See `queue-activity.tsx` for the `'widget'` runtime constraints: everything
 * the layout needs is declared inside the function or arrives in props.
 */
export const DeadlineActivityLayout = withLiveActivityKit(
  (props: DeadlineLiveProps, environment: LiveActivityEnvironment, kit: LiveActivityKit) => {
    "widget";

    const { colorMods, islandSide, secondary } = kit;
    const capped = kit.capped({
      compactLeading: { width: 56, alignment: "trailing" },
      compactTrailing: { width: 24, alignment: "center" },
    });
    // A newer, incompatible props shape degrades to the title.
    if (props.v !== 1 || !props.labels) {
      return capped(kit.fallback(props.projectName, "hourglass"));
    }
    const labels = props.labels;
    const closing = props.phase === "closing";
    const submitted = props.phase === "submitted";
    // Open = blue, closing = red (urgent), submitted = green (done); a draft
    // status while open is amber. Island colours are the dark variants; the
    // Lock Screen ones are dynamic (accessible light variants). Always-On
    // drops the accents and lets the system dim.
    const reduced = environment.isLuminanceReduced === true;
    const { neutral } = kit;
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
    // The countdown, bar and symbol share the phase colour in every state:
    // blue open, red closing, green submitted. Neutral grey on black was
    // unreadable once submitted, and a primary-colour countdown while closing
    // read as near-white next to the red symbol.
    const valueIsland = islandColor;
    const valueBanner = bannerColor;
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

    // #966: unit values carry no leading zero (`1h 5m`, `9m`, `9s`); the last five minutes use colon notation (`4:05`).
    // The native timer removes seconds and their spacing in Always-On.
    const countdown = (
      size: number,
      color: string | null,
      width: number | null,
      weight: "semibold" | "bold" = "bold",
      align: "leading" | "trailing" = "trailing",
      form: "full" | "short" | "long" = "full",
    ) =>
      validEnd ? (
        <Text
          timerInterval={{ lower, upper: endsAt }}
          countsDown
          compactCountdown={form}
          compactCountdownSize={size}
          compactCountdownWeight={weight}
          modifiers={[
            lineLimit(1),
            minimumScaleFactor(0.6),
            ...(width ? [frame({ maxWidth: width, alignment: align })] : []),
            ...colorMods(color),
          ]}
        />
      ) : null;

    // The hacking window's elapsed share (real time, not a fake fill).
    const bar = (color: string | null) =>
      startsAt && validEnd ? (
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
      kit.caption(text, align);

    const glyph = (color: string | null, size: number) => (
      <Image systemName={symbol} color={color ?? neutral} size={size} />
    );

    // Compact, like Luma's pre-event activity: the countdown leads, snug to the
    // camera: `2h 40m` from an hour, a number over `min` below it (reminders
    // never exceed an hour); the status symbol sits opposite.
    const compactLeading = countdown(12, valueIsland, 56, "semibold", "trailing", "short") ?? (
      <Text> </Text>
    );
    const compactTrailing = glyph(islandColor, 15);

    // #966: minimal identifies the phase without shrinking a multi-unit timer.
    const minimal = glyph(islandColor, 20);

    // Submitted keeps the time left, smaller.
    const expandedLeading = islandSide(
      <VStack alignment="leading" spacing={0}>
        {caption(labels.closesIn)}
        {submitted
          ? countdown(17, valueIsland, 140, "semibold", "leading", "long")
          : // Same hero scale as the other kinds; width fitting handles long hours.
            (countdown(28, valueIsland, 180, "bold", "leading", "long") ?? <Text> </Text>)}
      </VStack>,
      "leading",
    );
    const expandedTrailing = islandSide(glyph(islandColor, 24), "trailing", 6);
    const expandedBottom = (
      <VStack alignment="leading" spacing={8} modifiers={kit.bottomMods(8)}>
        <HStack spacing={8}>
          <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>
            {labels.title}
          </Text>
          <Spacer />
          {status(12, true)}
        </HStack>
        {bar(valueIsland)}
      </VStack>
    );

    // H19/H20 / #966: the primary value leads (as in Luma's pre-event activity),
    // the status and symbol close the row, then the title (never the project name). Submitted
    // moves the small time left into that row: as two rows of their own they
    // pushed the banner past the 160 pt Lock Screen height (#1171).
    const banner = (
      <VStack alignment="leading" spacing={8} modifiers={kit.bannerMods}>
        <HStack alignment="top" spacing={8}>
          <VStack alignment="leading" spacing={0} modifiers={[layoutPriority(1)]}>
            {submitted ? (
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
            ) : (
              <VStack alignment="leading" spacing={0}>
                {caption(labels.closesIn)}
                {countdown(28, valueBanner, 220, "bold", "leading", "long")}
              </VStack>
            )}
          </VStack>
          <Spacer />
          {submitted ? (
            <VStack alignment="trailing" spacing={0}>
              {caption(labels.closesIn, "trailing")}
              {countdown(17, null, 140, "semibold", "trailing", "full")}
            </VStack>
          ) : (
            status(12, false)
          )}
          {glyph(bannerColor, 17)}
        </HStack>
        <Text modifiers={[font({ size: 17, weight: "semibold" }), lineLimit(2)]}>
          {labels.title}
        </Text>
        {bar(valueBanner)}
      </VStack>
    );

    // watchOS Smart Stack and CarPlay (`.small` family, #966): glyph + title in
    // secondary, then one hero value (the countdown, or "Submitted"), then at
    // most one short status line. Colour is sparing: the glyph carries the
    // phase accent; red marks a single element, the "Not submitted" line, and
    // only in the last minutes. Always-On drops every accent.
    const watchRed = reduced ? null : "#FF6961";
    const watchGlyph = reduced || closing ? null : submitted ? island.green : island.blue;
    const watchTimer = (size: number, weight: "semibold" | "bold", muted = false) =>
      validEnd ? (
        <Text
          timerInterval={{ lower, upper: endsAt }}
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
    const watchStatus =
      statusText && !submitted ? (
        <HStack spacing={4} modifiers={[fixedSize({ horizontal: true })]}>
          {closing ? (
            <Image systemName="exclamationmark.circle.fill" color={watchRed ?? neutral} size={12} />
          ) : null}
          <Text
            modifiers={[
              font({ size: 13, weight: "semibold" }),
              lineLimit(1),
              ...(closing ? colorMods(watchRed) : [secondary]),
            ]}
          >
            {statusText}
          </Text>
        </HStack>
      ) : null;
    const bannerSmall = (
      <VStack alignment="leading" spacing={2} modifiers={kit.watchMods}>
        {kit.watchHeader(
          submitted ? "checkmark.circle.fill" : "hourglass",
          watchGlyph,
          labels.title,
        )}
        {submitted ? (
          <Text
            modifiers={[
              font({ size: 24, weight: "bold" }),
              lineLimit(1),
              minimumScaleFactor(0.6),
              ...colorMods(watchGlyph),
            ]}
          >
            {labels.submitted}
          </Text>
        ) : (
          watchTimer(26, "bold")
        )}
        {submitted ? watchTimer(13, "semibold", true) : watchStatus}
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

export const DeadlineActivity = createLiveActivity<DeadlineLiveProps>(
  LIVE_ACTIVITY_WIDGET_NAMES.deadline,
  DeadlineActivityLayout,
);
