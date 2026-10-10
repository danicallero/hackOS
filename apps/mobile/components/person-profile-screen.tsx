import { File, Paths } from "expo-file-system";
import { useLocalSearchParams, useRouter } from "expo-router";
import Stack from "expo-router/stack";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DiaryNoteEditor } from "@/components/diary-note-editor";
import { GlassView } from "@/components/glass-view";
import { EmptyState, LegacyHeaderIconButton, Section, Separator } from "@/components/native-ui";
import { PersonAvatar } from "@/components/person-avatar";
import { DetailRow, QuickAction } from "@/components/profile-parts";
import { RequestFeedback } from "@/components/RequestFeedback";
import { ApiError, apiFetch, getCurrentSessionCookie } from "@/lib/api";
import type { DiaryEntry } from "@/lib/diary";
import {
  apiAssetUrl,
  cvFileName,
  type DirectoryEntry,
  displayUrl,
  socialLabel,
} from "@/lib/directory";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import { safeBack } from "@/lib/navigation";
import { colors } from "@/theme/colors";

type State =
  | { status: "loading" }
  | { status: "ready"; person: DirectoryEntry }
  | { status: "missing" }
  | { status: "error"; error: Error };

const ROW_ICON_INSET = 52;

/**
 * One directory profile (#934, #935), opened from a diary row or the
 * directory list. The API answers 404 for a hidden profile and for a person
 * the reader may not open, so both show the same unavailable state. The
 * diary entry, when there is one, carries the reader's favourite and note.
 */
export function PersonProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userId = Number(id);
  const router = useRouter();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ status: "loading" });
  const [entry, setEntry] = useState<DiaryEntry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<"star" | "save" | "remove" | "note" | "cv" | null>(null);
  const [editingNote, setEditingNote] = useState(false);
  const requestId = useRef(0);
  const usesCustomAndroidHeader = process.env.EXPO_OS === "android";

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
      Alert.alert(t("tabDiary"), t(kind === "cv" ? "directoryCvError" : "diaryActionError"));
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

  function save() {
    void run("save", async () => {
      const saved = await apiFetch<DiaryEntry>("/api/me/diary/people", {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": createIdempotencyKey() },
        body: JSON.stringify({ userId }),
      });
      setEntry(saved);
      void haptic("success");
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
          }),
      },
    ]);
  }

  /** The CV route needs the session cookie, so it is downloaded in-app first. */
  function openCv(person: DirectoryEntry) {
    const cvUrl = person.cvUrl;
    if (!cvUrl) return;
    void run("cv", async () => {
      const destination = new File(Paths.cache, cvFileName(person.displayName));
      if (destination.exists) destination.delete();
      const file = await File.downloadFileAsync(apiAssetUrl(cvUrl), destination, {
        headers: { Cookie: getCurrentSessionCookie() },
        idempotent: true,
      });
      if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing unavailable");
      await Sharing.shareAsync(file.uri, {
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
        dialogTitle: person.displayName,
      });
    });
  }

  const goBack = () => safeBack(router, "/(tabs)");
  const person = state.status === "ready" ? state.person : null;

  return (
    <>
      {usesCustomAndroidHeader ? (
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
      ) : (
        <Stack.Screen
          options={{
            title: "",
            // A root-level detail route: keep the back action explicit so it
            // also works when the native back item has nothing to pop (H59).
            headerBackVisible: false,
            headerLeft: () => (
              <LegacyHeaderIconButton
                accessibilityLabel={t("back")}
                icon="chevron.left"
                onPress={goBack}
              />
            ),
          }}
        />
      )}
      <DiaryNoteEditor
        entry={editingNote ? entry : null}
        onClose={() => setEditingNote(false)}
        onSave={(_, note) => {
          setEditingNote(false);
          patch({ note }, "note");
        }}
      />
      <ScrollView
        testID="person-profile"
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
              <PersonAvatar size={112} name={person.displayName} uri={person.photoUrl} />
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
                  title={t("diaryShowFavourites")}
                  selected={entry.starred}
                  busy={busy === "star"}
                  onPress={() => patch({ starred: !entry.starred }, "star")}
                />
              ) : (
                <QuickAction
                  icon="plus.circle"
                  label={t("directorySave")}
                  title={t("save")}
                  busy={busy === "save"}
                  onPress={save}
                />
              )}
              {entry ? (
                <QuickAction
                  icon="note.text"
                  label={t("diaryNote")}
                  title={t("diaryNote")}
                  busy={busy === "note"}
                  onPress={() => setEditingNote(true)}
                />
              ) : null}
              {person.cvUrl ? (
                <QuickAction
                  icon="doc.text"
                  label={t("directoryCv")}
                  title={t("directoryCv")}
                  busy={busy === "cv"}
                  onPress={() => openCv(person)}
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
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint={t("diaryNote")}
                  onPress={() => setEditingNote(true)}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? colors.elevatedSurface : undefined,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                  })}
                >
                  <Text selectable style={{ color: colors.label, fontSize: 16, lineHeight: 22 }}>
                    {entry.note}
                  </Text>
                </Pressable>
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

            {person.locationNote || person.project || person.challenges.length > 0 ? (
              <Section>
                {[
                  person.locationNote ? (
                    <DetailRow
                      key="location"
                      icon="mappin.and.ellipse"
                      label={t("directoryLocation")}
                      value={person.locationNote}
                    />
                  ) : null,
                  person.project ? (
                    <DetailRow
                      key="project"
                      icon="hammer"
                      label={t(
                        person.project.kind === "project" ? "directoryProject" : "directoryWorkGroup",
                      )}
                      value={person.project.name}
                    />
                  ) : null,
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
                  <Text style={{ color: colors.destructive, fontSize: 16 }}>{t("remove")}</Text>
                </Pressable>
              </Section>
            ) : null}
          </>
        )}
      </ScrollView>
    </>
  );
}
