import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingGlassButton, Section, Separator, ToggleRow } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { RsvpFields } from "@/components/rsvp-fields";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  type DietaryDraft,
  dietaryDraftFromMe,
  isDietaryAnswered,
  markProfileTasksHandled,
  parseProfileTasks,
  saveDietary,
  setNoRestrictions,
  toggleIntolerance,
} from "@/lib/profile-tasks";
import { useRsvps } from "@/lib/rsvps";
import { useFoodIntolerances } from "@/lib/use-food-intolerances";
import { colors, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

/**
 * H59 / #933: next-entry sheet for dietary answers and activity RSVPs.
 * Account also opens it to edit the dietary answer.
 */
export default function ProfileTasksScreen() {
  const readable = useParticipantLayout("form");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, language } = useLocale();
  const params = useLocalSearchParams<{ tasks?: string; edit?: string }>();
  const tasks = parseProfileTasks(params.tasks);
  // Opened from Account to edit one answer rather than as the next-entry prompt.
  const editing = params.edit === "1";
  const { me, refetch, loading, error } = useMeContext();
  // H7: locked dietary data is not self-editable; skip the step.
  const showDietary = tasks.includes("dietary") && !me?.dietaryLocked;
  const wantsRsvps = tasks.includes("rsvp") || tasks.includes("meal_plan");
  const rsvps = useRsvps(wantsRsvps && me ? me.id : null);
  const {
    intolerances,
    error: intolerancesError,
    loading: intolerancesLoading,
    reload: reloadIntolerances,
  } = useFoodIntolerances(showDietary);
  const [dietary, setDietary] = useState<DietaryDraft | null>(() =>
    me ? dietaryDraftFromMe(me) : null,
  );
  // Set once the PATCH succeeds, so a retry after a failed PUT resends only the RSVP answers.
  const [dietarySaved, setDietarySaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const meId = me?.id;

  // The sheet mounting is the prompt's one presentation for this session.
  useEffect(() => {
    if (meId !== undefined && !editing) markProfileTasksHandled(meId);
  }, [editing, meId]);

  useEffect(() => {
    if (me && !dietary) setDietary(dietaryDraftFromMe(me));
  }, [me, dietary]);

  if (!me || !dietary)
    return <RequestFeedback loading={loading} error={error} onRetry={() => void refetch()} />;

  const dietaryReady = !showDietary || isDietaryAnswered(dietary);
  // A failed RSVP read must still allow an independent dietary answer to save.
  const rsvpsReady = !wantsRsvps || rsvps.data !== null || rsvps.error !== null;
  const nothingToSave = !showDietary && rsvps.data === null;

  async function save() {
    if (saving || !me || !dietary) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (showDietary && !dietarySaved) {
        try {
          await saveDietary(dietary);
          setDietarySaved(true);
        } catch {
          setSaveError(t("dietarySaveError"));
          return;
        }
      }
      if (wantsRsvps && rsvps.data) {
        try {
          await rsvps.save();
        } catch {
          setSaveError(t("couldNotSaveRsvps"));
          void rsvps.load();
          return;
        }
      }
      void haptic("success");
      await refetch();
      router.back();
    } finally {
      setSaving(false);
    }
  }

  const canSave = !(!dietaryReady || !rsvpsReady || nothingToSave);
  const topInset = process.env.EXPO_OS === "android" ? insets.top : 0;
  const title = editing ? t("accountFoodIntolerances") : t("profileTasksTitle");

  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      {intolerancesError ? (
        <RequestFeedback
          error={intolerancesError}
          onRetry={() => void reloadIntolerances()}
          retrying={intolerancesLoading}
        />
      ) : null}
      <ScrollView
        alwaysBounceVertical
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
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
            {title}
          </Text>
        </View>

        {showDietary ? (
          <>
            <Section>
              <ToggleRow
                label={t("noRestrictions")}
                value={dietary.noRestrictions}
                onChange={(on) =>
                  setDietary((current) => current && setNoRestrictions(current, on))
                }
              />
            </Section>

            {intolerances.length > 0 ? (
              <Section title={t("accountFoodIntolerances")}>
                {intolerances.map((item, index) => (
                  <View key={item.id}>
                    {index > 0 ? <Separator /> : null}
                    <ToggleRow
                      label={item.label[language]}
                      value={dietary.intolerances.includes(item.id)}
                      onChange={(on) =>
                        setDietary((current) => current && toggleIntolerance(current, item.id, on))
                      }
                    />
                  </View>
                ))}
              </Section>
            ) : null}

            <Section title={t("accountDietaryNotes")} footer={t("dietaryDataHandlingNote")}>
              <TextInput
                accessibilityLabel={t("accountDietaryNotes")}
                editable={!dietary.noRestrictions}
                multiline
                onChangeText={(notes) => setDietary((current) => current && { ...current, notes })}
                placeholder={t("accountDietaryNotes")}
                placeholderTextColor={colors.tertiaryLabel}
                style={{
                  color: dietary.noRestrictions ? colors.tertiaryLabel : colors.label,
                  fontSize: type.callout.fontSize,
                  lineHeight: 22,
                  minHeight: 90,
                  padding: 16,
                  textAlignVertical: "top",
                }}
                value={dietary.notes}
              />
            </Section>
          </>
        ) : null}

        {wantsRsvps ? (
          <>
            {!rsvps.data ? (
              <RequestFeedback
                loading={rsvps.loading}
                error={rsvps.error}
                onRetry={() => void rsvps.load()}
              />
            ) : null}
            <RsvpFields
              items={rsvps.items}
              draft={rsvps.draft}
              disabled={saving}
              onChange={(id, answer) => rsvps.setDraft((draft) => ({ ...draft, [id]: answer }))}
            />
          </>
        ) : null}

        {saveError ? (
          <RequestFeedback error={new Error(saveError)} onRetry={() => void save()} />
        ) : null}
      </ScrollView>

      <FloatingGlassButton
        top={16 + topInset}
        side="left"
        icon="xmark"
        accessibilityLabel={editing ? t("cancel") : t("profileTasksLater")}
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
        disabled={saving || !canSave}
        onPress={() => void save()}
      />
    </View>
  );
}
