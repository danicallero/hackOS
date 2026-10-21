import { useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CvViewer } from "@/components/cv-viewer";
import { FloatingGlassButton, Section, Separator, ToggleRow } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { PressableFeedback } from "@/components/pressable-feedback";
import { ProfileCard, type ProfileCardData } from "@/components/profile-card";
import { QuickAction, VisibilityToggle } from "@/components/profile-parts";
import { ProfilePhotoMenu } from "@/components/profile-photo-menu";
import { RequestFeedback } from "@/components/RequestFeedback";
import { alert } from "@/lib/alert";
import { haptic } from "@/lib/haptics";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { useMeContext } from "@/lib/me-context";
import {
  BIO_MAX,
  draftFromProfile,
  fetchNetworkingProfile,
  HEADLINE_MAX,
  LOCATION_MAX,
  type NetworkingDraft,
  type NetworkingProfile,
  OWN_CV_PATH,
  sameDraft,
  saveNetworkingProfile,
} from "@/lib/networking-profile";
import { cvErrorKey, deleteCv, pickCv, uploadCv } from "@/lib/profile-cv";
import { colors, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

const AVATAR_SIZE = 112;

interface Failure {
  message: MessageKey;
  cause: Error;
  retry?: () => void;
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * #934, #935: the participant's public profile, the one people who scan their
 * badge read. It opens as that card exactly as scanners see it; the pencil
 * edits it in place with the same layout. The "share" switch is always
 * reachable: in the preview it saves on its own, while editing it is part of
 * the pending change. Links and the CV file stay on web, except that a phone
 * can upload a CV when the application did not provide one.
 */
export default function NetworkingProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const readable = useParticipantLayout("form");
  const { me } = useMeContext();
  const [profile, setProfile] = useState<NetworkingProfile | null>(null);
  const [stored, setStored] = useState<NetworkingDraft | null>(null);
  const [draft, setDraft] = useState<NetworkingDraft | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [togglingShare, setTogglingShare] = useState(false);
  const [cvBusy, setCvBusy] = useState<"upload" | "remove" | null>(null);
  const [cvOpen, setCvOpen] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // One key per pending change set, so a retried save replays instead of re-applying.
  const idempotencyKey = useRef<string | null>(null);
  // The card omits projects while they are hidden; keep the last ones seen so
  // the editor can show what hiding withholds.
  const knownProjects = useRef<Pick<ProfileCardData, "projects" | "challenges">>({
    projects: [],
    challenges: [],
  });
  const topInset = process.env.EXPO_OS === "android" ? insets.top : 0;

  const apply = useCallback((next: NetworkingProfile) => {
    if (next.preview.projects.length > 0) {
      knownProjects.current = {
        projects: next.preview.projects,
        challenges: next.preview.challenges,
      };
    } else if (next.showProject) {
      knownProjects.current = { projects: [], challenges: [] };
    }
    const fresh = draftFromProfile(next);
    setProfile(next);
    setStored(fresh);
    setDraft(fresh);
  }, []);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      const next = await fetchNetworkingProfile();
      apply(next);
      // Nothing shared yet: the useful first step is filling it in.
      if (!next.directoryVisible) setEditing(true);
    } catch (cause) {
      setFailure({
        message: "networkingLoadError",
        cause: asError(cause),
        retry: () => void load(),
      });
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  function update(patch: Partial<NetworkingDraft>) {
    idempotencyKey.current = null;
    setFailure(null);
    setDraft((current) => current && { ...current, ...patch });
  }

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    setFailure(null);
    idempotencyKey.current ??= createIdempotencyKey();
    try {
      const next = await saveNetworkingProfile(draft, idempotencyKey.current);
      idempotencyKey.current = null;
      apply(next);
      setEditing(false);
      void haptic("success");
    } catch (cause) {
      setFailure({
        message: "networkingSaveError",
        cause: asError(cause),
        retry: () => void save(),
      });
    } finally {
      setSaving(false);
    }
  }

  /** The preview's switch saves at once; a failure puts it back. */
  async function toggleShare(directoryVisible: boolean) {
    if (!stored || togglingShare) return;
    const before = stored;
    setTogglingShare(true);
    setFailure(null);
    setStored({ ...stored, directoryVisible });
    try {
      apply(await saveNetworkingProfile({ ...before, directoryVisible }, createIdempotencyKey()));
      void haptic("selection");
    } catch (cause) {
      setStored(before);
      setFailure({ message: "networkingSaveError", cause: asError(cause) });
    } finally {
      setTogglingShare(false);
    }
  }

  function startEditing() {
    if (!stored) return;
    idempotencyKey.current = null;
    setFailure(null);
    setDraft(stored);
    setEditing(true);
  }

  function stopEditing() {
    idempotencyKey.current = null;
    setFailure(null);
    setDraft(stored);
    setEditing(false);
  }

  /** The CV file saves on its own, like the photo; only its sharing waits for Save. */
  async function changeCv(action: "upload" | "remove") {
    if (cvBusy) return;
    setFailure(null);
    setCvBusy(action);
    try {
      let next: NetworkingProfile;
      if (action === "upload") {
        const picked = await pickCv();
        if (!picked) return;
        next = await uploadCv(picked);
      } else {
        next = await deleteCv();
      }
      setProfile(next);
      // Only the CV's sharing follows the file; pending text edits stay.
      const shareCv = next.cv ? next.shareCv : null;
      setStored((current) => current && { ...current, shareCv });
      setDraft((current) => current && { ...current, shareCv });
      void haptic("success");
    } catch (cause) {
      setFailure({ message: cvErrorKey(cause, action), cause: asError(cause) });
    } finally {
      setCvBusy(null);
    }
  }

  function confirmRemoveCv() {
    alert(t("networkingCvRemove"), undefined, [
      { text: t("cancel"), style: "cancel" },
      { text: t("remove"), style: "destructive", onPress: () => void changeCv("remove") },
    ]);
  }

  const dirty = Boolean(draft && stored && !sameDraft(draft, stored));
  const fullName = me ? [me.name, me.surname].filter(Boolean).join(" ") || me.email : "";

  function renderCard(current: NetworkingProfile, form: NetworkingDraft): ReactNode {
    const hasCv = current.cv !== null;
    let cvTile: ReactNode = null;
    if (editing) {
      cvTile = hasCv ? (
        <QuickAction
          icon="doc.text"
          label={t("directoryCv")}
          title={t("directoryCv")}
          busy={cvBusy !== null}
          dimmed={form.shareCv === false}
          onPress={() => setCvOpen(true)}
          accessory={
            <VisibilityToggle
              visible={form.shareCv === true}
              label={t("directoryCv")}
              onChange={(shareCv) => update({ shareCv })}
            />
          }
        />
      ) : (
        <QuickAction
          icon="plus"
          label={t("networkingCvUpload")}
          title={t("networkingCvUpload")}
          busy={cvBusy === "upload"}
          onPress={() => void changeCv("upload")}
        />
      );
    } else if (current.preview.cvUrl) {
      cvTile = (
        <QuickAction
          icon="doc.text"
          label={t("directoryCv")}
          title={t("directoryCv")}
          busy={false}
          onPress={() => setCvOpen(true)}
        />
      );
    }
    // An application CV is read-only here; only an upload can be replaced or removed.
    const manageCv = editing && current.cv?.source === "upload";
    const actions = (
      <View style={{ gap: 14 }}>
        {/* The scanner's tile row: their favourite and note tiles, greyed and
              inert here since they belong to whoever scans you (#934). */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={{ flex: 2, flexDirection: "row", gap: 10, opacity: 0.4 }}
          >
            <QuickAction
              icon="star"
              label={t("diaryFavourite")}
              title={t("diaryFavourite")}
              busy={false}
              onPress={() => {}}
            />
            <QuickAction
              icon="note.text"
              label={t("diaryNote")}
              title={t("diaryNote")}
              busy={false}
              onPress={() => {}}
            />
          </View>
          {cvTile ?? <View style={{ flex: 1 }} />}
        </View>
        {manageCv ? (
          <Section>
            <CvRow
              label={t("networkingCvReplace")}
              disabled={cvBusy !== null}
              onPress={() => void changeCv("upload")}
            />
            <Separator />
            <CvRow
              label={t("networkingCvRemove")}
              destructive
              disabled={cvBusy !== null}
              onPress={confirmRemoveCv}
            />
          </Section>
        ) : null}
      </View>
    );

    if (!editing) {
      const preview = current.preview;
      return (
        <ProfileCard
          data={preview}
          avatar={
            <PersonAvatar size={AVATAR_SIZE} name={preview.displayName} uri={preview.photoUrl} />
          }
          actions={actions}
        />
      );
    }

    const given = me?.name ?? "";
    const surname = me?.surname ?? "";
    const displayName =
      form.showSurname || !surname ? fullName : `${given} ${Array.from(surname)[0]}.`.trim();
    return (
      <ProfileCard
        data={{
          displayName,
          headline: form.headline,
          bio: form.bio,
          locationNote: form.locationNote,
          socials: current.preview.socials,
          ...knownProjects.current,
        }}
        actions={actions}
        avatar={
          <View style={{ height: AVATAR_SIZE, width: AVATAR_SIZE }}>
            <View style={{ opacity: form.showPhoto ? 1 : 0.4 }}>
              <ProfilePhotoMenu name={fullName} image={me?.image} size={AVATAR_SIZE} />
            </View>
            <View style={{ position: "absolute", right: -6, top: -6 }}>
              <VisibilityToggle
                visible={form.showPhoto}
                label={t("networkingShowPhoto")}
                onChange={(showPhoto) => update({ showPhoto })}
              />
            </View>
          </View>
        }
        edit={{
          headline: form.headline,
          bio: form.bio,
          locationNote: form.locationNote,
          onHeadline: (headline) => update({ headline }),
          onBio: (bio) => update({ bio }),
          onLocationNote: (locationNote) => update({ locationNote }),
          headlineMax: HEADLINE_MAX,
          bioMax: BIO_MAX,
          locationMax: LOCATION_MAX,
          surnameShared: form.showSurname,
          onSurnameShared: (showSurname) => update({ showSurname }),
          projectsShared: form.showProject,
          onProjectsShared: (showProject) => update({ showProject }),
          projectsPlaceholder: t("networkingShowProject"),
        }}
      />
    );
  }

  const shared = editing ? draft?.directoryVisible : stored?.directoryVisible;

  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      {profile?.cv && cvOpen ? (
        <CvViewer
          visible
          title={fullName}
          cvPath={editing ? OWN_CV_PATH : (profile.preview.cvUrl ?? OWN_CV_PATH)}
          onClose={() => setCvOpen(false)}
        />
      ) : null}
      <ScrollView
        alwaysBounceVertical
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: 22,
          paddingVertical: 16,
          ...readable.content,
          paddingBottom: Math.max(32, insets.bottom + 16),
          paddingTop: 16 + topInset,
        }}
      >
        <View style={{ justifyContent: "center", minHeight: 44 }}>
          <Text
            accessibilityRole="header"
            selectable
            style={{
              color: colors.label,
              fontSize: type.title3.fontSize,
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            {t("networkingTitle")}
          </Text>
        </View>

        {profile && draft && stored ? (
          <>
            <Section footer={t("networkingAudience")}>
              <ToggleRow
                label={t("networkingShare")}
                value={Boolean(shared)}
                disabled={saving || togglingShare}
                onChange={(directoryVisible) =>
                  editing ? update({ directoryVisible }) : void toggleShare(directoryVisible)
                }
              />
            </Section>
            {/* Not shared yet: the card is a preview of what scanners will get. */}
            <View style={{ gap: 24, opacity: shared ? 1 : 0.5 }}>
              {renderCard(profile, editing ? draft : stored)}
            </View>
          </>
        ) : failure?.message === "networkingLoadError" ? null : (
          <RequestFeedback loading />
        )}

        {failure ? (
          <RequestFeedback
            error={failure.cause}
            message={t(failure.message)}
            onRetry={failure.retry}
          />
        ) : null}
      </ScrollView>

      <FloatingGlassButton
        top={16 + topInset}
        side="left"
        icon="xmark"
        accessibilityLabel={editing ? t("cancel") : t("back")}
        disabled={saving}
        onPress={() => (editing ? stopEditing() : router.back())}
      />
      {editing ? (
        <FloatingGlassButton
          top={16 + topInset}
          side="right"
          icon="checkmark"
          tintColor={colors.accent}
          accessibilityLabel={t("save")}
          accessibilityState={{ busy: saving }}
          disabled={saving || !dirty || cvBusy !== null}
          onPress={() => void save()}
        />
      ) : (
        <FloatingGlassButton
          top={16 + topInset}
          side="right"
          icon="pencil"
          accessibilityLabel={t("networkingEdit")}
          disabled={!stored || togglingShare}
          onPress={startEditing}
        />
      )}
    </View>
  );
}

function CvRow({
  label,
  destructive = false,
  disabled,
  onPress,
}: {
  label: string;
  destructive?: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <PressableFeedback
      feedback="row"
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        justifyContent: "center",
        minHeight: 50,
        opacity: disabled ? 0.5 : 1,
        paddingHorizontal: 16,
      }}
    >
      <Text
        style={{
          color: destructive ? colors.destructive : colors.accent,
          fontSize: type.callout.fontSize,
        }}
      >
        {label}
      </Text>
    </PressableFeedback>
  );
}
