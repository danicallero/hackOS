import { Text, View } from "react-native";
import { PersonAvatar } from "@/components/person-avatar";
import { PressableFeedback } from "@/components/pressable-feedback";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { type HelperCard, type HelpRequest, shortMoment } from "@/lib/help-desk";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { colors, space, type } from "@/theme";

/**
 * How a request's state reads wherever it appears: one symbol and one label
 * (no capsule), tinted only while the request still needs attention.
 */
export const HELP_STATUS: Record<
  HelpRequest["status"],
  {
    label: MessageKey;
    icon: SymbolViewProps["name"];
    /** A colour token, read at render so the scheme is current. */
    tint: "warning" | "success" | "secondaryLabel";
  }
> = {
  open: { label: "helpNotClaimed", icon: "clock", tint: "warning" },
  claimed: { label: "helpClaimed", icon: "figure.walk", tint: "success" },
  resolved: { label: "helpResolved", icon: "checkmark.circle", tint: "secondaryLabel" },
  cancelled: { label: "helpCancelled", icon: "xmark.circle", tint: "secondaryLabel" },
};

const chevron = (
  <SymbolView
    name="chevron.right"
    tintColor={colors.tertiaryLabel}
    size={12}
    weight="semibold"
    accessible={false}
  />
);

/** Who asked: the team for a team request, else the person. */
export function requestOwner(request: HelpRequest, fallback: string): string {
  return request.project?.name ?? request.requester?.displayName ?? fallback;
}

/**
 * One help request as a Mail-style row: the state's symbol leading, what was
 * asked, where and by whom beneath, the time it was asked trailing.
 */
export function RequestRow({ request, onPress }: { request: HelpRequest; onPress: () => void }) {
  const { t, language } = useLocale();
  const status = HELP_STATUS[request.status];
  const meta = `${request.location} · ${requestOwner(request, t("helpRequester"))}`;
  const when = shortMoment(request.createdAt, language);
  return (
    <PressableFeedback
      feedback="row"
      accessibilityRole="button"
      accessibilityLabel={[request.description, t(status.label), meta, when].join(", ")}
      onPress={onPress}
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: space.md,
        minHeight: 64,
        paddingHorizontal: space.lg,
        paddingVertical: space.row,
      }}
    >
      <SymbolView name={status.icon} tintColor={colors[status.tint]} size={22} accessible={false} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ alignItems: "baseline", flexDirection: "row", gap: space.sm }}>
          <Text numberOfLines={2} style={{ ...type.body, color: colors.label, flex: 1 }}>
            {request.description}
          </Text>
          <Text style={{ ...type.compact, color: colors.secondaryLabel }}>{when}</Text>
        </View>
        <Text numberOfLines={1} style={{ ...type.compact, color: colors.secondaryLabel }}>
          {meta}
        </Text>
        <Text numberOfLines={1} style={{ ...type.compact, color: colors[status.tint] }}>
          {t(status.label)}
        </Text>
      </View>
      {chevron}
    </PressableFeedback>
  );
}

/** Whether a helper can be found right now: their schedule and the venue door (H24) apart. */
export function helperNowLabel(helper: HelperCard, t: (key: MessageKey) => string): string {
  return `${t(helper.scheduledNow ? "helpScheduledNow" : "helpNotScheduledNow")} · ${t(
    helper.present ? "helpInside" : "helpOutside",
  )}`;
}

/** One published helper as a Contacts-style row: photo, name, knowledge, and now. */
export function HelperRow({ helper, onPress }: { helper: HelperCard; onPress: () => void }) {
  const { t } = useLocale();
  const topics = helper.topics.map((topic) => topic.name).join(", ");
  const now = helperNowLabel(helper, t);
  return (
    <PressableFeedback
      feedback="row"
      accessibilityRole="button"
      accessibilityLabel={[helper.displayName, topics, now].filter(Boolean).join(", ")}
      onPress={onPress}
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: space.md,
        minHeight: 64,
        paddingHorizontal: space.lg,
        paddingVertical: space.row,
      }}
    >
      <PersonAvatar size={40} name={helper.displayName} uri={helper.photoUrl} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ ...type.body, color: colors.label }}>
          {helper.displayName}
        </Text>
        {topics ? (
          <Text numberOfLines={1} style={{ ...type.compact, color: colors.secondaryLabel }}>
            {topics}
          </Text>
        ) : null}
        <Text
          numberOfLines={1}
          style={{
            ...type.compact,
            color: helper.availableNow ? colors.success : colors.secondaryLabel,
          }}
        >
          {now}
        </Text>
      </View>
      {chevron}
    </PressableFeedback>
  );
}
