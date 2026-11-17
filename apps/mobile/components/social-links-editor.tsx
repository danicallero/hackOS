import { handleOf, SOCIAL_HANDLE_PREFIX, urlForHandle } from "@hackos/shared/social-links";
import { useRef } from "react";
import { Linking, Text, TextInput, View } from "react-native";
import { MenuView } from "@/components/app-menu";
import { Section, Separator } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { DetailRow } from "@/components/profile-parts";
import { SymbolView } from "@/components/symbol";
import { displayUrl, socialLabel } from "@/lib/directory";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { type NetworkingDraft, SOCIALS_MAX } from "@/lib/networking-profile";
import { colors, MIN_TARGET, space, type } from "@/theme";

const KINDS = ["linkedin", "x", "instagram", "website", "other"] as const;
type Kind = (typeof KINDS)[number];
type Link = NetworkingDraft["socials"][number];
/** Fixed type column, so every row's value starts on the same line. */
const KIND_WIDTH = 92;
/** Separators start under the type label, past the remove control. */
const ROW_TEXT_INSET = 50;

/** The first kind not used yet, so a new row rarely needs a type change (matches web). */
function nextKind(links: Link[]): Kind {
  const used = new Set(links.map((link) => link.kind));
  return KINDS.find((kind) => !used.has(kind)) ?? "other";
}

/** Changing type keeps a typed handle under the new network's address. */
function retype(link: Link, kind: Kind): Link {
  const from = SOCIAL_HANDLE_PREFIX[link.kind];
  const to = SOCIAL_HANDLE_PREFIX[kind];
  const handle = from ? handleOf(link.url, from) : link.url;
  return { ...link, kind, url: to ? urlForHandle(handle, to) : from ? "" : link.url };
}

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
  // Only a row the person just added takes focus, never rows loaded from the profile.
  const addedRef = useRef(false);
  const label = (kind: (typeof KINDS)[number]) =>
    kind === "other" ? t("networkingLinkOther") : socialLabel({ kind, url: "" }, t);
  return (
    <Section title={t("directoryLinks")}>
      {links.map((link, index) => {
        const prefix = SOCIAL_HANDLE_PREFIX[link.kind];
        return (
          <View key={link.id}>
            {index > 0 ? <Separator inset={ROW_TEXT_INSET} /> : null}
            {/* Contacts-style edit row: remove, type, divider, value. */}
            <View
              style={{
                alignItems: "center",
                flexDirection: "row",
                minHeight: MIN_TARGET,
                paddingLeft: space.md,
              }}
            >
              <PressableFeedback
                accessibilityRole="button"
                accessibilityLabel={`${t("remove")} ${index + 1}`}
                disabled={disabled}
                hitSlop={8}
                onPress={() => onChange(links.filter((_, i) => i !== index))}
                style={{ marginRight: space.md }}
              >
                <SymbolView name="minus.circle.fill" size={22} tintColor={colors.destructive} />
              </PressableFeedback>
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
                    onChange(links.map((row, i) => (i === index ? retype(row, kind) : row)));
                }}
              >
                <View
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`${t("networkingLinkType")} ${index + 1}`}
                  accessibilityState={{ disabled }}
                  style={{
                    alignItems: "center",
                    flexDirection: "row",
                    gap: 2,
                    minHeight: MIN_TARGET,
                    width: KIND_WIDTH,
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{ ...type.callout, color: colors.accent, flexShrink: 1 }}
                  >
                    {link.kind === "github" ? "GitHub" : label(link.kind)}
                  </Text>
                  <SymbolView
                    name="chevron.up.chevron.down"
                    size={11}
                    tintColor={colors.accent}
                    weight="semibold"
                  />
                </View>
              </MenuView>
              <View
                style={{
                  alignSelf: "stretch",
                  backgroundColor: colors.separator,
                  marginVertical: space.sm,
                  width: 0.5,
                }}
              />
              <View
                style={{
                  alignItems: "center",
                  flex: 1,
                  flexDirection: "row",
                  paddingHorizontal: space.md,
                }}
              >
                {prefix ? (
                  <Text style={{ ...type.body, color: colors.tertiaryLabel }}>{prefix}</Text>
                ) : null}
                <TextInput
                  accessibilityLabel={`${t("networkingLinkUrl")} ${index + 1}`}
                  value={prefix ? handleOf(link.url, prefix) : link.url}
                  onChangeText={(text) =>
                    onChange(
                      links.map((row, i) =>
                        i === index
                          ? { ...row, url: prefix ? urlForHandle(text, prefix) : text }
                          : row,
                      ),
                    )
                  }
                  autoFocus={link.url === "" && index === links.length - 1 && addedRef.current}
                  editable={!disabled}
                  maxLength={prefix ? 150 : 200}
                  keyboardType={prefix ? "default" : "url"}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={prefix ? undefined : "https://"}
                  placeholderTextColor={colors.tertiaryLabel}
                  style={{
                    ...type.body,
                    color: colors.label,
                    flex: 1,
                    minHeight: MIN_TARGET,
                    padding: 0,
                  }}
                />
              </View>
            </View>
          </View>
        );
      })}
      {githubUrl ? (
        <DetailRow
          icon="link"
          label="GitHub"
          value={displayUrl(githubUrl)}
          onPress={() => void Linking.openURL(githubUrl)}
        />
      ) : null}
      {links.length < SOCIALS_MAX ? (
        <>
          {links.length > 0 || githubUrl ? <Separator inset={ROW_TEXT_INSET} /> : null}
          <PressableFeedback
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => {
              addedRef.current = true;
              onChange([...links, { id: createIdempotencyKey(), kind: nextKind(links), url: "" }]);
            }}
            style={{
              alignItems: "center",
              flexDirection: "row",
              gap: space.md,
              minHeight: MIN_TARGET,
              paddingHorizontal: space.md,
            }}
          >
            <SymbolView name="plus.circle.fill" size={22} tintColor={colors.success} />
            <Text style={{ ...type.body, color: colors.label }}>{t("networkingLinkAdd")}</Text>
          </PressableFeedback>
        </>
      ) : null}
    </Section>
  );
}
