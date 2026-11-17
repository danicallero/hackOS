import { Linking, Text, TextInput, View } from "react-native";
import { MenuView } from "@/components/app-menu";
import { Section, Separator } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { DetailRow } from "@/components/profile-parts";
import { displayUrl, socialLabel } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { type NetworkingDraft, SOCIALS_MAX } from "@/lib/networking-profile";
import { colors, MIN_TARGET, space, type } from "@/theme";

const KINDS = ["linkedin", "x", "instagram", "website", "other"] as const;

/** #934, #935: editable stored links; the linked GitHub account is kept separately. */
export function SocialLinksEditor({
  links,
  disabled,
  githubUrl,
  onChange,
}: {
  links: NetworkingDraft["socials"];
  disabled: boolean;
  githubUrl?: string;
  onChange: (links: NetworkingDraft["socials"]) => void;
}) {
  const { t } = useLocale();
  const label = (kind: (typeof KINDS)[number]) =>
    kind === "other" ? t("networkingLinkOther") : socialLabel({ kind, url: "" }, t);
  return (
    <Section title={t("directoryLinks")}>
      {links.map((link, index) => (
        <View key={link.id}>
          {index > 0 ? <Separator /> : null}
          <View style={{ padding: space.lg, gap: space.sm }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <MenuView
                shouldOpenOnLongPress={false}
                actions={KINDS.map((kind) => ({
                  id: kind,
                  title: label(kind),
                  state: kind === link.kind ? ("on" as const) : ("off" as const),
                  attributes: { disabled },
                }))}
                onPressAction={({ nativeEvent }) => {
                  const kind = KINDS.find((value) => value === nativeEvent.event);
                  if (kind && !disabled)
                    onChange(links.map((row, i) => (i === index ? { ...row, kind } : row)));
                }}
              >
                <View
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`${t("networkingLinkType")} ${index + 1}`}
                  accessibilityState={{ disabled }}
                  style={{ minHeight: MIN_TARGET, justifyContent: "center" }}
                >
                  <Text style={{ ...type.body, color: colors.accent }}>
                    {link.kind === "github" ? "GitHub" : label(link.kind)} ▾
                  </Text>
                </View>
              </MenuView>
              <PressableFeedback
                accessibilityRole="button"
                accessibilityLabel={`${t("remove")} ${index + 1}`}
                disabled={disabled}
                onPress={() => onChange(links.filter((_, i) => i !== index))}
                style={{ minHeight: MIN_TARGET, justifyContent: "center" }}
              >
                <Text style={{ ...type.body, color: colors.destructive }}>{t("remove")}</Text>
              </PressableFeedback>
            </View>
            <TextInput
              accessibilityLabel={`${t("networkingLinkUrl")} ${index + 1}`}
              value={link.url}
              onChangeText={(url) =>
                onChange(links.map((row, i) => (i === index ? { ...row, url } : row)))
              }
              editable={!disabled}
              maxLength={200}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://"
              placeholderTextColor={colors.tertiaryLabel}
              style={{ ...type.body, color: colors.label, minHeight: MIN_TARGET, padding: 0 }}
            />
          </View>
        </View>
      ))}
      {githubUrl ? (
        <DetailRow
          icon="link"
          label="GitHub"
          value={displayUrl(githubUrl)}
          onPress={() => void Linking.openURL(githubUrl)}
        />
      ) : null}
      {links.length < SOCIALS_MAX ? (
        <PressableFeedback
          accessibilityRole="button"
          disabled={disabled}
          onPress={() =>
            onChange([...links, { id: createIdempotencyKey(), kind: "website", url: "" }])
          }
          style={{ minHeight: MIN_TARGET, paddingHorizontal: space.lg, justifyContent: "center" }}
        >
          <Text style={{ ...type.body, color: colors.accent }}>{t("networkingLinkAdd")}</Text>
        </PressableFeedback>
      ) : null}
    </Section>
  );
}
