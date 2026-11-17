import { handleOf, SOCIAL_HANDLE_PREFIX, urlForHandle } from "@hackos/shared/social-links";
import { useRef } from "react";
import { Linking, Text, TextInput, View } from "react-native";
import { MenuView } from "@/components/app-menu";
import { Section, Separator } from "@/components/native-ui";
import { PressableFeedback } from "@/components/pressable-feedback";
import { VisibilityToggle } from "@/components/profile-parts";
import { SOCIAL_TILE_SIZE, SocialGlyph, SocialTile } from "@/components/social-glyph";
import { SymbolView } from "@/components/symbol";
import { type SocialKind, socialLabel } from "@/lib/directory";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { type NetworkingDraft, SOCIALS_MAX } from "@/lib/networking-profile";
import { colors, MIN_TARGET, space, type } from "@/theme";

const KINDS = ["linkedin", "x", "instagram", "website", "other"] as const;
type Kind = (typeof KINDS)[number];
type Link = NetworkingDraft["socials"][number];
/** Fixed type column, so every row's value starts on the same line. */
const KIND_WIDTH = 104;
/** Separators start under the type label, past the tile. */
const ROW_TEXT_INSET = space.lg + SOCIAL_TILE_SIZE + space.md;
const REMOVE = "remove";

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

/** A typed "@ada" is the handle "ada"; a pasted address is reduced by urlForHandle. */
function typedHandle(text: string): string {
  return text.trimStart().replace(/^@+/, "");
}

/**
 * The network picker: the system menu (Liquid Glass on iOS 26), like every
 * other menu in the app. iOS menus take only SF Symbols, which have no brand
 * marks, so the networks are listed by name; the row's tile keeps the glyph
 * (#934, #935).
 */
function KindMenu({
  link,
  index,
  disabled,
  label,
  onKind,
  onRemove,
}: {
  link: Link;
  index: number;
  disabled: boolean;
  label: (kind: SocialKind) => string;
  onKind: (kind: Kind) => void;
  onRemove: () => void;
}) {
  const { t } = useLocale();
  return (
    <MenuView
      shouldOpenOnLongPress={false}
      actions={[
        {
          // An inline section, so Remove sits apart like in system menus.
          id: "kinds",
          title: "",
          displayInline: true,
          subactions: KINDS.map((kind) => ({
            id: kind,
            title: label(kind),
            state: kind === link.kind ? ("on" as const) : ("off" as const),
            attributes: { disabled },
          })),
        },
        {
          id: REMOVE,
          title: t("remove"),
          image: "trash",
          attributes: { destructive: true, disabled },
        },
      ]}
      onPressAction={({ nativeEvent }) => {
        if (disabled) return;
        if (nativeEvent.event === REMOVE) return onRemove();
        const kind = KINDS.find((value) => value === nativeEvent.event);
        if (kind) onKind(kind);
      }}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${t("networkingLinkType")} ${index + 1}`}
        accessibilityState={{ disabled }}
        style={{ alignItems: "center", flexDirection: "row", gap: space.md, minHeight: MIN_TARGET }}
      >
        <SocialTile kind={link.kind} />
        <KindLabel text={label(link.kind)} />
      </View>
    </MenuView>
  );
}

/** A network name with the up/down chevron that marks a menu trigger. */
function KindLabel({ text }: { text: string }) {
  return (
    <View style={{ alignItems: "center", flexDirection: "row", gap: 3, width: KIND_WIDTH }}>
      <Text numberOfLines={1} style={{ ...type.body, color: colors.label, flexShrink: 1 }}>
        {text}
      </Text>
      <SymbolView
        accessible={false}
        name="chevron.up.chevron.down"
        size={11}
        tintColor={colors.tertiaryLabel}
        weight="semibold"
      />
    </View>
  );
}

const OPEN = "open";
const RELINK = "relink";

/** The linked GitHub account: managed by the account link, not typed here. */
export interface GithubProps {
  configured: boolean;
  login: string | null;
  /** Whether scanners see it (`showGithub`, part of the pending change). */
  shown: boolean;
  onShown: (shown: boolean) => void;
  /** Starts GitHub's authorization; `selectAccount` lets them pick another account. */
  onLink: (selectAccount: boolean) => void;
  linking: boolean;
}

/**
 * #934, #935: the linked account, with the eye that keeps it off the card and
 * a menu to open it or link another account. Without one, a row to link it.
 */
function GithubRow({
  github,
  disabled,
  rowStyle,
}: {
  github: GithubProps;
  disabled: boolean;
  rowStyle: object;
}) {
  const { t } = useLocale();
  const { login } = github;
  if (!login) {
    return (
      <PressableFeedback
        accessibilityRole="button"
        disabled={disabled || github.linking}
        onPress={() => github.onLink(false)}
        style={rowStyle}
      >
        <SocialTile kind="github" />
        <Text style={{ ...type.body, color: colors.accent }}>{t("networkingGithubLink")}</Text>
      </PressableFeedback>
    );
  }
  return (
    <View style={rowStyle}>
      <MenuView
        shouldOpenOnLongPress={false}
        actions={[
          {
            id: OPEN,
            title: t("networkingGithubOpen"),
            image: "arrow.up.right",
            attributes: { disabled: disabled || github.linking },
          },
          {
            id: RELINK,
            title: t("networkingGithubRelink"),
            image: "arrow.triangle.2.circlepath",
            attributes: { disabled: disabled || github.linking },
          },
        ]}
        onPressAction={({ nativeEvent }) => {
          if (disabled || github.linking) return;
          if (nativeEvent.event === OPEN) void Linking.openURL(`https://github.com/${login}`);
          else if (nativeEvent.event === RELINK) github.onLink(true);
        }}
      >
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel={`GitHub, ${login}`}
          style={{
            alignItems: "center",
            flexDirection: "row",
            gap: space.md,
            minHeight: MIN_TARGET,
          }}
        >
          <SocialTile kind="github" />
          <KindLabel text="GitHub" />
        </View>
      </MenuView>
      <Text
        numberOfLines={1}
        style={{
          ...type.body,
          color: colors.label,
          flex: 1,
          opacity: github.shown ? 1 : 0.4,
        }}
      >
        {login}
      </Text>
      <VisibilityToggle
        visible={github.shown}
        label={t("networkingShowGithub")}
        onChange={github.onShown}
      />
    </View>
  );
}

