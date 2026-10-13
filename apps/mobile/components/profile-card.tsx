import type { ReactNode } from "react";
import { type LayoutChangeEvent, Linking, Text, TextInput, View } from "react-native";
import { Section, Separator } from "@/components/native-ui";
import { DetailRow, VisibilityToggle } from "@/components/profile-parts";
import { type DirectoryEntry, displayUrl, socialLabel } from "@/lib/directory";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

const ROW_ICON_INSET = 52;

/** Singular and plural row labels per project kind. */
const PROJECT_KINDS: { kind: "project"; one: MessageKey; many: MessageKey }[] = [
  { kind: "project", one: "directoryProject", many: "directoryProjects" },
];

export type ProfileCardData = Pick<
  DirectoryEntry,
  "displayName" | "headline" | "bio" | "locationNote" | "socials" | "projects" | "challenges"
>;

/**
 * The owner's way to change the card in place (#934): the same layout the
 * scanners read, with inputs where text goes and an eye on what can be hidden.
 * Hidden data stays on screen, greyed, so the owner sees what is withheld.
 */
export interface ProfileCardEdit {
  headline: string;
  bio: string;
  locationNote: string;
  onHeadline: (value: string) => void;
  onBio: (value: string) => void;
  onLocationNote: (value: string) => void;
  headlineMax: number;
  bioMax: number;
  locationMax: number;
  /** The eye on the name: whether the full surname is shared. */
  surnameShared: boolean;
  onSurnameShared: (shared: boolean) => void;
  projectsShared: boolean;
  onProjectsShared: (shared: boolean) => void;
  /** Stands in for project names the card does not carry while they are hidden. */
  projectsPlaceholder: string;
}

/**
 * What a scanned person's profile shows below the avatar (#934, #935),
 * shared by the diary's person screen and the owner's own preview/editor so
 * both always lay out the same card. `avatar` is the caller's avatar (it owns
 * the collapse animation or the photo menu); `actions` is the tile row and
 * `afterBio` the reader's note section.
 */
