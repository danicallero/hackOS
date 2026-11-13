import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { HeaderHeightContext } from "expo-router/react-navigation";
import Stack from "expo-router/stack";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, Text, View } from "react-native";
import Animated, { FadeIn, runOnJS, useAnimatedReaction } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActivityLinkSection } from "@/components/activity-link-rows";
import { AppRefreshControl } from "@/components/app-refresh-control";
import { CvViewer } from "@/components/cv-viewer";
import { DiaryNoteEditor } from "@/components/diary-note-editor";
import { FavouriteStar } from "@/components/favourite-star";
import { GlassView } from "@/components/glass-view";
import { HelperCompany, HelperPresence } from "@/components/help-desk/rows";
import {
  AndroidStatusBarScrim,
  EmptyState,
  InfoRow,
  LegacyHeaderIconButton,
  Section,
  Separator,
  StatusPill,
} from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { PressableFeedback } from "@/components/pressable-feedback";
import {
  ProfileAvatarCollapse,
  ProfileAvatarCollapseAnchor,
  useProfileAvatarCollapse,
} from "@/components/profile-avatar-collapse";
import { ProfileCard } from "@/components/profile-card";
import { NoteRow, QuickAction } from "@/components/profile-parts";
import { RequestFeedback } from "@/components/RequestFeedback";
import { SymbolView } from "@/components/symbol";
import { useColorScheme } from "@/components/useColorScheme";
import { alert } from "@/lib/alert";
import { ApiError, apiFetch } from "@/lib/api";
import type { DiaryEntry } from "@/lib/diary";
import type { DirectoryEntry } from "@/lib/directory";
import { haptic } from "@/lib/haptics";
import { availabilityDays, type HelperDetail } from "@/lib/help-desk";
import { heroTint } from "@/lib/hero-tint";
import { useLocale } from "@/lib/i18n";
import { useImageTint } from "@/lib/image-tint";
import { safeBack } from "@/lib/navigation";
import { reportContent } from "@/lib/reports";
import { isPadIdiom } from "@/lib/tabs";
import { colors, radius, type } from "@/theme";
import { useParticipantLayout } from "@/theme/layout-participant";

const notFound = () => new ApiError("Person not found", 404, "not_found");
const profileUserId = (value: DirectoryEntry | HelperDetail<DirectoryEntry>) =>
  "profile" in value ? value.profile.userId : value.userId;

type State =
  | { status: "loading" }
  | { status: "ready"; person: DirectoryEntry; helper: HelperDetail<DirectoryEntry> | null }
  | { status: "missing" }
  | { status: "error"; error: Error };

/**
 * A saved person's profile (#934, #935), opened from a diary row. People get
 * into the diary only by a badge scan, so there is no Save here. The API
 * answers 404 for a hidden profile and for a person the reader may not open,
 * so both show the same unavailable state. The diary entry carries the
 * reader's favourite and note.
 */
