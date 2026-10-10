import { useLocalSearchParams, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, Text, View } from "react-native";
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
  Separator,
} from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import {
  ProfileAvatarCollapse,
  ProfileAvatarCollapseAnchor,
  useProfileAvatarCollapse,
} from "@/components/profile-avatar-collapse";
import { DetailRow, NoteRow, QuickAction } from "@/components/profile-parts";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ApiError, apiFetch } from "@/lib/api";
import type { DiaryEntry } from "@/lib/diary";
import { type DirectoryEntry, displayUrl, socialLabel } from "@/lib/directory";
import { haptic } from "@/lib/haptics";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { safeBack } from "@/lib/navigation";
import { colors } from "@/theme/colors";

type State =
  | { status: "loading" }
  | { status: "ready"; person: DirectoryEntry }
  | { status: "missing" }
  | { status: "error"; error: Error };

const ROW_ICON_INSET = 52;

/** Singular and plural row labels per project kind. */
const PROJECT_KINDS: { kind: "project" | "workGroup"; one: MessageKey; many: MessageKey }[] = [
  { kind: "project", one: "directoryProject", many: "directoryProjects" },
  { kind: "workGroup", one: "directoryWorkGroup", many: "directoryWorkGroups" },
];

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
  const avatarCollapse = useProfileAvatarCollapse();
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
        headers: { "content-type": "application/json", "Idempotency-Key": createIdempotencyKey() },
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
              headers: { "Idempotency-Key": createIdempotencyKey() },
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
        testID="person-profile"
        onScroll={avatarCollapse.onScroll}
        onTouchStart={avatarCollapse.onScrollBeginDrag}
        onContentSizeChange={avatarCollapse.onContentSizeChange}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.background, flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          gap: 24,
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
            <View style={{ alignItems: "center", gap: 14 }}>
              <ProfileAvatarCollapseAnchor controller={avatarCollapse} size={112}>
                <PersonAvatar size={112} name={person.displayName} uri={person.photoUrl} />
              </ProfileAvatarCollapseAnchor>
              <View style={{ alignItems: "center", gap: 4, paddingHorizontal: 8 }}>
                <Text
                  selectable
                  accessibilityRole="header"
                  style={{
                    color: colors.label,
                    fontSize: 26,
                    fontWeight: "700",
                    textAlign: "center",
                  }}
                >
                  {person.displayName}
                </Text>
                {person.headline ? (
                  <Text
                    selectable
                    style={{
                      color: colors.secondaryLabel,
                      fontSize: 16,
                      lineHeight: 21,
                      textAlign: "center",
                    }}
                  >
                    {person.headline}
                  </Text>
                ) : null}
              </View>
            </View>

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

            {person.bio ? (
              <Section>
                <Text
                  selectable
                  style={{
                    color: colors.label,
                    fontSize: 16,
                    lineHeight: 23,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                  }}
                >
                  {person.bio}
                </Text>
              </Section>
            ) : null}

            {entry?.note ? (
              <Section title={t("diaryNote")}>
                <NoteRow
                  note={entry.note}
                  hint={t("diaryEditNote")}
                  onPress={() => setEditingNote(true)}
                />
              </Section>
            ) : null}

            {person.socials.length > 0 ? (
              <Section title={t("directoryLinks")}>
                {person.socials.map((link, index) => (
                  <View key={`${link.kind}-${link.url}`}>
                    {index > 0 ? <Separator inset={ROW_ICON_INSET} /> : null}
                    <DetailRow
                      icon={link.kind === "website" ? "globe" : "link"}
                      label={socialLabel(link, t)}
                      value={displayUrl(link.url)}
                      onPress={() => void Linking.openURL(link.url)}
                    />
                  </View>
                ))}
              </Section>
            ) : null}

            {person.locationNote || person.projects.length > 0 || person.challenges.length > 0 ? (
              <Section>
                {[
                  person.locationNote ? (
                    <DetailRow
                      key="location"
                      icon="mappin"
                      label={t("directoryLocation")}
                      value={person.locationNote}
                    />
                  ) : null,
                  // Every project and work group, one row per kind (#935).
                  ...PROJECT_KINDS.map(({ kind, one, many }) => {
                    const names = person.projects
                      .filter((project) => project.kind === kind)
                      .map((project) => project.name);
                    return names.length > 0 ? (
                      <DetailRow
                        key={kind}
                        icon="hammer"
                        label={t(names.length === 1 ? one : many)}
                        value={names.join("\n")}
                      />
                    ) : null;
                  }),
                  person.challenges.length > 0 ? (
                    <DetailRow
                      key="challenges"
                      icon="trophy"
                      label={t("directoryChallenges")}
                      value={person.challenges.map((challenge) => challenge.name).join("\n")}
                    />
                  ) : null,
                ]
                  .filter(Boolean)
                  .map((row, index) => (
                    <View key={(row as { key: string }).key}>
                      {index > 0 ? <Separator inset={ROW_ICON_INSET} /> : null}
                      {row}
                    </View>
                  ))}
              </Section>
            ) : null}

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
