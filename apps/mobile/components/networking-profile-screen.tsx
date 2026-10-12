import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionButton, Section, Separator, ToggleRow } from "@/components/native-ui";
import { ProfilePhotoMenu } from "@/components/profile-photo-menu";
import { RequestFeedback } from "@/components/RequestFeedback";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { useMeContext } from "@/lib/me-context";
import {
  BIO_MAX,
  draftFromProfile,
  fetchNetworkingProfile,
  HEADLINE_MAX,
  LOCATION_MAX,
  type NetworkingDraft,
  sameDraft,
  saveNetworkingProfile,
} from "@/lib/networking-profile";
import { colors } from "@/theme/colors";

/**
 * #934, #935: the participant's public profile, the one people who scan their
 * badge read. A sheet like the profile tasks; web keeps the links and the CV.
 */
export default function NetworkingProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const { me } = useMeContext();
  const [stored, setStored] = useState<NetworkingDraft | null>(null);
  const [draft, setDraft] = useState<NetworkingDraft | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);
  // One key per pending change set, so a retried save replays instead of re-applying.
  const idempotencyKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const next = draftFromProfile(await fetchNetworkingProfile());
      setStored(next);
      setDraft(next);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function update(patch: Partial<NetworkingDraft>) {
    idempotencyKey.current = null;
    setSaveError(null);
    setDraft((current) => current && { ...current, ...patch });
  }

  async function save() {
    if (!draft || saving) return;
    setSaving(true);
    setSaveError(null);
    idempotencyKey.current ??= createIdempotencyKey();
    try {
      await saveNetworkingProfile(draft, idempotencyKey.current);
      idempotencyKey.current = null;
      void haptic("success");
      router.back();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setSaving(false);
    }
  }

  const dirty = Boolean(draft && stored && !sameDraft(draft, stored));

  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: 22,
          padding: 16,
          paddingBottom: Math.max(32, insets.bottom + 16),
          paddingTop: 16 + (process.env.EXPO_OS === "android" ? insets.top : 0),
        }}
      >
        <Text
          accessibilityRole="header"
          selectable
          style={{ color: colors.label, fontSize: 20, fontWeight: "700", textAlign: "center" }}
        >
          {t("networkingTitle")}
        </Text>

        {loadError ? (
          <RequestFeedback
            error={loadError}
            message={t("networkingLoadError")}
            onRetry={() => void load()}
          />
        ) : null}
        {draft ? (
          <>
            {me ? (
              <View style={{ alignItems: "center" }}>
                <ProfilePhotoMenu
                  name={[me.name, me.surname].filter(Boolean).join(" ") || me.email}
                  image={me.image}
                  size={72}
                />
              </View>
            ) : null}
            <Section footer={t("networkingAudience")}>
              <ToggleRow
                label={t("networkingShare")}
                value={draft.directoryVisible}
                onChange={(directoryVisible) => update({ directoryVisible })}
              />
            </Section>
            {draft.directoryVisible ? (
              <>
                <Section>
                  <ToggleRow
                    label={t("networkingShowSurname")}
                    value={draft.showSurname}
                    onChange={(showSurname) => update({ showSurname })}
                  />
                  <Separator />
                  <ToggleRow
                    label={t("networkingShowPhoto")}
                    value={draft.showPhoto}
                    onChange={(showPhoto) => update({ showPhoto })}
                  />
                  <Separator />
                  <ToggleRow
                    label={t("networkingShowProject")}
                    value={draft.showProject}
                    onChange={(showProject) => update({ showProject })}
                  />
                </Section>
                <Section>
                  <ProfileInput
                    label={t("networkingHeadline")}
                    max={HEADLINE_MAX}
                    value={draft.headline}
                    onChange={(headline) => update({ headline })}
                  />
                  <Separator />
                  <ProfileInput
                    label={t("networkingLocation")}
                    max={LOCATION_MAX}
                    placeholder={t("networkingLocationPlaceholder")}
                    value={draft.locationNote}
                    onChange={(locationNote) => update({ locationNote })}
                  />
                  <Separator />
                  <ProfileInput
                    label={t("networkingBio")}
                    max={BIO_MAX}
                    multiline
                    value={draft.bio}
                    onChange={(bio) => update({ bio })}
                  />
                </Section>
              </>
            ) : null}
          </>
        ) : loadError ? null : (
          <RequestFeedback loading />
        )}

        {saveError ? (
          <RequestFeedback
            error={saveError}
            message={t("networkingSaveError")}
            onRetry={() => void save()}
          />
        ) : null}

        <View style={{ gap: 8 }}>
          <ActionButton
            label={t("save")}
            variant="filled"
            busy={saving}
            disabled={!dirty}
            onPress={() => void save()}
          />
          <ActionButton label={t("cancel")} disabled={saving} onPress={() => router.back()} />
        </View>
      </ScrollView>
    </View>
  );
}

function ProfileInput({
  label,
  max,
  multiline = false,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  max: number;
  multiline?: boolean;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextInput
      accessibilityLabel={label}
      maxLength={max}
      multiline={multiline}
      onChangeText={onChange}
      placeholder={placeholder ?? label}
      placeholderTextColor={colors.tertiaryLabel}
      style={{ color: colors.label, fontSize: 16, minHeight: multiline ? 96 : 50, padding: 16 }}
      value={value}
    />
  );
}
