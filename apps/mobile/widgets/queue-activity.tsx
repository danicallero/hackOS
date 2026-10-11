import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import {
  allowsTightening,
  contentTransition,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
} from "@expo/ui/swift-ui/modifiers";
import type { QueueLiveProps } from "@hackos/shared/live-activities";
import { LIVE_ACTIVITY_WIDGET_NAMES } from "@hackos/shared/live-activities";
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

/**
 * H38 queue Live Activity (#966): the participant's nearest judging queue —
 * position and an ETA estimate while waiting, the room once called (H29).
 *
 * `'widget'` functions are serialized into the widget extension's own JS
 * runtime: they may only use `@expo/ui/swift-ui` components/modifiers and
 * cannot read anything declared outside the function, so every helper and
 * colour lives inside it. Colours mirror `theme/colors.ts` `accent`
 * (systemBlue light/dark); the extension cannot import the app's tokens.
 */
const QueueActivityLayout = (props: QueueLiveProps, environment: LiveActivityEnvironment) => {
  "widget";
  // Dynamic Island is always dark; the Lock Screen follows the system scheme.
  // Always-On (reduced luminance) drops the accent and lets the system dim.
  const islandAccent = "#0A84FF";
  const bannerAccent = environment.isLuminanceReduced
    ? null
    : environment.colorScheme === "light"
      ? "#007AFF"
      : "#0A84FF";
  const called = props.phase === "called";
  const inRoom = props.phase === "in_room";
  const room = props.roomName ?? "";
  const eta =
    props.etaMinutes === null || props.etaMinutes === undefined
      ? null
      : Math.max(1, Math.round(props.etaMinutes));
  const position = props.position === null ? null : `#${props.position}`;
  const etaShort = eta === null ? "–" : `~${eta}m`;
  const etaLong = eta === null ? "–" : `~${eta} ${props.labels.minutes}`;
  const roomLine = called ? `${props.labels.goTo} ${room}` : room;
  const accentMods = (color: string | null) => (color ? [foregroundStyle(color)] : []);
  const doorSymbol = inRoom ? "person.2.fill" : "door.left.hand.open";

  const compactLeading =
    called || inRoom ? (
      <Image systemName={doorSymbol} color={islandAccent} size={15} />
    ) : (
      <Text
        modifiers={[
          font({ size: 15, weight: "semibold" }),
          monospacedDigit(),
          contentTransition("numericText", { countsDown: true }),
          foregroundStyle(islandAccent),
        ]}
      >
        {position ?? "–"}
      </Text>
    );

  const compactTrailing =
    called || inRoom ? (
      <Text
        modifiers={[
          font({ size: 15, weight: "semibold" }),
          lineLimit(1),
          frame({ maxWidth: 64 }),
          foregroundStyle(islandAccent),
        ]}
      >
        {room}
      </Text>
    ) : (
      <Text
        modifiers={[
          font({ size: 15, weight: "semibold" }),
          monospacedDigit(),
          contentTransition("numericText", { countsDown: true }),
          foregroundStyle(islandAccent),
        ]}
      >
        {etaShort}
      </Text>
    );

  // Minimal shows live data, never a logo: the ETA, or the room's initial.
  const minimal = (
    <Text
      modifiers={[
        font({ size: 13, weight: "semibold" }),
        monospacedDigit(),
        lineLimit(1),
        foregroundStyle(islandAccent),
      ]}
    >
      {called || inRoom
        ? room.slice(0, 1).toUpperCase()
        : eta === null
          ? (position ?? "–")
          : `${eta}m`}
    </Text>
  );

  const metric = (
    label: string,
    value: string,
    align: "leading" | "trailing",
    color: string | null,
  ) => (
    <VStack alignment={align} spacing={0}>
      <Text
        modifiers={[
          font({ size: 12, weight: "medium" }),
          foregroundStyle({ type: "hierarchical", style: "secondary" }),
        ]}
      >
        {label}
      </Text>
      <Text
        modifiers={[
          font({ size: 28, weight: "bold" }),
          monospacedDigit(),
          contentTransition("numericText", { countsDown: true }),
          lineLimit(1),
          allowsTightening(true),
          fixedSize({ horizontal: true }),
          ...accentMods(color),
        ]}
      >
        {value}
      </Text>
    </VStack>
  );

  const expandedLeading =
    called || inRoom ? (
      <Image
        systemName={doorSymbol}
        color={islandAccent}
        size={28}
        modifiers={[padding({ leading: 8, top: 4 })]}
      />
    ) : (
      <VStack modifiers={[padding({ leading: 8, top: 4 })]}>
        {metric(props.labels.position, position ?? "–", "leading", islandAccent)}
      </VStack>
    );

  // Inset from the island's rounded corners so labels never clip.
  const expandedTrailing = (
    <VStack modifiers={[padding({ trailing: 8, top: 4 })]}>
      {called || inRoom
        ? metric(called ? props.labels.goTo : props.labels.inRoom, room, "trailing", islandAccent)
        : metric(props.labels.wait, etaLong, "trailing", islandAccent)}
    </VStack>
  );

  const expandedBottom = (
    <VStack
      alignment="leading"
      spacing={2}
      modifiers={[frame({ maxWidth: 10000, alignment: "leading" }), padding({ horizontal: 8 })]}
    >
      {(called || inRoom) && props.roomLocation ? (
        <Text modifiers={[font({ size: 15, weight: "semibold" }), lineLimit(1)]}>
          {props.roomLocation}
        </Text>
      ) : null}
      <Text
        modifiers={[
          font({ size: 13, weight: "medium" }),
          lineLimit(1),
          foregroundStyle({ type: "hierarchical", style: "secondary" }),
        ]}
      >
        {props.challengeTitle}
      </Text>
    </VStack>
  );

  // Lock Screen: its own layout (not a notification clone), 14 pt margins,
  // default background, the key number large and in the accent colour.
  const banner = (
    <VStack
      alignment="leading"
      spacing={6}
      modifiers={[frame({ maxWidth: 10000, alignment: "leading" }), padding({ all: 14 })]}
    >
      <Text
        modifiers={[
          font({ size: 15, weight: "semibold" }),
          lineLimit(1),
          foregroundStyle({ type: "hierarchical", style: "secondary" }),
        ]}
      >
        {props.challengeTitle}
      </Text>
      {called || inRoom ? (
        <VStack alignment="leading" spacing={0}>
          <Text
            modifiers={[
              font({ size: 28, weight: "bold" }),
              lineLimit(1),
              ...accentMods(bannerAccent),
            ]}
          >
            {inRoom ? `${props.labels.inRoom} · ${room}` : roomLine}
          </Text>
          {props.roomLocation ? (
            <Text modifiers={[font({ size: 15, weight: "medium" }), lineLimit(1)]}>
              {props.roomLocation}
            </Text>
          ) : null}
        </VStack>
      ) : (
        <HStack alignment="lastTextBaseline" spacing={24}>
          {metric(props.labels.position, position ?? "–", "leading", bannerAccent)}
          {metric(props.labels.wait, etaLong, "leading", bannerAccent)}
          <Spacer />
        </HStack>
      )}
      {props.labels.moreQueues ? (
        <Text
          modifiers={[
            font({ size: 13, weight: "medium" }),
            foregroundStyle({ type: "hierarchical", style: "secondary" }),
          ]}
        >
          {props.labels.moreQueues}
        </Text>
      ) : null}
    </VStack>
  );

  // watchOS Smart Stack and CarPlay: compact, glanceable, no buttons.
  const bannerSmall = (
    <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 8 })]}>
      <Text
        modifiers={[
          font({ size: 13, weight: "medium" }),
          lineLimit(1),
          foregroundStyle({ type: "hierarchical", style: "secondary" }),
        ]}
      >
        {props.challengeTitle}
      </Text>
      <Text
        modifiers={[
          font({ size: 17, weight: "bold" }),
          monospacedDigit(),
          lineLimit(1),
          ...accentMods(bannerAccent),
        ]}
      >
        {called || inRoom ? roomLine : `${position ?? "–"} · ${etaLong}`}
      </Text>
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

export const QueueActivity = createLiveActivity<QueueLiveProps>(
  LIVE_ACTIVITY_WIDGET_NAMES.queue,
  QueueActivityLayout,
);
