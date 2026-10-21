import {
  Circle,
  Gauge,
  HStack,
  Image,
  ProgressView,
  Spacer,
  Text,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  allowsTightening,
  contentTransition,
  dynamicTypeSize,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  gaugeStyle,
  layoutPriority,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  opacity,
  padding,
  scaleEffect,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { QueueLiveProps } from "@hackos/shared/live-activities";
import { LIVE_ACTIVITY_WIDGET_NAMES } from "@hackos/shared/live-activities";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

/**
 * H38 queue Live Activity (#966): the participant's nearest judging queue.
 * Each phase answers one question — waiting: "when am I up?" (ETA hero,
 * position secondary); called: "where do I go, since when?" (room, green,
 * count-up since the call); in room: "where am I" (calm, neutral). A three
 * stage track (In line → Called → In room) shows progress, filling each
 * segment from the server's counts (`queueTotal`, `calledAhead`).
 *
 * `'widget'` functions are serialized into the widget extension's own JS
 * runtime: they may only use `@expo/ui/swift-ui` components/modifiers and
 * cannot read anything declared outside the function, so every helper and
 * colour lives inside it. Colours mirror `theme/colors.ts` (systemBlue /
 * systemGreen light/dark); the extension cannot import the app's tokens.
 * Fields and labels added after v1 are optional: an absent one hides its
 * element, never falls back to hardcoded copy.
 */
export const QueueActivityLayout = (
  props: QueueLiveProps,
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
  ) => (
    <HStack
      spacing={0}
      modifiers={[
        frame({ maxWidth: width, alignment }),
        fixedSize({ horizontal: true }),
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
    // Wider than the other kinds' 24 pt: the position reaches three digits
    // (`#128` was truncated to `#1…`); four still scale down within it.
    compactLeading: islandSlot(layout.compactLeading as never, 40, "trailing"),
    compactTrailing: islandSlot(layout.compactTrailing as never, 56, "leading"),
    minimal: islandSlot(layout.minimal as never, 36, "center"),
  });
  // APNs delivers props straight to this layout, so a newer, incompatible
  // shape (`v` bumped, see LIVE_ACTIVITY_PROPS_VERSION) degrades to the title
  // instead of rendering half-understood fields.
  if (props.v !== 1 || !props.labels) {
    const title = (
      <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>
        {typeof props.challengeTitle === "string" ? props.challengeTitle : ""}
      </Text>
    );
    const symbol = <Image systemName="person.3.sequence.fill" color="#0A84FF" size={15} />;
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
  const called = props.phase === "called";
  const inRoom = props.phase === "in_room";
  // Track stage: 0 in line, 1 called, 2 in room.
  const stage = inRoom ? 2 : called ? 1 : 0;

  // Dynamic Island is always dark; the Lock Screen follows the system scheme,
  // which the layout's `environment.colorScheme` does not reliably report, so
  // Lock Screen colours are dynamic (resolved by the view's own appearance;
  // the light green is the accessible `#248A3D`). Always-On (reduced
  // luminance) drops accent fills and lets the system dim.
  // Waiting = blue, called = green (go), in room = neutral.
  const reduced = environment.isLuminanceReduced === true;
  const neutral = "#8E8E93";
  const islandColor = inRoom ? null : called ? "#30D158" : "#0A84FF";
  const adaptive = (light: string, dark: string) =>
    ({ dynamic: { light, dark } }) as unknown as string;
  const bannerColor =
    reduced || inRoom
      ? null
      : called
        ? adaptive("#248A3D", "#30D158")
        : adaptive("#007AFF", "#0A84FF");
  const colorMods = (color: string | null) => (color ? [foregroundStyle(color)] : []);
  const secondary = foregroundStyle({
    type: "hierarchical",
    style: "secondary",
  });

  const room = props.roomName ?? "";
  // Compact island: the part that identifies the room ("Room B" -> "B", a long
  // name -> its first three characters), so it fits the vertical island.
  const roomWords = room.trim().split(/\s+/);
  const roomCompact =
    roomWords.length > 1
      ? (roomWords[roomWords.length - 1] ?? "").slice(0, 3)
      : room.trim().slice(0, 3);
  const position =
    typeof props.position === "number" && Number.isFinite(props.position)
      ? `#${props.position}`
      : null;
  const eta =
    typeof props.etaMinutes === "number" && Number.isFinite(props.etaMinutes)
      ? Math.max(1, Math.round(props.etaMinutes))
      : null;
  // Compact island: no tilde, so it fits the vertical island of a foldable.
  const etaCompact = eta === null ? null : `${eta}m`;
  const etaLong = eta === null ? null : `~${eta} ${labels.minutes}`;
  // Unknown ETA shows the server's active placeholder, never a dash; a
  // payload without it (older server) simply omits the ETA.
  const etaOrEstimating = etaLong ?? labels.estimating ?? null;

  // Current stage fill, the same formulas as Android's `queueStageFill`.
  // Waiting: `(total - position + 1) / (total + 1)` (#1 of 10 → 10/11,
  // #10 of 10 → 1/11). Called: `2 / (calledAhead + 3)`. Never 0 or full
  // inside a stage; 0 when an older server sends no counts.
  const whole = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const total = whole(props.queueTotal);
  const place = whole(props.position);
  const ahead = whole(props.calledAhead);
  const climb =
    stage === 0 && total !== null && place !== null && place >= 1 && place <= total
      ? (total - place + 1) / (total + 1)
      : 0;
  const callFill = stage === 1 && ahead !== null ? 2 / (ahead + 3) : 0;

  // Count-up since the call (H34 shows operators the same elapsed time).
  const calledMs = typeof props.calledAt === "string" ? Date.parse(props.calledAt) : Number.NaN;
  const calledTimer = (size: number, weight: "semibold" | "medium", width: number) =>
    Number.isFinite(calledMs) ? (
      <Text
        timerInterval={{
          lower: new Date(calledMs),
          upper: new Date(calledMs + 86_400_000),
        }}
        countsDown={false}
        modifiers={[
          font({ size, weight }),
          monospacedDigit(),
          lineLimit(1),
          minimumScaleFactor(0.6),
          layoutPriority(1),
          multilineTextAlignment("trailing"),
          frame({ maxWidth: width, alignment: "trailing" }),
        ]}
      />
    ) : null;

  // Progress track: three nodes, two segments. Waiting is the long part of
  // the journey, so "In line → Called" takes two thirds of the width. With no
  // GeometryReader (and `containerRelativeFrame` needing iOS 17), the width
  // comes from three equally flexible units: the first segment is two
  // ProgressViews overlapped by 4 pt (one continuous bar, filled half by
  // half), the second one. The label row repeats the same units, so each
  // label stays under its node. Completed nodes/segments take the phase
  // colour; the current node is larger with a halo.
  const track = (color: string | null, withLabels: boolean) => {
    const fill = color ?? neutral;
    const gap = (side: "leading" | "trailing" | "both") =>
      side === "both" ? padding({ horizontal: 3 }) : padding({ [side]: 3 });
    const node = (index: number) => (
      <ZStack
        modifiers={[
          frame({ width: 16, height: 16 }),
          gap(index === 0 ? "trailing" : index === 2 ? "leading" : "both"),
        ]}
      >
        {index === stage ? (
          <Circle
            modifiers={[frame({ width: 16, height: 16 }), foregroundStyle(fill), opacity(0.3)]}
          />
        ) : null}
        <Circle
          modifiers={[
            frame(index === stage ? { width: 10, height: 10 } : { width: 8, height: 8 }),
            foregroundStyle(index <= stage ? fill : { type: "hierarchical", style: "tertiary" }),
          ]}
        />
      </ZStack>
    );
    const overlap = padding({ leading: -4 });
    const unit = (value: number, joined = false) => (
      <ProgressView
        value={value}
        modifiers={[tint(fill), frame({ maxWidth: 10000 }), ...(joined ? [overlap] : [])]}
      />
    );
    const spacer = (joined = false) => (
      <Text
        modifiers={[font({ size: 11 }), frame({ maxWidth: 10000 }), ...(joined ? [overlap] : [])]}
      >
        {" "}
      </Text>
    );
    const first = stage > 0 ? 1 : climb;
    const stageLabel = (text: string, index: number, align: "leading" | "center" | "trailing") => (
      <Text
        modifiers={[
          font({ size: 11, weight: index === stage ? "semibold" : "medium" }),
          lineLimit(1),
          fixedSize({ horizontal: true }),
          ...(index === stage ? [] : [secondary]),
          frame({ width: 16, alignment: align }),
          gap(index === 0 ? "trailing" : index === 2 ? "leading" : "both"),
        ]}
      >
        {text}
      </Text>
    );
    const names =
      withLabels && labels.stageInLine && labels.stageCalled && labels.stageInRoom
        ? [labels.stageInLine, labels.stageCalled, labels.stageInRoom]
        : null;
    return (
      <VStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: 10000 })]}>
        <HStack spacing={0}>
          {node(0)}
          {unit(Math.min(1, first * 2))}
          {unit(Math.max(0, first * 2 - 1), true)}
          {node(1)}
          {unit(stage > 1 ? 1 : callFill)}
          {node(2)}
        </HStack>
        {names ? (
          <HStack spacing={0}>
            {stageLabel(names[0]!, 0, "leading")}
            {spacer()}
            {spacer(true)}
            {stageLabel(names[1]!, 1, "center")}
            {spacer()}
            {stageLabel(names[2]!, 2, "trailing")}
          </HStack>
        ) : null}
      </VStack>
    );
  };

  // Caption above a large value. Numbers keep their full width (`fixedSize`);
  // a room name can be long, so it shrinks and then truncates.
  const metric = (
    label: string | null,
    value: string,
    align: "leading" | "trailing",
    color: string | null,
    size: number,
    numeric = true,
  ) => (
    <VStack alignment={align} spacing={0}>
      {label ? (
        <Text modifiers={[font({ size: 12, weight: "medium" }), secondary, lineLimit(1)]}>
          {label}
        </Text>
      ) : null}
      <Text
        modifiers={[
          font({ size, weight: "bold" }),
          monospacedDigit(),
          contentTransition("numericText", { countsDown: true }),
          lineLimit(1),
          allowsTightening(true),
          ...(numeric ? [fixedSize({ horizontal: true })] : [minimumScaleFactor(0.6)]),
          ...colorMods(color),
        ]}
      >
        {value}
      </Text>
    </VStack>
  );
  // The ETA metric: an estimate (`~12 min`, never a ticking timer), or the
  // smaller "Estimating…" placeholder.
  const etaMetric = (align: "leading" | "trailing", color: string | null, size: number) =>
    etaOrEstimating === null
      ? null
      : etaLong
        ? metric(labels.wait, etaLong, align, color, size)
        : metric(labels.wait, etaOrEstimating, align, color, Math.round(size * 0.62), false);

  const symbol = inRoom
    ? "person.2.fill"
    : called
      ? "door.left.hand.open"
      : "person.3.sequence.fill";
  const symbolColor = islandColor ?? neutral;

  const compactLeading =
    called || inRoom || position === null ? (
      <Image
        systemName={called || inRoom ? symbol : "person.3.sequence.fill"}
        color={symbolColor}
        size={15}
      />
    ) : (
      <Text
        modifiers={[
          font({ size: 13, weight: "semibold" }),
          monospacedDigit(),
          contentTransition("numericText", { countsDown: true }),
          lineLimit(1),
          foregroundStyle(symbolColor),
        ]}
      >
        {position}
      </Text>
    );

  const compactTrailing =
    called || inRoom ? (
      roomCompact ? (
        <Text
          modifiers={[
            font({ size: 12, weight: "semibold" }),
            lineLimit(1),
            frame({ maxWidth: 64 }),
            ...colorMods(islandColor),
          ]}
        >
          {roomCompact}
        </Text>
      ) : (
        (calledTimer(12, "semibold", 48) ?? <Text> </Text>)
      )
    ) : etaCompact ? (
      <Text
        modifiers={[
          font({ size: 12, weight: "semibold" }),
          monospacedDigit(),
          contentTransition("numericText", { countsDown: true }),
          ...colorMods(islandColor),
        ]}
      >
        {etaCompact}
      </Text>
    ) : (
      <Image systemName="hourglass" color={symbolColor} size={14} />
    );

  // Minimal: the climb to the front as a ring around the position, or the
  // phase symbol once called.
  const minimal =
    called || inRoom ? (
      <Image systemName={symbol} color={symbolColor} size={14} />
    ) : (
      <ZStack>
        <Gauge
          value={climb}
          modifiers={[
            gaugeStyle("circularCapacity"),
            tint(symbolColor),
            scaleEffect(0.46),
            frame({ width: 28, height: 28 }),
          ]}
        />
        {position && position.length <= 3 ? (
          <Text
            modifiers={[
              font({ size: 11, weight: "bold" }),
              monospacedDigit(),
              lineLimit(1),
              minimumScaleFactor(0.6),
            ]}
          >
            {position}
          </Text>
        ) : null}
      </ZStack>
    );

  const expandedLeading = called ? (
    <Image
      systemName={symbol}
      color={symbolColor}
      size={24}
      modifiers={[padding({ leading: 8, top: 6 })]}
    />
  ) : inRoom ? (
    <Image
      systemName={symbol}
      color={neutral}
      size={24}
      modifiers={[padding({ leading: 8, top: 6 })]}
    />
  ) : (
    <VStack modifiers={[padding({ leading: 8, top: 4 })]}>
      {metric(labels.position, position ?? "–", "leading", null, 17)}
    </VStack>
  );

  // Inset from the island's rounded corners so labels never clip.
  const expandedTrailing = (
    <VStack alignment="trailing" modifiers={[padding({ trailing: 8, top: 4 })]}>
      {called || inRoom
        ? metric(
            called ? labels.goTo : labels.inRoom,
            room || "–",
            "trailing",
            islandColor,
            28,
            false,
          )
        : etaMetric("trailing", islandColor, 28)}
    </VStack>
  );

  const calledSince = calledTimer(17, "medium", 72);
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
        <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>
          {props.challengeTitle}
        </Text>
        <Spacer />
        {labels.moreQueues ? (
          <Text
            modifiers={[
              font({ size: 13, weight: "medium" }),
              secondary,
              lineLimit(1),
              layoutPriority(1),
            ]}
          >
            {labels.moreQueues}
          </Text>
        ) : null}
      </HStack>
      {called || inRoom ? (
        <HStack spacing={8}>
          {props.roomLocation ? (
            <Text modifiers={[font({ size: 13, weight: "medium" }), secondary, lineLimit(1)]}>
              {props.roomLocation}
            </Text>
          ) : null}
          <Spacer />
          {called && calledSince ? (
            <HStack spacing={4} modifiers={[secondary]}>
              {labels.called ? (
                <Text modifiers={[font({ size: 12, weight: "medium" }), lineLimit(1)]}>
                  {labels.called}
                </Text>
              ) : null}
              {calledSince}
            </HStack>
          ) : null}
        </HStack>
      ) : null}
      {track(islandColor, false)}
    </VStack>
  );

  // Lock Screen: its own layout (not a notification clone), 14 pt margins,
  // default background. Header, hero row, then the stage track.
  const header = (
    <HStack spacing={8}>
      <Image systemName={symbol} color={bannerColor ?? neutral} size={17} />
      <Text modifiers={[font({ size: 17, weight: "semibold" }), lineLimit(1)]}>
        {props.challengeTitle}
      </Text>
      <Spacer />
      {labels.moreQueues ? (
        <Text
          modifiers={[
            font({ size: 13, weight: "medium" }),
            secondary,
            lineLimit(1),
            layoutPriority(1),
          ]}
        >
          {labels.moreQueues}
        </Text>
      ) : null}
    </HStack>
  );

  const calledFor = calledTimer(17, "semibold", 72);
  const hero =
    called || inRoom ? (
      <HStack alignment="bottom" spacing={12}>
        {called && calledFor ? (
          <VStack alignment="leading" spacing={0}>
            {labels.called ? (
              <Text modifiers={[font({ size: 12, weight: "medium" }), secondary, lineLimit(1)]}>
                {labels.called}
              </Text>
            ) : null}
            {calledFor}
          </VStack>
        ) : null}
        <Spacer />
        <VStack alignment="trailing" spacing={0}>
          {metric(
            called ? labels.goTo : labels.inRoom,
            room || "–",
            "trailing",
            bannerColor,
            28,
            false,
          )}
          {props.roomLocation ? (
            <Text modifiers={[font({ size: 13, weight: "medium" }), secondary, lineLimit(1)]}>
              {props.roomLocation}
            </Text>
          ) : null}
        </VStack>
      </HStack>
    ) : (
      <HStack alignment="bottom" spacing={12}>
        {position ? metric(labels.position, position, "leading", null, 17) : null}
        <Spacer />
        {etaMetric("trailing", bannerColor, 28)}
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
      {track(bannerColor, true)}
    </VStack>
  );

  // watchOS Smart Stack and CarPlay (`.small` family, #966, H29, H38): glyph and
  // title in secondary, one hero value, at most one status line. The accent
  // tints the glyph only; Always-On drops it.
  const watchGlyph = reduced ? null : islandColor;
  const watchHero = (text: string) => (
    <Text
      modifiers={[
        font({ size: 26, weight: "bold" }),
        monospacedDigit(),
        lineLimit(1),
        minimumScaleFactor(0.6),
      ]}
    >
      {text}
    </Text>
  );
  const watchLine = (text: string | null | undefined) =>
    text ? (
      <Text modifiers={[font({ size: 13, weight: "medium" }), secondary, lineLimit(1)]}>
        {text}
      </Text>
    ) : null;
  // Waiting: position, then the estimate. Called: where to go. In room: the room.
  const watchHeroText = called
    ? `${labels.goTo} ${room}`.trim()
    : inRoom
      ? room || labels.inRoom
      : (position ?? etaOrEstimating ?? "");
  const watchLineText = called
    ? props.roomLocation
    : inRoom
      ? room
        ? labels.inRoom
        : null
      : position
        ? etaOrEstimating
        : null;
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
          {props.challengeTitle}
        </Text>
      </HStack>
      {watchHero(watchHeroText)}
      {watchLine(watchLineText)}
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

export const QueueActivity = createLiveActivity<QueueLiveProps>(
  LIVE_ACTIVITY_WIDGET_NAMES.queue,
  QueueActivityLayout,
);