export function ProfileCard({
  data,
  avatar,
  actions,
  afterBio,
  onNameLayout,
  edit,
}: {
  data: ProfileCardData;
  avatar: ReactNode;
  actions?: ReactNode;
  afterBio?: ReactNode;
  onNameLayout?: (event: LayoutChangeEvent) => void;
  edit?: ProfileCardEdit;
}) {
  const { t } = useLocale();
  const headline = edit ? edit.headline : data.headline;
  const bio = edit ? edit.bio : data.bio;
  const locationNote = edit ? edit.locationNote : data.locationNote;
  const projectsDimmed = edit ? !edit.projectsShared : false;
  const projectEye = edit ? (
    <VisibilityToggle
      visible={edit.projectsShared}
      label={t("networkingShowProject")}
      onChange={edit.onProjectsShared}
    />
  ) : undefined;

  const rows: ReactNode[] = [];
  if (locationNote || edit) {
    rows.push(
      <DetailRow
        key="location"
        icon="mappin"
        label={t("directoryLocation")}
        value={locationNote ?? ""}
        valueNode={
          edit ? (
            <TextInput
              accessibilityLabel={t("networkingLocation")}
              maxLength={edit.locationMax}
              onChangeText={edit.onLocationNote}
              placeholder={t("networkingLocationPlaceholder")}
              placeholderTextColor={colors.tertiaryLabel}
              style={{ color: colors.label, fontSize: 16, lineHeight: 22, padding: 0 }}
              value={edit.locationNote}
            />
          ) : undefined
        }
      />,
    );
  }
  // Every project (#935). The first row
  // carries the owner's eye.
  let eyeUsed = false;
  for (const { kind, one, many } of PROJECT_KINDS) {
    const names = data.projects.filter((project) => project.kind === kind).map((p) => p.name);
    if (names.length === 0) continue;
    rows.push(
      <DetailRow
        key={kind}
        dimmed={projectsDimmed}
        icon="hammer"
        label={t(names.length === 1 ? one : many)}
        value={names.join("\n")}
        trailing={eyeUsed ? undefined : projectEye}
      />,
    );
    eyeUsed = true;
  }
  if (edit && !eyeUsed) {
    rows.push(
      <DetailRow
        key="projects"
        dimmed={projectsDimmed}
        icon="hammer"
        value={edit.projectsPlaceholder}
        trailing={projectEye}
      />,
    );
  }
  if (data.challenges.length > 0) {
    rows.push(
      <DetailRow
        key="challenges"
        dimmed={projectsDimmed}
        icon="trophy"
        label={t("directoryChallenges")}
        value={data.challenges.map((challenge) => challenge.name).join("\n")}
      />,
    );
  }

  return (
    <>
      <View style={{ alignItems: "center", gap: 14 }}>
        {avatar}
        <View
          onLayout={onNameLayout}
          style={{ alignItems: "center", gap: 4, paddingHorizontal: 8 }}
        >
          <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
            <Text
              selectable
              accessibilityRole="header"
              style={{ color: colors.label, fontSize: 26, fontWeight: "700", textAlign: "center" }}
            >
              {data.displayName}
            </Text>
            {edit ? (
              <VisibilityToggle
                visible={edit.surnameShared}
                label={t("networkingShowSurname")}
                onChange={edit.onSurnameShared}
              />
            ) : null}
          </View>
          {edit ? (
            <TextInput
              accessibilityLabel={t("networkingHeadline")}
              maxLength={edit.headlineMax}
              onChangeText={edit.onHeadline}
              placeholder={t("networkingHeadline")}
              placeholderTextColor={colors.tertiaryLabel}
              style={{
                color: colors.secondaryLabel,
                fontSize: 16,
                lineHeight: 21,
                minWidth: 160,
                textAlign: "center",
              }}
              value={edit.headline}
            />
          ) : headline ? (
            <Text
              selectable
              style={{
                color: colors.secondaryLabel,
                fontSize: 16,
                lineHeight: 21,
                textAlign: "center",
              }}
            >
              {headline}
            </Text>
          ) : null}
        </View>
      </View>

      {actions}

      {bio || edit ? (
        <Section>
          {edit ? (
            <TextInput
              accessibilityLabel={t("networkingBio")}
              maxLength={edit.bioMax}
              multiline
              onChangeText={edit.onBio}
              placeholder={t("networkingBio")}
              placeholderTextColor={colors.tertiaryLabel}
              style={{
                color: colors.label,
                fontSize: 16,
                lineHeight: 23,
                minHeight: 96,
                paddingHorizontal: 16,
                paddingVertical: 14,
                textAlignVertical: "top",
              }}
              value={edit.bio}
            />
          ) : (
            <Text
              selectable
              style={{
                color: colors.label,
                fontSize: 16,
                lineHeight: 23,
                paddingHorizontal: 16,
                paddingVertical: 14,
              }}
            >
              {bio}
            </Text>
          )}
        </Section>
      ) : null}

      {afterBio}

      {data.socials.length > 0 ? (
        <Section title={t("directoryLinks")}>
          {data.socials.map((link, index) => (
            <View key={`${link.kind}-${link.url}`}>
              {index > 0 ? <Separator inset={ROW_ICON_INSET} /> : null}
              <DetailRow
                icon={link.kind === "website" ? "globe" : "link"}
                label={socialLabel(link, t)}
                value={displayUrl(link.url)}
                onPress={() => void Linking.openURL(link.url)}
              />
            </View>
          ))}
        </Section>
      ) : null}

      {rows.length > 0 ? (
        <Section>
          {rows.map((row, index) => (
            <View key={(row as { key: string }).key}>
              {index > 0 ? <Separator inset={ROW_ICON_INSET} /> : null}
              {row}
            </View>
          ))}
        </Section>
      ) : null}
    </>
  );
}
