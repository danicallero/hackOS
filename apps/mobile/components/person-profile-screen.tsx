import { useLocalSearchParams, useRouter } from "expo-router";
import { HeaderHeightContext } from "expo-router/react-navigation";
import Stack from "expo-router/stack";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, Pressable, RefreshControl, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CvViewer } from "@/components/cv-viewer";
import { DiaryNoteEditor } from "@/components/diary-note-editor";
import { FavouriteStar } from "@/components/favourite-star";
import { GlassView } from "@/components/glass-view";
import {
  AndroidStatusBarScrim,
  EmptyState,
  LegacyHeaderIconButton,
  Section,
} from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import {
  ProfileAvatarCollapse,
  ProfileAvatarCollapseAnchor,
  useProfileAvatarCollapse,
} from "@/components/profile-avatar-collapse";
import { ProfileCard } from "@/components/profile-card";
import { NoteRow, QuickAction } from "@/components/profile-parts";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ApiError, apiFetch } from "@/lib/api";
import type { DiaryEntry } from "@/lib/diary";
import type { DirectoryEntry } from "@/lib/directory";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { safeBack } from "@/lib/navigation";
import { reportContent } from "@/lib/reports";
import { colors } from "@/theme/colors";

type State =
  | { status: "loading" }
  | { status: "ready"; person: DirectoryEntry }
  | { status: "missing" }
  | { status: "error"; error: Error };

/**
 * A saved person's profile (#934, #935), opened from a diary row. People get
 * into the diary only by a badge scan, so there is no Save here. The API
 * answers 404 for a hidden profile and for a person the reader may not open,
 * so both show the same unavailable state. The diary entry carries the
 * reader's favourite and note.
 */
export function PersonProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const router = useRouter();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  // iOS shows the transparent native header, whose height the automatic
  // inset adds above the avatar's true top (#935).
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const avatarCollapse = useProfileAvatarCollapse(undefined, {
    headerHeight: process.env.EXPO_OS === "ios" ? headerHeight : 0,
  });
  const [state, setState] = useState<State>({ status: "loading" });
  const [entry, setEntry] = useState<DiaryEntry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<"star" | "remove" | "note" | null>(null);
  const [cvOpen, setCvOpen] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const requestId = useRef(0);
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
    const [person, diary] = await Promise.allSettled([
      apiFetch<DirectoryEntry>(`/api/directory/${userId}`),
      apiFetch<{ items: DiaryEntry[] }>("/api/me/diary"),
    ]);
    if (request !== requestId.current) return;
    if (diary.status === "fulfilled") {
      setEntry(
        diary.value.items.find(
          (item) => item.kind === "person" && item.person?.userId === userId,
        ) ?? null,
      );
    }
    if (person.status === "fulfilled") setState({ status: "ready", person: person.value });
    else if (person.reason instanceof ApiError && person.reason.status === 404) {
      setState({ status: "missing" });
    } else {
      setState({
        status: "error",
        error: person.reason instanceof Error ? person.reason : new Error(String(person.reason)),
      });
    }
  }, [userId]);

  useEffect(() => {
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
      Alert.alert(t("tabDiary"), t("diaryActionError"));
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
    Alert.alert(t("diaryRemoveTitle"), undefined, [
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
            style={{ borderRadius: 22, height: 44, width: 44 }}
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
        <Stack.Screen options={{ title: "", headerBackVisible: !floatingBack }} />
      ) : null}
      {person?.cvUrl ? (
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
          paddingHorizontal: 16,
          paddingTop: usesCustomAndroidHeader ? insets.top + 64 : 8,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
        }
      >
        {state.status === "loading" ? (
          <RequestFeedback loading />
        ) : state.status === "error" ? (
          <RequestFeedback error={state.error} onRetry={() => void load()} />
        ) : state.status === "missing" || !person ? (
          <EmptyState icon="person.crop.circle" title={t("directoryPersonNotFound")} />
        ) : (
          <>
            <ProfileCard
              data={person}
              onNameLayout={avatarCollapse.onNameLayout}
              avatar={
                <ProfileAvatarCollapseAnchor controller={avatarCollapse} size={112}>
                  <PersonAvatar size={112} name={person.displayName} uri={person.photoUrl} />
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
                  {person.cvUrl ? (
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

            {entry ? (
              <Section>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy !== null, busy: busy === "remove" }}
                  disabled={busy !== null}
                  onPress={confirmRemove}
                  style={({ pressed }) => ({
                    alignItems: "center",
                    backgroundColor: pressed ? colors.elevatedSurface : undefined,
                    minHeight: 50,
                    justifyContent: "center",
                    paddingHorizontal: 16,
                  })}
                >
                  <Text style={{ color: colors.destructive, fontSize: 16 }}>
                    {t("diaryRemoveFromDiary")}
                  </Text>
                </Pressable>
              </Section>
            ) : null}
            {entry ? (
              <Section>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => reportContent({ userId }, t)}
                  style={({ pressed }) => ({
                    alignItems: "center",
                    backgroundColor: pressed ? colors.elevatedSurface : undefined,
                    minHeight: 50,
                    justifyContent: "center",
                    paddingHorizontal: 16,
                  })}
                >
                  <Text style={{ color: colors.destructive, fontSize: 16 }}>
                    {t("reportContent")}
                  </Text>
                </Pressable>
              </Section>
            ) : null}
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
          size={112}
          variant="person"
        />
      ) : null}
    </View>
  );
}
