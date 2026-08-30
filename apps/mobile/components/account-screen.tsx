import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import { useRouter, useScrollToTop } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
} from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { apiFetch } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { type Lang, useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { useRouterTabBarScrollBottomInset } from "@/lib/router-tabs-inset";
import { wipeAttendanceRoster } from "@/lib/scanner-db";
import { canViewStaffStatistics } from "@/lib/tabs";
import { useAndroidTopInset } from "@/lib/use-android-top-inset";
import { colors } from "@/theme/colors";

interface Intolerance {
  id: number;
  label: { en: string; es: string; gl: string };
}

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
  const { me, loading, error, refetch } = useMeContext();
  const [intolerances, setIntolerances] = useState<Intolerance[]>([]);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [languageError, setLanguageError] = useState<Error | null>(null);
  const [languageRetry, setLanguageRetry] = useState<Lang | null>(null);
  const [refreshingAccount, setRefreshingAccount] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<Error | null>(null);

  const loadSupportingData = useCallback(async () => {
    if (!me) return;
    try {
      const { intolerances: list } = await apiFetch<{ intolerances: Intolerance[] }>(
        "/api/public/food-intolerances",
      );
      setIntolerances(list);
    } catch {
      /* The rest of the profile remains usable without intolerance labels. */
    }
  }, [me]);

  useEffect(() => {
    void loadSupportingData();
  }, [loadSupportingData]);

  async function refreshAccount() {
    if (refreshingAccount) return;
    setRefreshingAccount(true);
    try {
      await Promise.all([refetch(), loadSupportingData()]);
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

  async function endSession() {
    if (!me || signingOut) return;
    const ownerUserId = me.id;
    setSigningOut(true);
    setSignOutError(null);
    try {
      const { error: authError } = await signOut();
      if (authError) throw new Error(authError.message || t("signOutError"));
      // The roster is shared event data, while the offline scan queue is
      // user-owned and intentionally remains available after a re-login.
      await wipeAttendanceRoster(ownerUserId);
    } catch (cause) {
      setSignOutError(cause instanceof Error ? cause : new Error(t("signOutError")));
      setSigningOut(false);
    }
  }

  function confirmSignOut() {
    Alert.alert(t("signOutConfirmTitle"), t("signOutConfirmBody"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("signOut"), style: "destructive", onPress: () => void endSession() },
    ]);
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
  const dietaryLabels = me.foodIntolerances
    .map((id) => intolerances.find((item) => item.id === id)?.label[language] ?? String(id))
    .join(", ");

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
        {error ? <RequestFeedback error={error} onRetry={() => void refetch()} /> : null}
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
              {roleLabel(me.role, t)}
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
          <InfoRow
            label={t("accountFoodIntolerances")}
            value={dietaryLabels || t("accountNoneDeclared")}
            icon="fork.knife"
          />
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
          <RequestFeedback
            error={signOutError}
            message={t("signOutError")}
            onRetry={() => void endSession()}
            retrying={signingOut}
          />
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

function roleLabel(
  role: NonNullable<ReturnType<typeof useMeContext>["me"]>["role"],
  t: ReturnType<typeof useLocale>["t"],
) {
  return (
    {
      admin: t("roleAdmin"),
      judge: t("roleJudge"),
      sponsor: t("roleSponsor"),
      staff: t("roleStaff"),
      mentor: t("roleMentor"),
      participant: t("roleParticipant"),
      unassigned: t("roleUnassigned"),
    } as const
  )[role];
}
