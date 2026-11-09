import { Text, View } from "react-native";
import { Section } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { PressableFeedback } from "@/components/pressable-feedback";
import { SymbolView } from "@/components/symbol";
import { type HelperCard, type HelpRequest, shortMoment } from "@/lib/help-desk";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { colors, radius, space, type } from "@/theme";

/**
 * How a request's state reads wherever it appears: one symbol and one label
 * (no capsule), tinted only while the request still needs attention.
 */
export const HELP_STATUS: Record<
  HelpRequest["status"],
  {
    label: MessageKey;
    icon: "clock" | "figure.walk" | "checkmark.circle" | "xmark.circle";
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
export function RequestRow({
  request,
  onPress,
  own = false,
}: {
  request: HelpRequest;
  onPress: () => void;
  own?: boolean;
}) {
  const { t, language } = useLocale();
  const status = HELP_STATUS[request.status];
  const meta = `${request.location} · ${requestOwner(request, t("helpRequester"))}`;
  const context = request.challenge?.name ?? request.topics.map((topic) => topic.name).join(", ");
  const position = request.queuePosition
    ? t("helpQueuePosition", { position: String(request.queuePosition) })
    : null;
  return (
    <PressableFeedback
      feedback="row"
      accessibilityRole="button"
      accessibilityLabel={[
        request.description,
        own ? request.project?.name : meta,
        position ?? t(status.label),
        context,
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={onPress}
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
      }}
    >
      <View style={{ flex: 1, gap: space.xxs }}>
        <View style={{ alignItems: "baseline", flexDirection: "row", gap: space.sm }}>
          <Text
            numberOfLines={2}
            style={{ ...type.body, fontWeight: "500", color: colors.label, flex: 1 }}
          >
            {request.description}
          </Text>
          <Text style={{ ...type.footnote, color: colors.secondaryLabel }}>
            {request.queuePosition
              ? `#${request.queuePosition}`
              : shortMoment(request.createdAt, language)}
          </Text>
        </View>
        {own ? null : (
          <Text numberOfLines={1} style={{ ...type.subhead, color: colors.secondaryLabel }}>
            {meta}
          </Text>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xxs }}>
            <SymbolView
              name={status.icon}
              tintColor={request.status === "resolved" ? colors.success : colors[status.tint]}
              size={13}
              accessible={false}
            />
            <Text style={{ ...type.footnote, fontWeight: "500", color: colors.label }}>
              {t(status.label)}
            </Text>
          </View>
          {request.challenge ? (
            <Text
              numberOfLines={1}
              style={{
                ...type.footnote,
                color: colors.secondaryLabel,
                flex: 1,
                textAlign: "right",
              }}
            >
              {request.challenge.name}
            </Text>
          ) : null}
        </View>
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

/** H63: a neutral, readable label for the person's actual public role. */
export function RoleBadge({ role }: { role: string | null }) {
  if (!role) return null;
  return (
    <View
      style={{
        alignSelf: "center",
        backgroundColor: colors.elevatedSurface,
        borderRadius: radius.full,
        paddingHorizontal: space.sm,
        paddingVertical: space.xxs,
        flexShrink: 1,
      }}
    >
      <Text style={{ ...type.footnote, fontWeight: "600", color: colors.label }}>{role}</Text>
    </View>
  );
}

/** H63: the affiliated company is its own profile section before knowledge. */
export function HelperCompany({ helper }: { helper: HelperCard }) {
  const { t } = useLocale();
  if (!helper.affiliation) return null;
  return (
    <Section title={t("helpCompany")}>
      <View
        style={{ alignItems: "center", flexDirection: "row", gap: space.md, padding: space.lg }}
      >
        <PersonAvatar
          size={40}
          name={helper.affiliation}
          uri={helper.affiliationLogoUrl}
          kind="sponsor"
        />
        <Text selectable style={{ ...type.body, color: colors.label, flex: 1 }}>
          {helper.affiliation}
        </Text>
      </View>
    </Section>
  );
}

/** Presence is an explicit label and symbol; the plan is a separate secondary line. */
export function HelperPresence({ helper }: { helper: HelperCard }) {
  const { t } = useLocale();
  return (
    <View style={{ gap: space.xxs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <SymbolView
          name={helper.present ? "checkmark.circle.fill" : "circle"}
          tintColor={helper.present ? colors.success : colors.secondaryLabel}
          size={15}
          accessible={false}
        />
        <Text style={{ ...type.subhead, color: colors.label, fontWeight: "600", flexShrink: 1 }}>
          {t(helper.present ? "helpInside" : "helpOutside")}
        </Text>
      </View>
      <Text style={{ ...type.footnote, color: colors.secondaryLabel }}>
        {t(helper.scheduledNow ? "helpScheduledNow" : "helpNotScheduledNow")}
      </Text>
    </View>
  );
}

/** H63: a Contacts-style row with a clear identity, role, company, knowledge and presence. */
export function HelperRow({ helper, onPress }: { helper: HelperCard; onPress: () => void }) {
  const { t } = useLocale();
  const topics = helper.topics.map((topic) => topic.name).join(", ");
  return (
    <PressableFeedback
      feedback="row"
      accessibilityRole="button"
      accessibilityLabel={[
        helper.displayName,
        helper.visibleRoleName,
        helper.affiliation,
        topics,
        helperNowLabel(helper, t),
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={onPress}
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
      }}
    >
      <View>
        <PersonAvatar size={40} name={helper.displayName} uri={helper.photoUrl} />
        {helper.present ? (
          <View
            style={{
              position: "absolute",
              bottom: 0,
              right: 0,
              backgroundColor: colors.surface,
              padding: space.hair,
              borderRadius: radius.full,
            }}
          >
            <SymbolView name="circle.fill" tintColor={colors.success} size={8} accessible={false} />
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: space.xxs }}>
        <View style={{ alignItems: "center", flexDirection: "row", gap: space.sm }}>
          <Text style={{ ...type.body, fontWeight: "500", color: colors.label, flex: 1 }}>
            {helper.displayName}
          </Text>
          {helper.visibleRoleName ? (
            <View style={{ maxWidth: "55%", flexShrink: 1 }}>
              <RoleBadge role={helper.visibleRoleName} />
            </View>
          ) : null}
        </View>
        {helper.affiliation ? (
          <Text numberOfLines={1} style={{ ...type.subhead, color: colors.secondaryLabel }}>
            {helper.affiliation}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Text
            numberOfLines={1}
            style={{ ...type.footnote, color: colors.secondaryLabel, flex: 1 }}
          >
            {topics}
          </Text>
        </View>
      </View>
      {chevron}
    </PressableFeedback>
  );
}
