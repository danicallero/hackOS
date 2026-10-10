import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import { useRouter, useScrollToTop } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useColorScheme,
  View,
} from "react-native";
import {
  ActionButton,
  AndroidStatusBarScrim,
  InfoRow,
  Section,
  Separator,
  StatusPill,
  ToggleRow,
} from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { apiFetch } from "@/lib/api";
import { useApiMode } from "@/lib/api-mode";
import { appVersionLabel } from "@/lib/app-version";
import { forceLocalSignOut, signOut } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { type Lang, useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  fetchMealPlan,
  mealLabel,
  mealPlanCacheKey,
  PROFILE_TASKS_PATH,
  saveMealPlan,
} from "@/lib/profile-tasks";
import { roleDisplayName } from "@/lib/role-filters";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { wipeAttendanceRoster } from "@/lib/scanner-db";
import { canViewStaffStatistics } from "@/lib/tabs";
import type { MealPlan } from "@/lib/types";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useCachedApi } from "@/lib/use-cached-api";
import { useFoodIntolerances } from "@/lib/use-food-intolerances";
import { colors } from "@/theme/colors";

const LANGUAGES: Lang[] = ["en", "es", "gl"];

/** Account overview with the same participant-owned profile fields exposed on web. */
export default function AccountScreen() {
  useColorScheme();
  const router = useRouter();
  const { t, language } = useLocale();
  const androidTopInset = useAndroidTopInset();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef);
  const { me, loading, error, offline, staleSince, refetch } = useMeContext();
  const { mode, setMode } = useApiMode();
  const { intolerances, reload: loadSupportingData } = useFoodIntolerances(Boolean(me));
  const isSponsorRep = Boolean(me?.isSponsorRep);
  const mealPlanKey = me ? mealPlanCacheKey(me.id) : "meal-plan:none";
  const mealPlan = useCachedApi<MealPlan>(mealPlanKey, fetchMealPlan, { enabled: isSponsorRep });
  const [savingMealId, setSavingMealId] = useState<number | null>(null);
  const [mealPlanError, setMealPlanError] = useState<Error | null>(null);
  const loadMealPlan = mealPlan.load;
  const pendingTasks = me?.pendingProfileTasks?.join(",");

  // Reload after the next-entry sheet saves, which changes the pending tasks.
  useEffect(() => {
    void pendingTasks;
    if (isSponsorRep) void loadMealPlan();
  }, [isSponsorRep, loadMealPlan, pendingTasks]);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [languageError, setLanguageError] = useState<Error | null>(null);
  const [languageRetry, setLanguageRetry] = useState<Lang | null>(null);
  const [refreshingAccount, setRefreshingAccount] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<Error | null>(null);
  const developerTapCount = useRef(0);
  const developerTapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function returnToSignIn() {
    forceLocalSignOut();
    router.replace("/(auth)/sign-in");
  }

  async function refreshAccount() {
    if (refreshingAccount) return;
    setRefreshingAccount(true);
    try {
      await Promise.all([
        refetch(),
        loadSupportingData(),
        isSponsorRep ? mealPlan.load() : Promise.resolve(),
      ]);
    } finally {
      setRefreshingAccount(false);
    }
  }

  async function changeLanguage(nextLanguage: Lang) {
    if (nextLanguage === me?.language || savingLanguage) return;
    setSavingLanguage(true);
    setLanguageError(null);
    setLanguageRetry(nextLanguage);
    try {
      await apiFetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: nextLanguage }),
      });
      await refetch();
      setLanguageRetry(null);
      void haptic("selection");
    } catch (cause) {
      setLanguageError(cause instanceof Error ? cause : new Error(t("accountLanguageError")));
    } finally {
      setSavingLanguage(false);
    }
  }

  // #933: each toggle submits the whole plan as shown (PUT replace semantics).
  async function toggleMeal(activityId: number, attending: boolean) {
    const plan = mealPlan.data;
    if (!plan || offline || savingMealId !== null) return;
    setSavingMealId(activityId);
    setMealPlanError(null);
    try {
      mealPlan.setData(await saveMealPlan(plan, { [activityId]: attending }));
      void refetch();
    } catch (cause) {
      setMealPlanError(cause instanceof Error ? cause : new Error(t("mealPlanSaveError")));
      // A meal may have locked since the list loaded; show the server's state.
      void mealPlan.load();
    } finally {
      setSavingMealId(null);
    }
  }

  async function endSession() {
    if (!me || signingOut) return;
    const ownerUserId = me.id;
    setSigningOut(true);
    setSignOutError(null);
    try {
      const { error: authError } = await signOut();
      if (authError) throw new Error(authError.message || t("signOutError"));
    } catch (cause) {
      setSignOutError(cause instanceof Error ? cause : new Error(t("signOutError")));
      setSigningOut(false);
      return;
    }
    // The roster is shared event data, while the offline scan queue is
    // user-owned and intentionally remains available after a re-login.
    try {
      await wipeAttendanceRoster(ownerUserId);
    } catch {
      // Best effort: a failed local roster wipe must not resurface after the
      // on-device session is already gone.
    }
  }

  function confirmSignOut() {
    // Staff still able to scan offline (using a cached profile) could lock
    // themselves out entirely by signing out with no server reachable to
    // re-authenticate against — warn them before that happens.
    const capabilities = me?.capabilities ?? [];
    const isStaff =
      capabilities.includes("*") ||
      capabilities.some((capability) =>
        ["accredit:scan", "presence:scan", "activity:scan"].includes(capability),
      );
    if (offline && isStaff) {
      Alert.alert(t("signOutOfflineConfirmTitle"), t("signOutOfflineConfirmBody"), [
        { text: t("cancel"), style: "cancel" },
        { text: t("signOut"), style: "destructive", onPress: () => void endSession() },
      ]);
      return;
    }
    Alert.alert(t("signOutConfirmTitle"), t("signOutConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("signOut"), style: "destructive", onPress: () => void endSession() },
    ]);
  }

  function revealDeveloperMode() {
    developerTapCount.current += 1;
    if (developerTapTimeout.current) clearTimeout(developerTapTimeout.current);
    developerTapTimeout.current = setTimeout(() => {
      developerTapCount.current = 0;
    }, 2_000);
    if (developerTapCount.current < 7) return;
    developerTapCount.current = 0;
    Alert.alert(
      t("apiModeTitle"),
      mode === "development" ? t("apiModeProductionBody") : t("apiModeDevelopmentBody"),
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("apiModeSwitch"),
          onPress: () => {
            void setMode(mode === "development" ? "production" : "development").catch((error) => {
              Alert.alert(
                t("apiModeTitle"),
                `${t("apiModeSwitchError")}\n${error instanceof Error ? error.message : String(error)}`,
              );
            });
          },
        },
      ],
    );
  }

  if (loading && !me) return <RequestFeedback loading />;
  if (!me) return <RequestFeedback error={error} onRetry={() => void refetch()} />;

  const fullName = [me.name, me.surname].filter(Boolean).join(" ") || me.email;
  const initials =
    [me.name, me.surname]
      .filter(Boolean)
      .map((part) => part?.[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || me.email[0].toUpperCase();
  const canEditDietary = !offline && !me.profileLocked;
  const dietaryLabels = me.foodIntolerances
    .map((id) => intolerances.find((item) => item.id === id)?.label[language] ?? String(id))
    .join(", ");
  const dietaryValue =
    dietaryLabels || (me.dietaryConfirmedAt ? t("noRestrictions") : t("accountNoneDeclared"));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        testID="account-scroll"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{
          gap: 20,
          padding: 16,
          paddingBottom: Math.max(32, tabBarBottomInset + 16),
          paddingTop: 16 + androidTopInset,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshingAccount} onRefresh={() => void refreshAccount()} />
        }
      >
        {offline ? (
          <StaleDataBanner updatedAt={staleSince} />
        ) : error ? (
          <RequestFeedback error={error} onRetry={() => void refetch()} />
        ) : null}
        {languageError ? (
          <RequestFeedback
            error={languageError}
            message={t("accountLanguageError")}
            onRetry={languageRetry ? () => void changeLanguage(languageRetry) : undefined}
            retrying={savingLanguage}
          />
        ) : null}

        <View style={{ alignItems: "center", gap: 10, paddingVertical: 10 }}>
          <View
            style={{
              alignItems: "center",
              backgroundColor: colors.accent,
              borderRadius: 42,
              height: 84,
              justifyContent: "center",
              width: 84,
            }}
          >
            <Text selectable style={{ color: colors.accentText, fontSize: 30, fontWeight: "700" }}>
              {initials}
            </Text>
          </View>
          <View style={{ alignItems: "center", gap: 5 }}>
            <Text
              selectable
              style={{ color: colors.label, fontSize: 23, fontWeight: "700", textAlign: "center" }}
            >
              {fullName}
            </Text>
            <Text selectable style={{ color: colors.secondaryLabel, fontSize: 15 }}>
              {roleDisplayName(me.visibleRoleName, t)}
            </Text>
            <StatusPill tone={me.badgeId ? "success" : "neutral"} style={{ alignSelf: "center" }}>
              {me.badgeId ? t("accountAccredited") : t("accountNotAccredited")}
            </StatusPill>
          </View>
        </View>

        <Section title={t("accountProfile")}>
          <InfoRow label={t("accountName")} value={fullName} icon="person" />
          <Separator inset={48} />
          <MenuView
            actions={LANGUAGES.map(
              (lang): MenuAction => ({
                id: lang,
                title: languageName(lang),
                state: lang === me.language ? "on" : "off",
                attributes: savingLanguage ? { disabled: true } : undefined,
              }),
            )}
            onPressAction={({ nativeEvent }) => void changeLanguage(nativeEvent.event as Lang)}
          >
            <View
              accessible
              accessibilityLabel={t("accountLanguage")}
              accessibilityRole="button"
              accessibilityState={{ disabled: savingLanguage, busy: savingLanguage }}
            >
              <InfoRow
                label={t("accountLanguage")}
                value={languageName(me.language)}
                icon="globe"
                accessoryIcon="chevron.down"
              />
            </View>
          </MenuView>
        </Section>

        <Section title={t("accountContact")}>
          <InfoRow
            label={t("accountEmail")}
            value={me.email}
            icon="envelope"
            accessoryIcon={
              me.emailVerified ? "checkmark.seal.fill" : "exclamationmark.triangle.fill"
            }
            accessoryColor={me.emailVerified ? colors.success : colors.warning}
            accessoryLabel={me.emailVerified ? t("accountVerified") : t("accountNotVerified")}
          />
          <Separator inset={48} />
          <InfoRow
            label={t("accountSecondaryEmail")}
            value={me.secondaryEmail || t("accountNotSet")}
            icon="envelope.badge"
            accessoryIcon={
              me.secondaryEmail
                ? me.secondaryEmailVerified
                  ? "checkmark.seal.fill"
                  : "exclamationmark.triangle.fill"
                : undefined
            }
            accessoryColor={
              me.secondaryEmail
                ? me.secondaryEmailVerified
                  ? colors.success
                  : colors.warning
                : undefined
            }
            accessoryLabel={
              me.secondaryEmail
                ? me.secondaryEmailVerified
                  ? t("accountVerified")
                  : t("accountNotVerified")
                : undefined
            }
          />
        </Section>

        <Section title={t("accountEventDetails")}>
          <InfoRow
            label={t("accountBadge")}
            value={me.badgeId ?? t("accountNoBadge")}
            icon="key.card"
          />
          <Separator inset={48} />
          <InfoRow
            label={t("accountShirtSize")}
            value={me.shirtSize || t("accountNotSet")}
            icon="tshirt"
          />
          <Separator inset={48} />
          {canEditDietary ? (
            <Pressable
              accessibilityLabel={t("accountFoodIntolerances")}
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: PROFILE_TASKS_PATH,
                  params: { tasks: "dietary", edit: "1" },
                })
              }
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              <InfoRow
                label={t("accountFoodIntolerances")}
                value={dietaryValue}
                icon="fork.knife"
                accessoryIcon="chevron.right"
              />
            </Pressable>
          ) : (
            <InfoRow label={t("accountFoodIntolerances")} value={dietaryValue} icon="fork.knife" />
          )}
          {me.foodIntoleranceNotes ? (
            <>
              <Separator inset={48} />
              <View style={{ gap: 5, padding: 16 }}>
                <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                  {t("accountDietaryNotes")}
                </Text>
                <Text selectable style={{ color: colors.label, fontSize: 16 }}>
                  {me.foodIntoleranceNotes}
                </Text>
              </View>
            </>
          ) : null}
        </Section>

        {isSponsorRep && mealPlan.data && mealPlan.data.meals.length > 0 ? (
          <Section title={t("mealsTitle")} footer={t("mealsLockNote")}>
            {mealPlanError ? (
              <RequestFeedback error={mealPlanError} message={t("mealPlanSaveError")} />
            ) : null}
            {mealPlan.data.meals.map((meal, index) => (
              <View key={meal.activityId}>
                {index > 0 ? <Separator /> : null}
                <ToggleRow
                  label={mealLabel(meal, language)}
                  value={meal.attending ?? false}
                  // Offline the cached plan stays visible but read-only.
                  disabled={offline || meal.locked || savingMealId !== null}
                  onChange={(on) => void toggleMeal(meal.activityId, on)}
                />
              </View>
            ))}
          </Section>
        ) : null}

        {canViewStaffStatistics(me.capabilities) ? (
          <Section title={t("accountStaff")}>
            <AccountSubpageRow
              label={t("accountStatistics")}
              icon="chart.bar.xaxis"
              onPress={() => router.push("/(tabs)/others/statistics")}
            />
          </Section>
        ) : null}

        <Section title={t("accountApp")}>
          <AccountSubpageRow
            label={t("storageTitle")}
            icon="internaldrive.fill"
            onPress={() => router.push("/(tabs)/others/storage")}
          />
        </Section>

        <Section title={t("accountAccount")}>
          <AccountSubpageRow
            label={t("accountLegalTitle")}
            icon="doc.text"
            onPress={() => router.push("/(tabs)/others/legal")}
          />
          <Separator inset={48} />
          <AccountSubpageRow
            label={t("accountDeleteSection")}
            icon="trash"
            onPress={() => router.push("/(tabs)/others/delete-account")}
          />
        </Section>

        {signOutError ? (
          <>
            <RequestFeedback
              error={signOutError}
              message={t("signOutError")}
              onRetry={() => void endSession()}
              retrying={signingOut}
            />
            <Pressable
              accessibilityLabel={t("backToSignIn")}
              accessibilityRole="link"
              onPress={returnToSignIn}
              style={({ pressed }) => ({
                alignItems: "center",
                justifyContent: "center",
                minHeight: 44,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text
                selectable
                style={{
                  color: colors.interactiveText,
                  fontSize: 15,
                  fontWeight: "700",
                  textAlign: "center",
                }}
              >
                {t("backToSignIn")}
              </Text>
            </Pressable>
          </>
        ) : null}
        <Section title={t("sessionTitle")} footer={t("sessionActive", { email: me.email })}>
          <ActionButton
            label={t("signOut")}
            icon="rectangle.portrait.and.arrow.right"
            destructive
            busy={signingOut}
            onPress={confirmSignOut}
          />
        </Section>
        <Pressable
          accessibilityLabel={appVersionLabel}
          onPress={revealDeveloperMode}
          style={{ alignSelf: "center", padding: 8 }}
        >
          <Text style={{ color: colors.tertiaryLabel, fontSize: 12 }}>{appVersionLabel}</Text>
        </Pressable>
      </ScrollView>
      <AndroidStatusBarScrim />
    </View>
  );
}

function AccountSubpageRow({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: Parameters<typeof InfoRow>[0]["icon"];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <InfoRow accessoryIcon="chevron.right" icon={icon} label={label} value="" />
    </Pressable>
  );
}

function languageName(language: string) {
  return (
    ({ en: "English", es: "Español", gl: "Galego" } as Record<string, string>)[language] ?? language
  );
}
