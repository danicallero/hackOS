import { Image } from "expo-image";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Text,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityLinkSection } from "@/components/activity-link-rows";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { AvatarRow } from "@/components/avatar-row";
import { GlassView } from "@/components/glass-view";
import {
  AndroidStatusBarScrim,
  EmptyState,
  LegacyHeaderIconButton,
  Section,
  Separator,
} from "@/components/native-ui";
import { loadingImageStyle, useApiImage } from "@/components/person-avatar";
import { PressableFeedback } from "@/components/pressable-feedback";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { useColorScheme } from "@/components/useColorScheme";
import { ApiError } from "@/lib/api";
import { type CompanyProfile, fetchCompanyProfile, heroGradient } from "@/lib/company";
import { useLocale } from "@/lib/i18n";
import { safeBack } from "@/lib/navigation";
import { resolveScheduleText } from "@/lib/schedule";
import { colors, radius, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

const LOGO = 132;
const TITLE_AT = 150;
const DESCRIPTION_LINES = 4;

type State =
  | { status: "loading" }
  | { status: "ready"; profile: CompanyProfile }
  | { status: "missing" }
  | { status: "error"; error: Error };

function Logo({ profile, dark }: { profile: CompanyProfile; dark: boolean }) {
  // The negative artwork is drawn for dark grounds.
  const photo = useApiImage(
    dark && profile.logoNegativeUrl ? profile.logoNegativeUrl : profile.logoUrl,
  );
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor:
          dark && profile.logoNegativeUrl ? colors.elevatedSurface : colors.accentText,
        borderCurve: "continuous",
        borderRadius: radius.sheet,
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.25)",
        height: LOGO,
        justifyContent: "center",
        overflow: "hidden",
        width: LOGO,
      }}
    >
      {photo.loaded ? null : (
        <SymbolView
          name="building.2"
          size={52}
          tintColor={colors.tertiaryLabel}
          accessible={false}
        />
      )}
      {photo.props ? (
        <Image
          {...photo.props}
          accessible={false}
          contentFit="contain"
          style={[{ height: LOGO - 36, width: LOGO - 36 }, !photo.loaded && loadingImageStyle]}
        />
      ) : null}
    </View>
  );
}

/**
 * A company (H44): logo over a tinted hero, then description, representatives,
 * challenges (only those already public, H45) and activities (H59). Sections
 * with no content are omitted.
 */
