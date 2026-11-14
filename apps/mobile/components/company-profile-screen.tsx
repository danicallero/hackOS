import { Image } from "expo-image";
import { Link, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Text,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityLinkSection } from "@/components/activity-link-rows";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { AvatarRow } from "@/components/avatar-row";
import { Desaturate } from "@/components/company-album";
import { DiaryNoteEditor } from "@/components/diary-note-editor";
import { FavouriteStar } from "@/components/favourite-star";
import { FloatingBackButton } from "@/components/floating-back-button";
import { AndroidStatusBarScrim, EmptyState, Section, Separator } from "@/components/native-ui";
import { loadingImageStyle, useApiImage } from "@/components/person-avatar";
import { PressableFeedback } from "@/components/pressable-feedback";
import { NoteRow, QuickAction } from "@/components/profile-parts";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { useColorScheme } from "@/components/useColorScheme";
import { alert } from "@/lib/alert";
import { ApiError, apiFetch } from "@/lib/api";
import { type CompanyProfile, fetchCompanyProfile } from "@/lib/company";
import type { SponsorCollection, SponsorCollectionEntry } from "@/lib/diary-sponsors";
import { haptic } from "@/lib/haptics";
import { heroTint } from "@/lib/hero-tint";
import { useLocale } from "@/lib/i18n";
import { useImageTint } from "@/lib/image-tint";
import { safeBack } from "@/lib/navigation";
import { resolveScheduleText } from "@/lib/schedule";
import { colors, radius, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

const LOGO = 168;
const TITLE_AT = 150;
const DESCRIPTION_LINES = 4;

type State =
  | { status: "loading" }
  | { status: "ready"; profile: CompanyProfile }
  | { status: "missing" }
  | { status: "error"; error: Error };

/** The company's logo on its own tile (also the stand-scan celebration's centrepiece). */
export function Logo({
  profile,
  dark,
  muted,
  size = LOGO,
}: {
  profile: Pick<CompanyProfile, "logoUrl" | "logoNegativeUrl">;
  dark: boolean;
  muted: boolean;
  size?: number;
}) {
  // The negative artwork is drawn for dark grounds.
  const photo = useApiImage(
    dark && profile.logoNegativeUrl ? profile.logoNegativeUrl : profile.logoUrl,
  );
  const ground = dark && profile.logoNegativeUrl ? colors.elevatedSurface : colors.accentText;
  return (
    <View
      style={{
        backgroundColor: ground,
        borderCurve: "continuous",
        borderRadius: radius.sheet,
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.25)",
        height: size,
        overflow: "hidden",
        width: size,
      }}
    >
      {/* Its own blend group with the card's ground, so Desaturate drains the logo, not the page. */}
      <View
        style={{
          alignItems: "center",
          backgroundColor: ground,
          flex: 1,
          isolation: "isolate",
          justifyContent: "center",
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
            style={[
              { height: size - 28, opacity: muted ? 0.5 : 1, width: size - 28 },
              !photo.loaded && loadingImageStyle,
            ]}
          />
        ) : null}
        {muted ? <Desaturate /> : null}
      </View>
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
  // Scroll distance at which the large name has gone under the bar; the bar's blur and title wait for it.
  const [titleAt, setTitleAt] = useState(TITLE_AT);
  const request = useRef(0);
  // iOS keeps the native back circle; a cold deep link has nothing to pop (H59).
  // The zoom transition's cancelled swipe-to-dismiss leaves the native back
  // button hidden, so these screens always draw their own glass circle.
  const floatingBack = true;

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

  // The reader's own diary entry for this company (#935), when they scanned its stand: favourite,
  // private note and removal live here now that the Contacts album opens this page.
  const [entry, setEntry] = useState<SponsorCollectionEntry | null>(null);
  // A company in the reader's album with no scan yet: shown greyed out, with no diary controls.
  const [uncollected, setUncollected] = useState(false);
  const [entryBusy, setEntryBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  useEffect(() => {
    let live = true;
    apiFetch<SponsorCollection>("/api/me/diary/sponsors")
      .then((collection) => {
        if (!live) return;
        const item = collection.items.find((candidate) => candidate.enterpriseId === companyId);
        setEntry(item?.entry ?? null);
        setUncollected(item !== undefined && item.entry === null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [companyId]);

  async function changeEntry(action: () => Promise<void>) {
    if (entryBusy) return;
    setEntryBusy(true);
    try {
      await action();
    } catch {
      void haptic("error");
      alert(t("tabDiary"), t("diaryActionError"));
    } finally {
      setEntryBusy(false);
    }
  }

  function patchEntry(patch: { starred?: boolean; note?: string }) {
    if (!entry) return;
    void changeEntry(async () => {
      const next = await apiFetch<SponsorCollectionEntry>(`/api/me/diary/${entry.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      setEntry({ ...entry, starred: next.starred, note: next.note });
      void haptic("selection");
    });
  }

  function removeEntry() {
    if (!entry) return;
    alert(t("diaryRemoveTitle"), undefined, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("remove"),
        style: "destructive",
        onPress: () =>
          void changeEntry(async () => {
            await apiFetch(`/api/me/diary/${entry.id}`, { method: "DELETE" });
            setEntry(null);
          }),
      },
    ]);
  }

  useEffect(() => {
    setState({ status: "loading" });
    void load();
  }, [load]);

  const profile = state.status === "ready" ? state.profile : null;
  const name = profile?.name ?? "";
  useEffect(() => {
    if (process.env.EXPO_OS !== "ios") return;
    navigation.setOptions({
      title: titleShown ? name : "",
      headerTitle: titleShown ? name : "",
      scrollEdgeEffects: { top: titleShown ? "soft" : "hidden" },
    });
  }, [navigation, name, titleShown]);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const shown = event.nativeEvent.contentOffset.y > titleAt;
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

  // An uncollected company keeps the neutral grey hero instead of its logo colour.
  // The colour is computed on the device (prefetched from the lists); until it
  // is ready the neutral hero shows, then the tint fades in over it.
  const logoTint = useImageTint(uncollected ? null : profile?.logoUrl);
  const hero = heroTint(logoTint.color, dark);
  const neutralHero = heroTint(null, dark);
  const site = profile?.website;
  const descriptionStyle = {
    color: colors.label,
    fontSize: type.callout.fontSize,
    lineHeight: 23,
  } as const;
  return (
    <View style={{ backgroundColor: colors.background, flex: 1 }}>
      {floatingBack ? <FloatingBackButton onPress={() => safeBack(router, "/")} /> : null}
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
          <>
            <View
              pointerEvents="none"
              style={{
                experimental_backgroundImage: neutralHero.gradient,
                height: 620,
                left: 0,
                position: "absolute",
                right: 0,
                top: -300,
              }}
            />
            {logoTint.color ? (
              <Animated.View
                entering={logoTint.fromCache ? undefined : FadeIn.duration(400)}
                testID="company-hero"
                pointerEvents="none"
                style={{
                  experimental_backgroundImage: hero.gradient,
                  height: 620,
                  left: 0,
                  position: "absolute",
                  right: 0,
                  top: -300,
                }}
              />
            ) : null}
          </>
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
              <Link.AppleZoomTarget>
                <Logo profile={profile} dark={dark} muted={uncollected} />
              </Link.AppleZoomTarget>
              <Text
                onLayout={({ nativeEvent: { layout } }) =>
                  // Content sits 56 pt below the top inset, the bar 44 pt: the name is under the bar
                  // once its bottom edge (after the logo and gap) is 12 pt up.
                  setTitleAt(layout.y + layout.height + 12)
                }
                accessibilityRole="header"
                selectable
                style={{
                  color: hero.foreground,
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

            {uncollected ? (
              <Text
                style={{
                  color: colors.secondaryLabel,
                  fontSize: type.subhead.fontSize,
                  textAlign: "center",
                }}
              >
                {t("diaryCompanyVisitBooth")}
              </Text>
            ) : null}

            {entry ? (
              <View style={{ gap: 24, ...readable.content }}>
                <Text
                  style={{
                    color: colors.secondaryLabel,
                    fontSize: type.subhead.fontSize,
                    textAlign: "center",
                  }}
                >
                  {t("diaryCompanyCollectedOn", {
                    date: new Date(entry.createdAt).toLocaleDateString(language, {
                      day: "numeric",
                      month: "long",
                    }),
                  })}
                </Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <QuickAction
                    icon={entry.starred ? "star.fill" : "star"}
                    iconTint={entry.starred ? colors.warning : colors.accent}
                    label={t(entry.starred ? "diaryUnfavourite" : "diaryFavourite")}
                    title={t("diaryFavourite")}
                    selected={entry.starred}
                    busy={entryBusy}
                    onPress={() => patchEntry({ starred: !entry.starred })}
                    iconNode={<FavouriteStar on={entry.starred} size={22} />}
                  />
                  <QuickAction
                    icon="note.text"
                    label={t(entry.note ? "diaryEditNote" : "diaryNote")}
                    title={t(entry.note ? "diaryEditNote" : "diaryNote")}
                    busy={false}
                    onPress={() => setNoteOpen(true)}
                  />
                </View>
                {entry.note ? (
                  <Section title={t("diaryNote")}>
                    <NoteRow
                      note={entry.note}
                      hint={t("diaryEditNote")}
                      onPress={() => setNoteOpen(true)}
                    />
                  </Section>
                ) : null}
              </View>
            ) : null}

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
                    firstName: person.firstName,
                    surname: person.surname,
                    uri: person.avatarUrl,
                    href: `/people/${person.userId}`,
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

              {entry ? (
                <Section>
                  <PressableFeedback
                    feedback="row"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: entryBusy }}
                    disabled={entryBusy}
                    onPress={removeEntry}
                    style={{
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: 50,
                      paddingHorizontal: 16,
                    }}
                  >
                    <Text style={{ color: colors.destructive, fontSize: type.callout.fontSize }}>
                      {t("diaryCompanyRemove")}
                    </Text>
                  </PressableFeedback>
                </Section>
              ) : null}
            </View>
          </>
        )}
      </Animated.ScrollView>
      <DiaryNoteEditor
        visible={noteOpen}
        initialNote={entry?.note ?? null}
        onClose={() => setNoteOpen(false)}
        onSave={(note) => {
          setNoteOpen(false);
          patchEntry({ note });
        }}
      />
      <AndroidStatusBarScrim />
    </View>
  );
}
