import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import { useFocusEffect, useLocalSearchParams, useRouter, useScrollToTop } from "expo-router";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  type LayoutChangeEvent,
  Pressable,
  RefreshControl,
  type ScrollView,
  Text,
  useColorScheme,
  View,
} from "react-native";
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import {
  ActionButton,
  AndroidStatusBarScrim,
  InfoRow,
  Section,
  Separator,
  StatusPill,
  ToggleRow,
} from "@/components/native-ui";
import {
  ProfileAvatarCollapse,
  ProfileAvatarCollapseAnchor,
  useProfileAvatarCollapse,
} from "@/components/profile-avatar-collapse";
import { RequestFeedback } from "@/components/RequestFeedback";
import { StaleDataBanner } from "@/components/stale-data-banner";
import { UserAvatar } from "@/components/user-avatar";
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
import { canManageStands, canViewStaffStatistics } from "@/lib/tabs";
import type { MealPlan } from "@/lib/types";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { useCachedApi } from "@/lib/use-cached-api";
import { useFoodIntolerances } from "@/lib/use-food-intolerances";
import { colors } from "@/theme/colors";

const LANGUAGES: Lang[] = ["en", "es", "gl"];
/** H51: wait for the sheet dismissal + push transition before the visible scroll. */
const TRANSITION_SETTLE_MS = 450;
/** H51: time the animated scroll takes before the Preferences row flashes. */
const SCROLL_SETTLE_MS = 450;