export function CompanyProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const companyId = Number(id);
  const router = useRouter();
  const navigation = useNavigation();
  const { t, language } = useLocale();
  const insets = useSafeAreaInsets();
  const readable = useParticipantLayout("list");
  const dark = useColorScheme() === "dark";
  const [state, setState] = useState<State>({ status: "loading" });
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const [titleShown, setTitleShown] = useState(false);
  const request = useRef(0);
  const usesCustomAndroidHeader = process.env.EXPO_OS === "android";
  // iOS keeps the native back circle; a cold deep link has nothing to pop (H59).
  const [floatingBack] = useState(() => usesCustomAndroidHeader || !router.canGoBack());

  const load = useCallback(async () => {
    const current = ++request.current;
    if (!Number.isSafeInteger(companyId) || companyId <= 0) {
      setState({ status: "missing" });
      return;
    }
    try {
      const profile = await fetchCompanyProfile(companyId);
      if (current === request.current) setState({ status: "ready", profile });
    } catch (cause) {
      if (current !== request.current) return;
      if (cause instanceof ApiError && (cause.status === 404 || cause.status === 403)) {
        setState({ status: "missing" });
      } else {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        setState((existing) =>
          existing.status === "ready" ? existing : { status: "error", error },
        );
      }
    }
  }, [companyId]);

  useEffect(() => {
    setState({ status: "loading" });
    void load();
  }, [load]);

  const profile = state.status === "ready" ? state.profile : null;
  const name = profile?.name ?? "";
  useEffect(() => {
    if (process.env.EXPO_OS !== "ios") return;
    navigation.setOptions({ title: titleShown ? name : "", headerTitle: titleShown ? name : "" });
  }, [navigation, name, titleShown]);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const shown = event.nativeEvent.contentOffset.y > TITLE_AT;
    setTitleShown((current) => (current === shown ? current : shown));
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  const site = profile?.website;
  const descriptionStyle = {
    color: colors.label,
    fontSize: type.callout.fontSize,
    lineHeight: 23,
  } as const;
  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      {floatingBack ? (
        <View style={{ left: 16, position: "absolute", top: insets.top + 8, zIndex: 10 }}>
          <GlassView
            colorScheme="auto"
            glassEffectStyle="regular"
            isInteractive
            style={{ borderRadius: radius.full, height: 44, width: 44 }}
          >
            <LegacyHeaderIconButton
              accessibilityLabel={t("back")}
              icon="chevron.left"
              onPress={() => safeBack(router, "/")}
            />
          </GlassView>
        </View>
      ) : null}
      {process.env.EXPO_OS === "ios" ? (
        <Stack.Screen options={{ headerBackVisible: !floatingBack }} />
      ) : null}
      <Animated.ScrollView
        testID="company-profile"
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
        refreshControl={
          <AppRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
        contentContainerStyle={{
          flexGrow: 1,
          gap: 24,
          paddingBottom: Math.max(40, insets.bottom + 24),
          paddingTop: insets.top + 56,
        }}
      >
        {profile ? (
          <View
            pointerEvents="none"
            style={{
              experimental_backgroundImage: heroGradient(profile.name, dark),
              height: 620,
              left: 0,
              position: "absolute",
              right: 0,
              top: -300,
            }}
          />
        ) : null}
        {state.status === "loading" ? (
          <RequestFeedback loading />
        ) : state.status === "error" ? (
          <RequestFeedback error={state.error} onRetry={() => void load()} />
        ) : state.status === "missing" || !profile ? (
          <EmptyState icon="building.2" title={t("companyNotFound")} />
        ) : (
          <>
            <View style={{ alignItems: "center", gap: 18, paddingHorizontal: 24 }}>
              <Logo profile={profile} dark={dark} />
              <Text
                accessibilityRole="header"
                selectable
                style={{
                  color: colors.label,
                  fontSize: type.title.fontSize,
                  fontWeight: "700",
                  textAlign: "center",
                }}
              >
                {profile.name}
              </Text>
            </View>

            <View style={{ gap: 24, ...readable.content }}>
              {profile.description ? (
                <View style={{ gap: 6 }}>
                  <Text
                    selectable
                    numberOfLines={expanded ? undefined : DESCRIPTION_LINES}
                    style={descriptionStyle}
                  >
                    {profile.description}
                  </Text>
                  {/* iOS reports only the clamped lines, so measure an unclamped copy. */}
                  <Text
                    accessible={false}
                    importantForAccessibility="no-hide-descendants"
                    pointerEvents="none"
                    onTextLayout={(event) =>
                      setClamped(event.nativeEvent.lines.length > DESCRIPTION_LINES)
                    }
                    style={[
                      descriptionStyle,
                      { opacity: 0, position: "absolute", left: 0, right: 0 },
                    ]}
                  >
                    {profile.description}
                  </Text>
                  {clamped && !expanded ? (
                    <PressableFeedback
                      feedback="opacity"
                      accessibilityRole="button"
                      onPress={() => setExpanded(true)}
                      style={{ alignSelf: "flex-end" }}
                    >
                      <Text
                        style={{
                          color: colors.accent,
                          fontSize: type.callout.fontSize,
                          fontWeight: "600",
                        }}
                      >
                        {t("companyMore")}
                      </Text>
                    </PressableFeedback>
                  ) : null}
                </View>
              ) : null}

              {site ? (
                <PressableFeedback
                  feedback="opacity"
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(site)}
                  style={{ alignSelf: "flex-start", flexDirection: "row", gap: 6 }}
                >
                  <SymbolView name="globe" size={16} tintColor={colors.accent} accessible={false} />
                  <Text style={{ color: colors.accent, fontSize: type.callout.fontSize }}>
                    {site.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </Text>
                </PressableFeedback>
              ) : null}
            </View>

            {profile.representatives.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Text
                  accessibilityRole="header"
                  style={{
                    color: colors.secondaryLabel,
                    fontSize: type.footnote.fontSize,
                    fontWeight: "600",
                    paddingHorizontal: 32,
                  }}
                >
                  {t("companyRepresentatives")}
                </Text>
                <AvatarRow
                  items={profile.representatives.map((person) => ({
                    key: String(person.userId),
                    name: person.name,
                    uri: person.avatarUrl,
                    onPress: () => router.push(`/people/${person.userId}`),
                  }))}
                />
              </View>
            ) : null}

            <View style={{ gap: 24, ...readable.content }}>
              {profile.challenges.length > 0 ? (
                <Section title={t("companyChallenges")}>
                  {profile.challenges.map((challenge, index) => (
                    <View key={challenge.id}>
                      {index > 0 ? <Separator /> : null}
                      <PressableFeedback
                        feedback="row"
                        accessibilityRole="button"
                        onPress={() =>
                          router.push({
                            pathname: "/projects/challenge",
                            params: { challengeId: String(challenge.id) },
                          })
                        }
                        style={{
                          alignItems: "center",
                          flexDirection: "row",
                          gap: 12,
                          minHeight: 56,
                          paddingHorizontal: 16,
                          paddingVertical: 10,
                        }}
                      >
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text
                            numberOfLines={2}
                            style={{
                              color: colors.label,
                              fontSize: type.body.fontSize,
                              fontWeight: "600",
                            }}
                          >
                            {challenge.title}
                          </Text>
                          {challenge.summary ? (
                            <Text
                              numberOfLines={2}
                              style={{
                                color: colors.secondaryLabel,
                                fontSize: type.footnote.fontSize,
                              }}
                            >
                              {challenge.summary}
                            </Text>
                          ) : null}
                        </View>
                        <SymbolView
                          name="chevron.right"
                          size={13}
                          tintColor={colors.tertiaryLabel}
                          accessible={false}
                        />
                      </PressableFeedback>
                    </View>
                  ))}
                </Section>
              ) : null}

              <ActivityLinkSection
                title={t("companyActivities")}
                items={profile.activities.map((item) => ({
                  id: item.id,
                  title: resolveScheduleText(item, language).title,
                  startsAt: item.startsAt,
                  location: item.location,
                }))}
              />
            </View>
          </>
        )}
      </Animated.ScrollView>
      <AndroidStatusBarScrim />
    </View>
  );
}