export function PersonProfileScreen({
  source = "diary",
}: {
  source?: "diary" | "helpDesk" | "requester";
} = {}) {
  const avatarSize = isPadIdiom() ? 144 : 112;
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const router = useRouter();
  const { t, language } = useLocale();
  const readable = useParticipantLayout("list");
  const dark = useColorScheme() === "dark";
  const insets = useSafeAreaInsets();
  // iOS shows the transparent native header, whose height the automatic
  // inset adds above the avatar's true top (#935).
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const avatarCollapse = useProfileAvatarCollapse(undefined, {
    headerHeight: process.env.EXPO_OS === "ios" ? headerHeight : 0,
  });
  // The bar's blur and title appear only once the large name has scrolled under it.
  const [nameBottom, setNameBottom] = useState<number | null>(null);
  const [titleShown, setTitleShown] = useState(false);
  const { scrollOffset } = avatarCollapse;
  useAnimatedReaction(
    () => nameBottom !== null && scrollOffset.value > nameBottom,
    (shown, previous) => {
      if (shown !== previous) runOnJS(setTitleShown)(shown);
    },
    [nameBottom],
  );
  const [state, setState] = useState<State>({ status: "loading" });
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [entry, setEntry] = useState<DiaryEntry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<"star" | "remove" | "note" | null>(null);
  const [cvOpen, setCvOpen] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const requestId = useRef(0);
  // Opened without a scan (a speaker or representative), there is no CV, star or note.
  const showCv = source !== "diary" || entry !== null;
  const usesCustomAndroidHeader = process.env.EXPO_OS === "android";
  // iOS keeps the native back button, a circle on iOS 26, whenever there is a
  // screen to return to. A custom headerLeft is wrapped in a wide glass pill,
  // so a cold deep link (nothing to pop, H59) floats the same 44pt glass
  // circle Android uses instead.
  const [floatingBack] = useState(() => usesCustomAndroidHeader || !router.canGoBack());

  const load = useCallback(async () => {
    const request = ++requestId.current;
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      setState({ status: "missing" });
      return;
    }
    // H63: a published helper opens the same profile, read through the help
    // desk (publication is the consent), plus their schedule and presence.
    const [person, diary] = await Promise.allSettled([
      source === "helpDesk"
        ? apiFetch<HelperDetail<DirectoryEntry>>(`/api/helpdesk/helpers/${userId}`)
        : source === "requester"
          ? // H64: the route id is the request; the API embeds the requester's public profile.
            apiFetch<{ requesterProfile: DirectoryEntry | null }>(
              `/api/helpdesk/requests/${userId}`,
            ).then((request) => request.requesterProfile ?? Promise.reject(notFound()))
          : apiFetch<DirectoryEntry>(`/api/directory/${userId}`),
      apiFetch<{ items: DiaryEntry[] }>("/api/me/diary"),
    ]);
    if (request !== requestId.current) return;
    if (diary.status === "fulfilled") {
      const personId = person.status === "fulfilled" ? profileUserId(person.value) : userId;
      setEntry(
        diary.value.items.find(
          (item) => item.kind === "person" && item.person?.userId === personId,
        ) ?? null,
      );
    }
    if (person.status === "fulfilled") {
      setLoadError(null);
      const value = person.value;
      setState(
        "profile" in value
          ? { status: "ready", person: value.profile, helper: value }
          : { status: "ready", person: value, helper: null },
      );
    } else if (
      person.reason instanceof ApiError &&
      (person.reason.status === 404 || person.reason.status === 403)
    ) {
      setState({ status: "missing" });
    } else {
      const error =
        person.reason instanceof Error ? person.reason : new Error(String(person.reason));
      setLoadError(error);
      setState((current) => (current.status === "ready" ? current : { status: "error", error }));
    }
  }, [userId, source]);

  useEffect(() => {
    setState({ status: "loading" });
    setEntry(null);
    setLoadError(null);
    void load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function run(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    try {
      await action();
    } catch {
      void haptic("error");
      alert(t("tabDiary"), t("diaryActionError"));
    } finally {
      setBusy(null);
    }
  }

  function patch(body: { starred?: boolean; note?: string }, kind: "star" | "note") {
    if (!entry) return;
    void run(kind, async () => {
      const updated = await apiFetch<DiaryEntry>(`/api/me/diary/${entry.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setEntry(updated);
      void haptic("selection");
    });
  }

  function confirmRemove() {
    if (!entry) return;
    alert(t("diaryRemoveTitle"), undefined, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("remove"),
        style: "destructive",
        onPress: () =>
          void run("remove", async () => {
            await apiFetch(`/api/me/diary/${entry.id}`, {
              method: "DELETE",
            });
            setEntry(null);
            // Only people in the diary have a profile here; saving again
            // takes a new scan, so there is nothing left to show.
            safeBack(router, "/");
          }),
      },
    ]);
  }

  const goBack = () => safeBack(router, "/");
  const person = state.status === "ready" ? state.person : null;
  const helper = state.status === "ready" ? state.helper : null;
  // Tinted from the photo's colour; no photo or colour keeps the plain background.
  const photoTint = useImageTint(person?.photoUrl);
  const hero = photoTint.color ? heroTint(photoTint.color, dark) : null;

  return (
    <View ref={avatarCollapse.hostRef} onLayout={avatarCollapse.onHostLayout} style={{ flex: 1 }}>
      {floatingBack ? (
        <View
          style={{
            left: 16,
            position: "absolute",
            top: insets.top + 8,
            zIndex: 10,
          }}
        >
          <GlassView
            colorScheme="auto"
            glassEffectStyle="regular"
            isInteractive
            style={{ borderRadius: radius.full, height: 44, width: 44 }}
          >
            <LegacyHeaderIconButton
              accessibilityLabel={t("back")}
              icon="chevron.left"
              onPress={goBack}
            />
          </GlassView>
        </View>
      ) : null}
      {process.env.EXPO_OS === "ios" ? (
        <Stack.Screen
          options={{
            title: titleShown && person ? person.displayName : "",
            headerTitle: titleShown && person ? person.displayName : "",
            headerBackVisible: !floatingBack,
            scrollEdgeEffects: { top: titleShown ? "soft" : "hidden" },
          }}
        />
      ) : null}
      {person?.cvUrl && showCv ? (
        <CvViewer
          visible={cvOpen}
          title={person.displayName}
          cvPath={person.cvUrl}
          onClose={() => setCvOpen(false)}
        />
      ) : null}
      <DiaryNoteEditor
        visible={editingNote && entry !== null}
        initialNote={entry?.note ?? null}
        onClose={() => setEditingNote(false)}
        onSave={(note) => {
          setEditingNote(false);
          patch({ note }, "note");
        }}
      />
      <Animated.ScrollView
        ref={avatarCollapse.scrollRef}
        testID="person-profile"
        onScroll={avatarCollapse.onScroll}
        onTouchStart={avatarCollapse.onScrollBeginDrag}
        onContentSizeChange={avatarCollapse.onContentSizeChange}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="automatic"
        // iOS clamps programmatic scrolls to the raw inset (0), not the
        // automatic one, so the avatar's true top would land mid-morph (#935).
        scrollToOverflowEnabled
        style={{ backgroundColor: colors.background, flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          gap: 24,
          // A short profile still scrolls to the collapsed avatar (#935).
          minHeight: person ? avatarCollapse.contentMinHeight : undefined,
          paddingBottom: Math.max(40, insets.bottom + 24),
          ...readable.content,
          paddingTop: usesCustomAndroidHeader ? insets.top + 64 : 8,
        }}
        refreshControl={
          <AppRefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        {hero ? (
          <Animated.View
            entering={photoTint.fromCache ? undefined : FadeIn.duration(400)}
            testID="person-hero"
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
        {loadError && state.status === "ready" ? (
          <RequestFeedback error={loadError} onRetry={() => void load()} retrying={refreshing} />
        ) : null}
        {state.status === "loading" ? (
          <RequestFeedback loading />
        ) : state.status === "error" ? (
          <RequestFeedback error={state.error} onRetry={() => void load()} />
        ) : state.status === "missing" || !person ? (
          <EmptyState icon="person.crop.circle" title={t("directoryPersonNotFound")} />
        ) : (
          <>
            <ProfileCard
              beforeKnowledge={helper ? <HelperCompany helper={helper} /> : undefined}
              data={person}
              nameColor={hero?.foreground}
              onNameLayout={(event: LayoutChangeEvent) => {
                avatarCollapse.onNameLayout(event);
                const { y, height } = event.nativeEvent.layout;
                // Content starts 8 pt below the bar; the name is under it once its bottom edge passes.
                setNameBottom(y + height + 8);
              }}
              avatar={
                <ProfileAvatarCollapseAnchor controller={avatarCollapse} size={avatarSize}>
                  <Link.AppleZoomTarget>
                    <PersonAvatar
                      size={avatarSize}
                      name={person.displayName}
                      uri={person.photoUrl}
                    />
                  </Link.AppleZoomTarget>
                </ProfileAvatarCollapseAnchor>
              }
              actions={
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {entry ? (
                    <QuickAction
                      icon={entry.starred ? "star.fill" : "star"}
                      iconTint={entry.starred ? colors.warning : colors.accent}
                      label={t(entry.starred ? "diaryUnfavourite" : "diaryFavourite")}
                      title={t("diaryFavourite")}
                      selected={entry.starred}
                      iconNode={<FavouriteStar on={entry.starred} size={22} />}
                      busy={busy === "star"}
                      onPress={() => patch({ starred: !entry.starred }, "star")}
                    />
                  ) : null}
                  {entry ? (
                    // With a note, its section below shows it; the tile edits it.
                    <QuickAction
                      icon="note.text"
                      label={t(entry.note ? "diaryEditNote" : "diaryNote")}
                      title={t(entry.note ? "diaryEditNote" : "diaryNote")}
                      busy={busy === "note"}
                      onPress={() => setEditingNote(true)}
                    />
                  ) : null}
                  {person.cvUrl && showCv ? (
                    <QuickAction
                      icon="doc.text"
                      label={t("directoryCv")}
                      title={t("directoryCv")}
                      busy={false}
                      onPress={() => setCvOpen(true)}
                    />
                  ) : null}
                </View>
              }
              afterBio={
                entry?.note ? (
                  <Section title={t("diaryNote")}>
                    <NoteRow
                      note={entry.note}
                      hint={t("diaryEditNote")}
                      onPress={() => setEditingNote(true)}
                    />
                  </Section>
                ) : null
              }
            />

            {(person.enterprises ?? []).length > 0 ? (
              <Section>
                {(person.enterprises ?? []).map((company, index) => (
                  <View key={company.id}>
                    {index > 0 ? <Separator inset={68} /> : null}
                    <Link href={`/companies/${company.id}`} asChild>
                      <PressableFeedback
                        feedback="row"
                        accessibilityRole="button"
                        accessibilityLabel={company.name}
                        style={{
                          alignItems: "center",
                          flexDirection: "row",
                          gap: 12,
                          minHeight: 60,
                          paddingHorizontal: 16,
                          paddingVertical: 8,
                        }}
                      >
                        <Link.AppleZoom>
                          <View>
                            <PersonAvatar
                              size={40}
                              kind="sponsor"
                              name={company.name}
                              uri={company.logoUrl}
                            />
                          </View>
                        </Link.AppleZoom>
                        <Text
                          numberOfLines={1}
                          style={{
                            color: colors.label,
                            flex: 1,
                            fontSize: type.body.fontSize,
                            fontWeight: "600",
                          }}
                        >
                          {company.name}
                        </Text>
                        <SymbolView
                          name="chevron.right"
                          size={13}
                          tintColor={colors.tertiaryLabel}
                          accessible={false}
                        />
                      </PressableFeedback>
                    </Link>
                  </View>
                ))}
              </Section>
            ) : null}

            <ActivityLinkSection title={t("personTalks")} items={person.activities ?? []} />

            {helper ? (
              <Section title={t("helpSchedule")} footer={t("helpScheduleNote")}>
                {helper.challenges.length > 0 ? (
                  <InfoRow
                    label={t("helpChallengeAlerts")}
                    value={helper.challenges.map((challenge) => challenge.name).join(", ")}
                  />
                ) : null}
                <View style={{ padding: 16 }}>
                  <HelperPresence helper={helper} />
                </View>
                {availabilityDays(helper.availability, language).map((day) => (
                  <View key={day.key}>
                    <Separator inset={16} />
                    <InfoRow
                      label={day.label}
                      value={day.ranges.map((range) => range.label).join(", ")}
                    />
                  </View>
                ))}
              </Section>
            ) : null}

            {entry ? (
              <Section>
                <PressableFeedback
                  feedback="row"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy !== null, busy: busy === "remove" }}
                  disabled={busy !== null}
                  onPress={confirmRemove}
                  style={{
                    alignItems: "center",
                    minHeight: 50,
                    justifyContent: "center",
                    paddingHorizontal: 16,
                  }}
                >
                  <Text style={{ color: colors.destructive, fontSize: type.callout.fontSize }}>
                    {t("diaryRemoveFromDiary")}
                  </Text>
                </PressableFeedback>
              </Section>
            ) : null}
            <Section>
              <PressableFeedback
                feedback="row"
                accessibilityRole="button"
                onPress={() => reportContent({ userId: person.userId }, t)}
                style={{
                  alignItems: "center",
                  minHeight: 50,
                  justifyContent: "center",
                  paddingHorizontal: 16,
                }}
              >
                <Text style={{ color: colors.destructive, fontSize: type.callout.fontSize }}>
                  {t("reportContent")}
                </Text>
              </PressableFeedback>
            </Section>
          </>
        )}
      </Animated.ScrollView>
      {/* Keeps scrolled content out from behind the clock; the floating back
          button and the masked avatar stay above it. */}
      <AndroidStatusBarScrim />
      {person ? (
        <ProfileAvatarCollapse
          controller={avatarCollapse}
          image={person.photoUrl}
          name={person.displayName}
          size={avatarSize}
          variant="person"
        />
      ) : null}
      {helper?.visibleRoleName ? (
        process.env.EXPO_OS === "ios" ? (
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.View hidesSharedBackground>
              <StatusPill tone="accent">{helper.visibleRoleName}</StatusPill>
            </Stack.Toolbar.View>
          </Stack.Toolbar>
        ) : (
          <View
            pointerEvents="none"
            style={{ position: "absolute", right: 16, top: insets.top + 8 }}
          >
            <StatusPill tone="accent">{helper.visibleRoleName}</StatusPill>
          </View>
        )
      ) : null}
    </View>
  );
}