/** Account overview with the same participant-owned profile fields exposed on web. */
export default function AccountScreen() {
  useColorScheme();
  const router = useRouter();
  const { t, language } = useLocale();
  const androidTopInset = useAndroidTopInset();
  const tabBarBottomInset = useRouterTabBarScrollBottomInset();
  const scrollRef = useRef<ScrollView>(null);
  const avatarCollapse = useProfileAvatarCollapse(scrollRef);
  useScrollToTop(avatarCollapse.scrollToTopRef);
  useFocusEffect(avatarCollapse.settleAtRest);
  const { me, loading, error, offline, staleSince, refetch } = useMeContext();
  const { mode, setMode } = useApiMode();
  const { intolerances, reload: loadSupportingData } = useFoodIntolerances(Boolean(me));
  const isSponsorRep = Boolean(me?.isSponsorRep);
  const mealPlanKey = me ? mealPlanCacheKey(me.id) : "meal-plan:none";
  const mealPlan = useCachedApi<MealPlan>(mealPlanKey, fetchMealPlan, { enabled: isSponsorRep });
  // Local answers until Save; a toggle alone never submits the plan.
  const [mealAnswers, setMealAnswers] = useState<Record<number, boolean>>({});
  const [savingMeals, setSavingMeals] = useState(false);
  const [mealPlanError, setMealPlanError] = useState<Error | null>(null);
  const loadMealPlan = mealPlan.load;

  // Load on every focus, so a plan answered from the next-entry sheet shows here.
  useFocusEffect(
    useCallback(() => {
      if (isSponsorRep) void loadMealPlan();
    }, [isSponsorRep, loadMealPlan]),
  );
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [languageError, setLanguageError] = useState<Error | null>(null);
  const [languageRetry, setLanguageRetry] = useState<Lang | null>(null);
  // The iOS MenuView hosts its trigger at intrinsic size, so the row needs an
  // explicit width to span the section and keep its value right-aligned.
  const [languageRowWidth, setLanguageRowWidth] = useState<number>();
  const [refreshingAccount, setRefreshingAccount] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<Error | null>(null);
  const developerTapCount = useRef(0);
  const developerTapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlight = useNotificationsHighlight(scrollRef, avatarCollapse.restingOffset);

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

  // #933: Save submits the whole plan as shown (PUT replace semantics), the
  // same explicit-submit model as the web checklist.
  async function saveMeals() {
    const plan = mealPlan.data;
    if (!plan || offline || savingMeals) return;
    setSavingMeals(true);
    setMealPlanError(null);
    try {
      mealPlan.setData(await saveMealPlan(plan, mealAnswers));
      setMealAnswers({});
      void refetch();
    } catch (cause) {
      setMealPlanError(cause instanceof Error ? cause : new Error(t("mealPlanSaveError")));
      // A meal may have locked since the list loaded; show the server's state.
      void mealPlan.load();
    } finally {
      setSavingMeals(false);
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
  const canEditDietary = !offline && !me.profileLocked;
  const dietaryLabels = me.foodIntolerances
    .map((id) => intolerances.find((item) => item.id === id)?.label[language] ?? String(id))
    .join(", ");
  // An open meal without an answer still needs a submit, even with nothing ticked.
  const mealsUnsaved = Boolean(
    mealPlan.data?.meals.some(
      (meal) =>
        !meal.locked &&
        (meal.attending === null ||
          (mealAnswers[meal.activityId] ?? meal.attending) !== meal.attending),
    ),
  );
  const dietaryValue =
    dietaryLabels || (me.dietaryConfirmedAt ? t("noRestrictions") : t("accountNoneDeclared"));

  return (
    <View ref={avatarCollapse.hostRef} onLayout={avatarCollapse.onHostLayout} style={{ flex: 1 }}>
      <Animated.ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        testID="account-scroll"
        onLayout={highlight.onScrollLayout}
        onScroll={avatarCollapse.onScroll}
        onTouchStart={avatarCollapse.onScrollBeginDrag}
        onContentSizeChange={avatarCollapse.onContentSizeChange}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="automatic"
        // iOS clamps programmatic scrolls to the raw inset (0), not the
        // automatic one, so the avatar's true top would land mid-morph (#935).
        scrollToOverflowEnabled
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
        {languageError ? (
          <RequestFeedback
            error={languageError}
            message={t("accountLanguageError")}
            onRetry={languageRetry ? () => void changeLanguage(languageRetry) : undefined}
            retrying={savingLanguage}
          />
        ) : null}

        <View style={{ alignItems: "center", gap: 12, paddingVertical: 10 }}>
          <ProfileAvatarCollapseAnchor controller={avatarCollapse} size={96}>
            <UserAvatar testID="account-avatar" name={fullName} image={me.image} size={96} />
          </ProfileAvatarCollapseAnchor>
          <View onLayout={avatarCollapse.onNameLayout} style={{ alignItems: "center", gap: 5 }}>
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

        {offline ? (
          <StaleDataBanner updatedAt={staleSince} />
        ) : error ? (
          <RequestFeedback error={error} onRetry={() => void refetch()} />
        ) : null}

        <Section title={t("accountProfile")}>
          <InfoRow label={t("accountName")} value={fullName} icon="person" />
          <Separator inset={48} />
          <View onLayout={({ nativeEvent }) => setLanguageRowWidth(nativeEvent.layout.width)}>
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
                style={{ width: languageRowWidth }}
              >
                <InfoRow
                  label={t("accountLanguage")}
                  value={languageName(me.language)}
                  icon="globe"
                  accessoryIcon="chevron.down"
                />
              </View>
            </MenuView>
          </View>
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

        {/* H28: Wallet lives in Account rather than in the tab bar. */}
        <Section title={t("tabWallet")}>
          <AccountSubpageRow
            label={t("accountViewTickets")}
            icon="wallet.pass"
            onPress={() => router.push("/(tabs)/others/wallet")}
          />
        </Section>

        {/* H51: every notification setting lives here; the Schedule bell only shows the inbox. */}
        <View testID="account-notifications" onLayout={highlight.onRowLayout}>
          <Section title={t("alertsNotifications")}>
            <View>
              <AccountSubpageRow
                label={t("notificationsPreferences")}
                icon="bell"
                onPress={() => router.push("/(tabs)/others/notification-settings")}
              />
              <Animated.View
                pointerEvents="none"
                testID="account-notifications-highlight"
                style={[
                  {
                    backgroundColor: colors.accent,
                    bottom: 0,
                    left: 0,
                    position: "absolute",
                    right: 0,
                    top: 0,
                  },
                  highlight.style,
                ]}
              />
            </View>
          </Section>
        </View>

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
                  value={mealAnswers[meal.activityId] ?? meal.attending ?? false}
                  // Offline the cached plan stays visible but read-only.
                  disabled={offline || meal.locked || savingMeals}
                  onChange={(on) =>
                    setMealAnswers((current) => ({ ...current, [meal.activityId]: on }))
                  }
                />
              </View>
            ))}
            {offline || !mealsUnsaved ? null : (
              <>
                <Separator />
                <ActionButton
                  label={t("save")}
                  busy={savingMeals}
                  onPress={() => void saveMeals()}
                />
              </>
            )}
          </Section>
        ) : null}

        {canViewStaffStatistics(me.capabilities) || canManageStands(me.capabilities) ? (
          <Section title={t("accountStaff")}>
            {canViewStaffStatistics(me.capabilities) ? (
              <AccountSubpageRow
                label={t("accountStatistics")}
                icon="chart.bar.xaxis"
                onPress={() => router.push("/(tabs)/others/statistics")}
              />
            ) : null}
            {canViewStaffStatistics(me.capabilities) && canManageStands(me.capabilities) ? (
              <Separator inset={48} />
            ) : null}
            {canManageStands(me.capabilities) ? (
              <AccountSubpageRow
                label={t("accountStands")}
                icon="wave.3.right"
                onPress={() => router.push("/(tabs)/others/stands")}
              />
            ) : null}
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
      </Animated.ScrollView>
      <AndroidStatusBarScrim />
      <ProfileAvatarCollapse
        controller={avatarCollapse}
        image={me.image}
        name={fullName}
        size={96}
        variant="account"
      />
    </View>
  );
}

