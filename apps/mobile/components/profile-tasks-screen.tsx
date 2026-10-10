import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActionButton, Section, Separator, ToggleRow } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  type DietaryDraft,
  dietaryDraftFromMe,
  fetchMealPlan,
  isDietaryAnswered,
  markProfileTasksHandled,
  mealLabel,
  mealPlanCacheKey,
  parseProfileTasks,
  saveDietary,
  saveMealPlan,
  setNoRestrictions,
  toggleIntolerance,
} from "@/lib/profile-tasks";
import type { MealPlan } from "@/lib/types";
import { useCachedApi } from "@/lib/use-cached-api";
import { useFoodIntolerances } from "@/lib/use-food-intolerances";
import { colors } from "@/theme/colors";

/**
 * #933: one sheet for the pending profile tasks (dietary answer, sponsor meal
 * plan). Opened by the root layout's next-entry prompt and, for dietary data
 * only, from the account screen.
 */
export default function ProfileTasksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, language } = useLocale();
  const params = useLocalSearchParams<{ tasks?: string; edit?: string }>();
  const tasks = parseProfileTasks(params.tasks);
  // Opened from Account to edit one answer rather than as the next-entry prompt.
  const editing = params.edit === "1";
  const { me, refetch } = useMeContext();
  // H7: a locked profile's dietary data is not self-editable; skip the step.
  const showDietary = tasks.includes("dietary") && !me?.profileLocked;
  const wantsMeals = tasks.includes("meal_plan");
  const { intolerances } = useFoodIntolerances(showDietary);
  const mealPlan = useCachedApi<MealPlan>(
    me ? mealPlanCacheKey(me.id) : "meal-plan:none",
    fetchMealPlan,
    { enabled: wantsMeals && Boolean(me) },
  );
  const [dietary, setDietary] = useState<DietaryDraft | null>(() =>
    me ? dietaryDraftFromMe(me) : null,
  );
  // Set once the PATCH succeeds, so a retry after a failed PUT resends only the meals.
  const [dietarySaved, setDietarySaved] = useState(false);
  const [attending, setAttending] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const meId = me?.id;
  const loadMealPlan = mealPlan.load;

  // The sheet mounting is the prompt's one presentation for this session.
  useEffect(() => {
    if (meId !== undefined && !editing) markProfileTasksHandled(meId);
  }, [editing, meId]);

  useEffect(() => {
    if (wantsMeals && meId !== undefined) void loadMealPlan();
  }, [loadMealPlan, meId, wantsMeals]);

  if (!me || !dietary) return null;

  const plan = mealPlan.data;
  const dietaryReady = !showDietary || isDietaryAnswered(dietary);
  // A failed plan load must not block saving the dietary answer on its own.
  const mealsReady = !wantsMeals || plan !== null || mealPlan.error !== null;
  const nothingToSave = !showDietary && plan === null;

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
      if (wantsMeals && plan) {
        try {
          mealPlan.setData(await saveMealPlan(plan, attending));
        } catch {
          setSaveError(t("mealPlanSaveError"));
          // The dietary answer may already be stored; reflect it in /api/me.
          if (showDietary) await refetch();
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
        {editing ? null : (
          <Text
            accessibilityRole="header"
            selectable
            style={{ color: colors.label, fontSize: 20, fontWeight: "700", textAlign: "center" }}
          >
            {t("profileTasksTitle")}
          </Text>
        )}

        {showDietary ? (
          <Section title={t("accountFoodIntolerances")} footer={t("dietaryDataHandlingNote")}>
            <ToggleRow
              label={t("noRestrictions")}
              value={dietary.noRestrictions}
              onChange={(on) => setDietary((current) => current && setNoRestrictions(current, on))}
            />
            {intolerances.map((item) => (
              <View key={item.id}>
                <Separator />
                <ToggleRow
                  label={item.label[language]}
                  value={dietary.intolerances.includes(item.id)}
                  onChange={(on) =>
                    setDietary((current) => current && toggleIntolerance(current, item.id, on))
                  }
                />
              </View>
            ))}
            {dietary.noRestrictions ? null : (
              <>
                <Separator />
                <TextInput
                  accessibilityLabel={t("accountDietaryNotes")}
                  multiline
                  onChangeText={(notes) =>
                    setDietary((current) => current && { ...current, notes })
                  }
                  placeholder={t("accountDietaryNotes")}
                  placeholderTextColor={colors.tertiaryLabel}
                  style={{ color: colors.label, fontSize: 16, minHeight: 50, padding: 16 }}
                  value={dietary.notes}
                />
              </>
            )}
          </Section>
        ) : null}

        {wantsMeals ? (
          plan ? (
            <Section title={t("mealsTitle")} footer={t("mealsLockNote")}>
              {plan.meals.map((meal, index) => (
                <View key={meal.activityId}>
                  {index > 0 ? <Separator /> : null}
                  <ToggleRow
                    label={mealLabel(meal, language)}
                    value={attending[meal.activityId] ?? meal.attending ?? false}
                    disabled={meal.locked}
                    onChange={(on) =>
                      setAttending((current) => ({ ...current, [meal.activityId]: on }))
                    }
                  />
                </View>
              ))}
            </Section>
          ) : mealPlan.error ? (
            <RequestFeedback
              error={mealPlan.error}
              onRetry={() => void mealPlan.load()}
              retrying={mealPlan.loading}
            />
          ) : (
            <RequestFeedback loading />
          )
        ) : null}

        {saveError ? (
          <RequestFeedback error={new Error(saveError)} onRetry={() => void save()} />
        ) : null}

        <View style={{ gap: 8 }}>
          <ActionButton
            label={t("save")}
            variant="filled"
            busy={saving}
            disabled={!dietaryReady || !mealsReady || nothingToSave}
            onPress={() => void save()}
          />
          <ActionButton
            label={editing ? t("cancel") : t("profileTasksLater")}
            disabled={saving}
            onPress={() => router.back()}
          />
        </View>
      </ScrollView>
    </View>
  );
}
