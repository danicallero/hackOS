import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, useColorScheme, View } from "react-native";

import { ActionButton, InfoRow, Section, Separator, StatusPill } from "@/components/native-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { apiFetch } from "@/lib/api";
import { signOut } from "@/lib/auth-client";
import { type Lang, useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { fetchMyScanStats, type MyScanStats } from "@/lib/scan-log";
import { isOperator } from "@/lib/tabs";
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
  const { me, loading, error, refetch } = useMeContext();
  const [intolerances, setIntolerances] = useState<Intolerance[]>([]);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<Error | null>(null);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [myStats, setMyStats] = useState<MyScanStats | null>(null);

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

  const operator = isOperator(me?.capabilities ?? []);

  useEffect(() => {
    if (!operator) return;
    fetchMyScanStats()
      .then(setMyStats)
      .catch(() => {
        /* Stats are a nice-to-have on this screen; keep the rest usable without them. */
      });
  }, [operator]);

  async function changeLanguage(nextLanguage: Lang) {
    if (nextLanguage === me?.language || savingLanguage) return;
    setSavingLanguage(true);
    try {
      await apiFetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: nextLanguage }),
      });
      await refetch();
    } finally {
      setSavingLanguage(false);
    }
  }

  async function endSession() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const { error: authError } = await signOut();
      if (authError) throw new Error(authError.message || "Sign out failed");
    } catch (cause) {
      setSignOutError(cause instanceof Error ? cause : new Error("Sign out failed"));
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
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ gap: 20, padding: 16, paddingBottom: 36 }}
    >
      {error ? <RequestFeedback error={error} onRetry={() => void refetch()} /> : null}
      {signOutError ? <RequestFeedback error={signOutError} /> : null}

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
            {me.role}
          </Text>
          <StatusPill tone={me.badgeId ? "success" : "neutral"} style={{ alignSelf: "center" }}>
            {me.badgeId ? t("accountAccredited") : t("accountNotAccredited")}
          </StatusPill>
        </View>
      </View>

      <Section title={t("accountProfile")}>
        <InfoRow label={t("accountName")} value={fullName} icon="person" />
        <Separator inset={48} />
        <InfoRow label={t("accountPhone")} value={me.phone || t("accountNotSet")} icon="phone" />
        <Separator inset={48} />
        <MenuView
          actions={LANGUAGES.map(
            (lang): MenuAction => ({
              id: lang,
              title: languageName(lang),
              state: lang === me.language ? "on" : "off",
            }),
          )}
          onPressAction={({ nativeEvent }) => void changeLanguage(nativeEvent.event as Lang)}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: savingLanguage, busy: savingLanguage }}
            disabled={savingLanguage}
          >
            <InfoRow
              label={t("accountLanguage")}
              value={languageName(me.language)}
              icon="globe"
              accessoryIcon="chevron.down"
            />
          </Pressable>
        </MenuView>
        <Separator inset={48} />
        <InfoRow
          label={t("accountShirtSize")}
          value={me.shirtSize || t("accountNotSet")}
          icon="tshirt"
        />
      </Section>

      <Section title={t("accountContact")}>
        <InfoRow
          label={t("accountEmail")}
          value={me.emailVerified ? t("accountVerified") : t("accountNotVerified")}
          icon="envelope"
          valueStyle={{ color: me.emailVerified ? colors.success : colors.warning }}
        />
        <Text
          selectable
          style={{
            color: colors.secondaryLabel,
            fontSize: 13,
            paddingBottom: 12,
            paddingHorizontal: 48,
          }}
        >
          {me.email}
        </Text>
        {me.secondaryEmail ? (
          <>
            <Separator inset={48} />
            <InfoRow
              label={t("accountSecondaryEmail")}
              value={me.secondaryEmailVerified ? t("accountVerified") : t("accountNotVerified")}
              icon="envelope.badge"
              valueStyle={{ color: me.secondaryEmailVerified ? colors.success : colors.warning }}
            />
            <Text
              selectable
              style={{
                color: colors.secondaryLabel,
                fontSize: 13,
                paddingBottom: 12,
                paddingHorizontal: 48,
              }}
            >
              {me.secondaryEmail}
            </Text>
          </>
        ) : null}
      </Section>

      <Section title={t("accountEventDetails")}>
        <InfoRow
          label={t("accountBadge")}
          value={me.badgeId ?? t("accountNoBadge")}
          icon="key.card"
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
              <Text selectable style={{ color: colors.label, fontSize: 16, lineHeight: 22 }}>
                {me.foodIntoleranceNotes}
              </Text>
            </View>
          </>
        ) : null}
      </Section>

      {operator ? (
        <Section title={t("myStatsTitle")}>
          <InfoRow
            label={t("myStatsAccreditation")}
            value={myStats ? String(myStats.accreditationCount) : "—"}
            icon="person.badge.key.fill"
          />
          <Separator inset={48} />
          <InfoRow
            label={t("myStatsPresence")}
            value={myStats ? String(myStats.presenceCount) : "—"}
            icon="door.left.hand.open"
          />
          <Separator inset={48} />
          <InfoRow
            label={t("myStatsActivity")}
            value={myStats ? String(myStats.activityCount) : "—"}
            icon="list.bullet.rectangle"
          />
          <Separator inset={48} />
          <ActionButton
            label={t("scannerSeeHistory")}
            icon="clock.arrow.circlepath"
            onPress={() => router.push("/(tabs)/others/scan-log")}
          />
        </Section>
      ) : null}

      <Section title={t("sessionTitle")} footer={t("sessionActive", { email: me.email })}>
        <ActionButton
          label={t("refreshAccount")}
          icon="arrow.clockwise"
          busy={loading}
          onPress={() => void refetch()}
        />
        <Separator />
        <ActionButton
          label={t("signOut")}
          icon="rectangle.portrait.and.arrow.right"
          destructive
          busy={signingOut}
          onPress={confirmSignOut}
        />
      </Section>
    </ScrollView>
  );
}

function languageName(language: string) {
  return (
    ({ en: "English", es: "Español", gl: "Galego" } as Record<string, string>)[language] ?? language
  );
}
