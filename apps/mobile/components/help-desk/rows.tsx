import { Text, View } from "react-native";
import { StatusPill } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { PressableFeedback } from "@/components/pressable-feedback";
import { SymbolView } from "@/components/symbol";
import type { HelperCard, HelpRequest } from "@/lib/help-desk";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { colors, radius, space, type } from "@/theme";

export const HELP_STATUS_KEYS: Record<HelpRequest["status"], MessageKey> = {
  open: "helpOpen",
  claimed: "helpClaimed",
  resolved: "helpResolved",
  cancelled: "helpCancelled",
};
export const HELP_STATUS_TONE = {
  open: "accent",
  claimed: "success",
  resolved: "neutral",
  cancelled: "warning",
} as const;

const chevron = (
  <SymbolView
    name="chevron.right"
    tintColor={colors.tertiaryLabel}
    size={12}
    weight="semibold"
    accessible={false}
  />
);

/** One help request in a list: what was asked, where, for whom, and its status. */
export function RequestRow({ request, onPress }: { request: HelpRequest; onPress: () => void }) {
  const { t } = useLocale();
  const who = request.project?.name ?? request.requester?.displayName ?? t("helpRequester");
  const topics = [
    ...request.topics.map((topic) => topic.name),
    ...(request.other ? [t("helpOther")] : []),
  ];
  const status = t(HELP_STATUS_KEYS[request.status]);
  const lines = [`${who} · ${request.location}`, topics.join(", ")].filter(Boolean);
  return (
    <PressableFeedback
      feedback="row"
      accessibilityRole="button"
      accessibilityLabel={[request.description, status, ...lines].join(", ")}
      onPress={onPress}
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: space.md,
        minHeight: 72,
        paddingHorizontal: space.lg,
        paddingVertical: space.row,
      }}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={2} style={{ ...type.body, color: colors.label, fontWeight: "600" }}>
          {request.description}
        </Text>
        {lines.map((line) => (
          <Text
            key={line}
            numberOfLines={1}
            style={{ ...type.compact, color: colors.secondaryLabel }}
          >
            {line}
          </Text>
        ))}
        <StatusPill tone={HELP_STATUS_TONE[request.status]} style={{ marginTop: 2 }}>
          {status}
        </StatusPill>
      </View>
      {chevron}
    </PressableFeedback>
  );
}

/** One published helper: photo, name, knowledge and whether they can be found right now. */
export function HelperRow({ helper, onPress }: { helper: HelperCard; onPress: () => void }) {
  const { t } = useLocale();
  const topics = helper.topics.map((topic) => topic.name).join(", ");
  const scheduled = t(helper.scheduledNow ? "helpScheduledNow" : "helpNotScheduledNow");
  const presence = t(helper.present ? "helpInside" : "helpOutside");
  return (
    <PressableFeedback
      feedback="row"
      accessibilityRole="button"
      accessibilityLabel={[helper.displayName, topics, scheduled, presence]
        .filter(Boolean)
        .join(", ")}
      onPress={onPress}
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: space.md,
        minHeight: 76,
        paddingHorizontal: space.lg,
        paddingVertical: space.row,
      }}
    >
      <PersonAvatar size={48} name={helper.displayName} uri={helper.photoUrl} />
      <View style={{ flex: 1, gap: 3 }}>
        <Text numberOfLines={1} style={{ ...type.body, color: colors.label, fontWeight: "600" }}>
          {helper.displayName}
        </Text>
        {topics ? (
          <Text numberOfLines={1} style={{ ...type.compact, color: colors.secondaryLabel }}>
            {topics}
          </Text>
        ) : null}
        <View style={{ alignItems: "flex-start", flexDirection: "row", gap: space.xs }}>
          <View
            style={{
              backgroundColor: helper.availableNow ? colors.success : colors.tertiaryLabel,
              borderRadius: radius.full,
              height: 8,
              marginTop: 6,
              width: 8,
            }}
          />
          <Text style={{ ...type.compact, color: colors.secondaryLabel, flex: 1 }}>
            {scheduled} · {presence}
          </Text>
        </View>
      </View>
      {chevron}
    </PressableFeedback>
  );
}
