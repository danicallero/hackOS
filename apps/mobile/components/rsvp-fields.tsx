import { Text, View } from "react-native";
import { Section, Separator } from "@/components/native-ui";
import { SegmentedControl } from "@/components/segmented-control";
import { useLocale } from "@/lib/i18n";
import type { RsvpAnswer, RsvpItem } from "@/lib/rsvps";
import { colors, space, type } from "@/theme";

const ANSWERS: RsvpAnswer[] = ["yes", "no", "unsure"];

/** H59: the same optional yes/no/unsure editor in Account and next-entry onboarding. */
export function RsvpFields({
  items,
  draft,
  onChange,
  disabled = false,
  showTitle = true,
}: {
  items: RsvpItem[];
  draft: Record<number, RsvpAnswer>;
  onChange: (id: number, answer: RsvpAnswer) => void;
  disabled?: boolean;
  showTitle?: boolean;
}) {
  const { t, language } = useLocale();
  const values = [t("rsvpYes"), t("rsvpNo"), t("rsvpUnsure")];
  if (!items.length) return null;
  return (
    <Section title={showTitle ? t("profileRsvpTitle") : undefined}>
      {items.map((item, index) => {
        const answer = item.locked ? item.answer : (draft[item.activityId] ?? item.answer);
        return (
          <View key={item.activityId}>
            {index > 0 ? <Separator /> : null}
            <View style={{ gap: space.sm, padding: space.lg }}>
              <Text selectable style={{ color: colors.label, fontSize: type.body.fontSize }}>
                {item.name}
              </Text>
              <Text
                selectable
                style={{ color: colors.secondaryLabel, fontSize: type.footnote.fontSize }}
              >
                {new Date(item.date).toLocaleString(language, {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
              {item.description ? (
                <Text
                  selectable
                  style={{ color: colors.secondaryLabel, fontSize: type.footnote.fontSize }}
                >
                  {item.description}
                </Text>
              ) : null}
              {disabled || item.locked ? (
                <Text
                  selectable
                  style={{ color: colors.secondaryLabel, fontSize: type.body.fontSize }}
                >
                  {answer ? values[ANSWERS.indexOf(answer)] : t("rsvpUnanswered")}
                  {item.locked ? ` · ${t("rsvpClosed")}` : ""}
                </Text>
              ) : (
                <SegmentedControl
                  label={item.name}
                  values={values}
                  selectedIndex={answer ? ANSWERS.indexOf(answer) : -1}
                  onChange={(selected) => {
                    const next = ANSWERS[selected];
                    if (next) onChange(item.activityId, next);
                  }}
                />
              )}
            </View>
          </View>
        );
      })}
    </Section>
  );
}
