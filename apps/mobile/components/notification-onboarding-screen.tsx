import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingGlassButton, Section, Separator, ToggleRow } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { emitNotificationPreferenceChange } from "@/lib/notification-events";
import {
  completeNotificationOnboarding,
  markNotificationOnboardingHandled,
  ONBOARDING_CATEGORIES,
  onboardingEmailDraft,
  onboardingEmailLocked,
} from "@/lib/notification-onboarding";
import { useNotificationPreferences } from "@/lib/use-notification-preferences";
import { colors, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

/**
 * H51: one sheet, shown the first time someone with event access opens the
 * app, to choose which of queue calls, activity reminders and challenges also
 * go by email. With this phone signed in they arrive by push; without a device
 * email is how they reach the person, so the sheet shows it on.
 */
export default function NotificationOnboardingScreen() {
  const readable = useParticipantLayout("form");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useLocale();
  const { me, refetch } = useMeContext();
  const preferences = useNotificationPreferences();
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const meId = me?.id;
  const prefs = preferences.prefs;

  // The sheet mounting is the prompt's one presentation for this session.
  useEffect(() => {
    if (meId !== undefined) markNotificationOnboardingHandled(meId);
  }, [meId]);

  useEffect(() => {
    if (prefs && draft === null) setDraft(onboardingEmailDraft(prefs));
  }, [prefs, draft]);

  async function save() {
    if (saving || !prefs || !draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await completeNotificationOnboarding(prefs, draft);
      emitNotificationPreferenceChange(next);
      void haptic("success");
      await refetch();
      router.back();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause : new Error("Failed to save"));
    } finally {
      setSaving(false);
    }
  }

  const topInset = process.env.EXPO_OS === "android" ? insets.top : 0;
  const labels = {
    queue: t("queueCalls"),
    schedule: t("notificationsActivityReminders"),
    challenge: t("notificationsChallenges"),
  };

  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: 22,
          paddingVertical: 16,
          ...readable.content,
          paddingBottom: Math.max(32, insets.bottom + 16),
          paddingTop: 16 + topInset,
        }}
      >
        <View style={{ justifyContent: "center", minHeight: 44, paddingHorizontal: 52 }}>
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
            {t("notificationOnboardingTitle")}
          </Text>
        </View>

        {!prefs || !draft ? (
          <RequestFeedback
            loading={preferences.loading}
            error={preferences.error}
            onRetry={() => void preferences.load()}
          />
        ) : (
          <Section
            footer={
              prefs.hasPushDevice === false
                ? t("notificationOnboardingNoApp")
                : t("notificationOnboardingWithApp")
            }
          >
            {ONBOARDING_CATEGORIES.map((category, index) => (
              <View key={category}>
                {index > 0 ? <Separator /> : null}
                <ToggleRow
                  label={`${labels[category]} · ${t("emailLabel")}`}
                  value={draft[category] === true}
                  disabled={onboardingEmailLocked(prefs, category)}
                  onChange={(on) =>
                    setDraft((current) => current && { ...current, [category]: on })
                  }
                />
              </View>
            ))}
          </Section>
        )}

        {saveError ? (
          <RequestFeedback error={saveError} onRetry={() => void save()} retrying={saving} />
        ) : null}
      </ScrollView>

      <FloatingGlassButton
        top={16 + topInset}
        side="left"
        icon="xmark"
        accessibilityLabel={t("profileTasksLater")}
        disabled={saving}
        onPress={() => router.back()}
      />
      <FloatingGlassButton
        top={16 + topInset}
        side="right"
        icon="checkmark"
        tintColor={colors.accent}
        accessibilityLabel={t("save")}
        accessibilityState={{ busy: saving }}
        disabled={saving || !draft}
        onPress={() => void save()}
      />
    </View>
  );
}