/** #934, #935: editable stored links; the linked GitHub account is kept separately. */
export function SocialLinksEditor({
  links,
  disabled,
  github,
  onChange,
}: {
  links: NetworkingDraft["socials"];
  disabled: boolean;
  github?: GithubProps;
  onChange: (links: NetworkingDraft["socials"]) => void;
}) {
  const { t } = useLocale();
  // Only a row the person just added takes focus, never rows loaded from the profile.
  const addedRef = useRef(false);
  const label = (kind: SocialKind) =>
    kind === "other" ? t("networkingLinkOther") : socialLabel({ kind, url: "" }, t);
  const rowStyle = {
    alignItems: "center" as const,
    flexDirection: "row" as const,
    gap: space.md,
    minHeight: MIN_TARGET + space.xs,
    paddingHorizontal: space.lg,
  };
  return (
    <Section title={t("directoryLinks")}>
      {links.map((link, index) => {
        const prefix = SOCIAL_HANDLE_PREFIX[link.kind];
        return (
          <View key={link.id}>
            {index > 0 ? <Separator inset={ROW_TEXT_INSET} /> : null}
            <View style={rowStyle}>
              <KindMenu
                link={link}
                index={index}
                disabled={disabled}
                label={label}
                onKind={(kind) =>
                  onChange(links.map((row, i) => (i === index ? retype(row, kind) : row)))
                }
                onRemove={() => onChange(links.filter((_, i) => i !== index))}
              />
              <TextInput
                accessibilityLabel={`${t("networkingLinkUrl")} ${index + 1}`}
                value={prefix ? handleOf(link.url, prefix) : link.url}
                onChangeText={(text) =>
                  onChange(
                    links.map((row, i) =>
                      i === index
                        ? {
                            ...row,
                            url: prefix ? urlForHandle(typedHandle(text), prefix) : text,
                          }
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
                numberOfLines={1}
                placeholder={prefix ? t("networkingLinkHandle") : "https://"}
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
        );
      })}
      {github?.login || github?.configured ? (
        <>
          {links.length > 0 ? <Separator inset={ROW_TEXT_INSET} /> : null}
          <GithubRow github={github} disabled={disabled} rowStyle={rowStyle} />
        </>
      ) : null}
      {links.length < SOCIALS_MAX ? (
        <>
          {links.length > 0 || github?.login || github?.configured ? (
            <Separator inset={ROW_TEXT_INSET} />
          ) : null}
          <PressableFeedback
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => {
              addedRef.current = true;
              onChange([...links, { id: createIdempotencyKey(), kind: nextKind(links), url: "" }]);
            }}
            style={rowStyle}
          >
            <View style={{ alignItems: "center", width: SOCIAL_TILE_SIZE }}>
              <SymbolView name="plus.circle.fill" size={24} tintColor={colors.success} />
            </View>
            <Text style={{ ...type.body, color: colors.label }}>{t("networkingLinkAdd")}</Text>
          </PressableFeedback>
        </>
      ) : null}
    </Section>
  );
}