/**
 * H51: the alerts gear opens Account with `?highlight=notifications`. The
 * param is consumed once: scroll the Notifications section into view, flash
 * the Preferences row, then clear the param so a re-render or refocus does
 * not replay it.
 */
function useNotificationsHighlight(
  scrollRef: RefObject<ScrollView | null>,
  topOffset: SharedValue<number>,
) {
  const router = useRouter();
  const { highlight, highlightAt } = useLocalSearchParams<{
    highlight?: string;
    highlightAt?: string;
  }>();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(0);
  const [rowY, setRowY] = useState<number | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const handled = useRef(false);
  const lastNonce = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ rowY, viewportHeight, reduceMotion });
  latest.current = { rowY, viewportHeight, reduceMotion };
  const requested = highlight === "notifications";

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  useEffect(() => {
    if (!requested) {
      handled.current = false;
      return;
    }
    // A new nonce (another gear tap) re-arms the handler.
    if (handled.current && lastNonce.current !== highlightAt) handled.current = false;
    lastNonce.current = highlightAt;
    // Wait for both layouts; children can report before the scroll view.
    if (handled.current || rowY === null || viewportHeight === 0) return;
    handled.current = true;
    router.setParams({ highlight: undefined, highlightAt: undefined });
    // Always start from the top, then scroll only once the sheet dismissal and
    // navigation transition have finished, so the user sees the page move.
    // Under the automatic inset the true top is negative; y 0 would start
    // with the avatar already part-way into the island.
    if (timer.current) clearTimeout(timer.current);
    opacity.value = 0;
    scrollRef.current?.scrollTo({ animated: false, y: topOffset.value });
    timer.current = setTimeout(
      () => {
        const { rowY: y, viewportHeight: height, reduceMotion: reduced } = latest.current;
        // Leave the row a third of the way down so the section header shows too.
        scrollRef.current?.scrollTo({
          animated: !reduced,
          y: Math.max(0, (y ?? 0) - height / 3),
        });
        // Flash after the scroll animation has settled.
        opacity.value = reduced
          ? withSequence(
              withTiming(0.18, { duration: 0 }),
              withDelay(1000, withTiming(0, { duration: 0 })),
            )
          : withSequence(
              withDelay(SCROLL_SETTLE_MS, withTiming(0.18, { duration: 200 })),
              withDelay(400, withTiming(0, { duration: 450 })),
            );
      },
      reduceMotion ? 0 : TRANSITION_SETTLE_MS,
    );
  }, [
    opacity,
    reduceMotion,
    requested,
    highlightAt,
    router,
    rowY,
    scrollRef,
    topOffset,
    viewportHeight,
  ]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return {
    style,
    onRowLayout: ({ nativeEvent }: LayoutChangeEvent) => setRowY(nativeEvent.layout.y),
    onScrollLayout: ({ nativeEvent }: LayoutChangeEvent) =>
      setViewportHeight(nativeEvent.layout.height),
  };
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
