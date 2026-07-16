import { MenuView } from "@expo/ui/community/menu";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ActionButton,
  EmptyState,
  FloatingGlassButton,
  InfoRow,
  Section,
  Separator,
  StatusPill,
} from "@/components/native-ui";
import { SegmentedControl } from "@/components/segmented-control";
import { apiFetch } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { durationMinutes, securedWindowFraction } from "@/lib/presence-timeline";
import { colors } from "@/theme/colors";

type SignalKind = "in" | "out" | "activity";

interface PresenceSignal {
  id: number;
  source: "door" | "activity";
  kind: SignalKind;
  occurredAt: string;
  activityId: number | null;
  activityName: string | null;
  category: string | null;
  notes: string | null;
  // null = system-generated (event-end automatic exit)
  recordedBy: { userId: number; name: string | null; surname: string | null } | null;
}

interface CertaintyWindow {
  start: string;
  deadline: string;
  securedUntil: string | null;
  status: "secured" | "provisional" | "invalid";
  openedBy: "in" | "activity";
  closedBy: SignalKind | null;
  conflict: boolean;
}

// Illegal in→in pair (H24): the fix must land strictly inside (from, to).
interface PresenceConflict {
  firstLogId: number;
  secondLogId: number;
  from: string;
  to: string;
}

interface PresenceTimeline {
  certaintyWindowMinutes: number;
  activities: Array<{ id: number; name: string; category: string }>;
  signals: PresenceSignal[];
  conflicts: PresenceConflict[];
  windows: CertaintyWindow[];
}

interface SignalDraft {
  signal: PresenceSignal | null;
  kind: SignalKind;
  occurredAt: Date;
  activityId: number | null;
  notes: string;
  /** When resolving a conflict, the picker is clamped to the gap between the two entries. */
  bounds?: { min: Date; max: Date };
}

export function PresenceManagement({
  userId,
  refreshKey,
}: {
  userId: number;
  refreshKey?: string;
}) {
  useColorScheme();
  const { language, t } = useLocale();
  const [timeline, setTimeline] = useState<PresenceTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SignalDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTimeline(await apiFetch<PresenceTimeline>(`/api/presence/timeline/${userId}`));
    } catch {
      setError(t("presenceCouldNotLoad"));
    } finally {
      setLoading(false);
    }
  }, [t, userId]);

  useEffect(() => {
    void refreshKey;
    void load();
  }, [load, refreshKey]);

  function addSignal() {
    setDraft({
      signal: null,
      kind: "in",
      occurredAt: new Date(),
      activityId: timeline?.activities[0]?.id ?? null,
      notes: "",
    });
  }

  function resolveConflict(conflict: PresenceConflict) {
    const from = Date.parse(conflict.from);
    const to = Date.parse(conflict.to);
    setDraft({
      signal: null,
      kind: "out", // an entry can't fix in→in; default to the missing exit
      occurredAt: new Date(from + (to - from) / 2),
      activityId: timeline?.activities[0]?.id ?? null,
      notes: "",
      bounds: { min: new Date(from), max: new Date(to) },
    });
  }

  function editSignal(signal: PresenceSignal) {
    setDraft({
      signal,
      kind: signal.kind,
      occurredAt: new Date(signal.occurredAt),
      activityId: signal.activityId ?? timeline?.activities[0]?.id ?? null,
      notes: signal.notes ?? "",
    });
  }

  function confirmDelete(signal: PresenceSignal) {
    Alert.alert(t("presenceDeleteSignal"), t("presenceDeleteConfirm"), [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("delete"),
        style: "destructive",
        onPress: () =>
          void (async () => {
            try {
              const collection = signal.source === "door" ? "logs" : "activity-logs";
              await apiFetch(`/api/presence/${collection}/${signal.id}`, { method: "DELETE" });
              await load();
            } catch {
              Alert.alert(t("presenceCouldNotDelete"));
            }
          })(),
      },
    ]);
  }

  // Guaranteed = time already secured by a later checkpoint; provisional =
  // the still-open window's elapsed time since the last checkpoint (secured
  // by the next exit/activity, worth zero if the window expires).
  const guaranteedMinutes = (timeline?.windows ?? []).reduce(
    (sum, window) =>
      sum + (window.securedUntil ? durationMinutes(window.start, window.securedUntil) : 0),
    0,
  );
  const provisionalMinutes = (timeline?.windows ?? []).reduce((sum, window) => {
    if (window.securedUntil || window.status !== "provisional") return sum;
    const end = Math.min(Date.now(), Date.parse(window.deadline));
    return sum + Math.max(0, Math.round((end - Date.parse(window.start)) / 60_000));
  }, 0);

  // One unified timeline: every entry/activity signal opens exactly one
  // certainty window (in order), so zip them and render each point with the
  // window it opened. Exits close windows but never open one.
  const rows = (() => {
    const wins = timeline?.windows ?? [];
    let windowIndex = 0;
    return (timeline?.signals ?? [])
      .map((signal) => ({
        signal,
        window: signal.kind === "out" ? null : (wins[windowIndex++] ?? null),
      }))
      .reverse(); // newest first
  })();

  return (
    <View style={{ gap: 22 }}>
      {(timeline?.conflicts ?? []).map((conflict) => (
        <ConflictBanner
          key={`${conflict.firstLogId}-${conflict.secondLogId}`}
          conflict={conflict}
          language={language}
          onResolve={() => resolveConflict(conflict)}
        />
      ))}

      <Section title={t("presenceSummary")} footer={t("presenceSummaryFooter")}>
        <InfoRow
          icon="checkmark.seal.fill"
          label={t("presenceGuaranteedHours")}
          value={timeline ? formatMinutes(guaranteedMinutes, t) : "—"}
          valueStyle={{ color: colors.success, fontVariant: ["tabular-nums"], fontWeight: "700" }}
        />
        <Separator />
        <InfoRow
          icon="hourglass"
          label={t("presenceProvisionalHours")}
          value={timeline ? formatMinutes(provisionalMinutes, t) : "—"}
          valueStyle={{ color: colors.warning, fontVariant: ["tabular-nums"], fontWeight: "600" }}
        />
      </Section>

      <Section title={t("presenceTimeline")} footer={t("presenceTimelineFooter")}>
        <ActionButton icon="plus.circle.fill" label={t("presenceAddSignal")} onPress={addSignal} />
        {loading && !timeline ? (
          <>
            <Separator />
            <View style={{ alignItems: "center", minHeight: 110, justifyContent: "center" }}>
              <ActivityIndicator color={colors.accent} />
            </View>
          </>
        ) : error && !timeline ? (
          <>
            <Separator />
            <InfoRow icon="exclamationmark.triangle" label={error} value="" />
            <Separator />
            <ActionButton icon="arrow.clockwise" label={t("retry")} onPress={() => void load()} />
          </>
        ) : rows.length === 0 ? (
          <>
            <Separator />
            <EmptyState
              icon="clock.badge.questionmark"
              title={t("presenceNoWindows")}
              description={t("presenceNoWindowsDescription")}
            />
          </>
        ) : (
          rows.map(({ signal, window }) => (
            <View key={`${signal.source}-${signal.id}`}>
              <Separator />
              <SignalRow
                signal={signal}
                window={window}
                language={language}
                onEdit={() => editSignal(signal)}
              />
              {window ? <WindowMeter window={window} language={language} /> : null}
              <View style={{ flexDirection: "row" }}>
                <ActionButton
                  icon="pencil"
                  label={t("edit")}
                  onPress={() => editSignal(signal)}
                  style={{ flex: 1 }}
                />
                <View style={{ backgroundColor: colors.separator, width: 0.5 }} />
                <ActionButton
                  destructive
                  icon="trash"
                  label={t("delete")}
                  onPress={() => confirmDelete(signal)}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          ))
        )}
      </Section>

      {draft && timeline ? (
        <SignalEditor
          activities={timeline.activities}
          draft={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSaved={async () => {
            setDraft(null);
            await load();
          }}
          userId={userId}
        />
      ) : null}
    </View>
  );
}

function ConflictBanner({
  conflict,
  language,
  onResolve,
}: {
  conflict: PresenceConflict;
  language: string;
  onResolve: () => void;
}) {
  const { t } = useLocale();
  const timeOptions = {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  } as const;
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: colors.destructiveSurface,
        borderColor: colors.destructive,
        borderCurve: "continuous",
        borderRadius: 14,
        borderWidth: 0.5,
        overflow: "hidden",
      }}
    >
      <View style={{ flexDirection: "row", gap: 12, padding: 16 }}>
        <SymbolView name="exclamationmark.triangle.fill" tintColor={colors.destructive} size={22} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text selectable style={{ color: colors.destructive, fontSize: 16, fontWeight: "700" }}>
            {t("presenceConflictTitle")}
          </Text>
          <Text selectable style={{ color: colors.label, fontSize: 14, lineHeight: 19 }}>
            {t("presenceConflictBody", {
              from: new Date(conflict.from).toLocaleString(language, timeOptions),
              to: new Date(conflict.to).toLocaleString(language, timeOptions),
            })}
          </Text>
        </View>
      </View>
      <View style={{ backgroundColor: colors.destructive, height: 0.5, opacity: 0.3 }} />
      <ActionButton
        destructive
        icon="wrench.and.screwdriver.fill"
        label={t("presenceResolveConflict")}
        onPress={onResolve}
      />
    </View>
  );
}

/** Certainty-window meter shown under the signal that opened the window. */
function WindowMeter({ window, language }: { window: CertaintyWindow; language: string }) {
  const { t } = useLocale();
  const securedFraction = securedWindowFraction(window);
  const provisionalFraction =
    window.status === "provisional"
      ? Math.min(
          1,
          Math.max(
            0,
            (Date.now() - Date.parse(window.start)) /
              (Date.parse(window.deadline) - Date.parse(window.start)),
          ),
        )
      : 0;
  const securedMinutes = window.securedUntil
    ? durationMinutes(window.start, window.securedUntil)
    : 0;

  return (
    <View style={{ gap: 10, paddingBottom: 14, paddingHorizontal: 16 }}>
      <View
        accessibilityLabel={t("presenceCertaintyWindow")}
        style={{
          backgroundColor: colors.elevatedSurface,
          borderCurve: "continuous",
          borderRadius: 999,
          height: 10,
          overflow: "hidden",
        }}
      >
        {provisionalFraction > 0 ? (
          <View
            style={{
              backgroundColor: colors.warning,
              height: "100%",
              opacity: 0.5,
              width: `${provisionalFraction * 100}%`,
            }}
          />
        ) : null}
        {securedFraction > 0 ? (
          <View
            style={{
              backgroundColor: colors.success,
              height: "100%",
              position: "absolute",
              width: `${securedFraction * 100}%`,
            }}
          />
        ) : null}
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12 }}>
          {new Date(window.start).toLocaleTimeString(language, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 12 }}>
          {t("presenceDeadline", {
            time: new Date(window.deadline).toLocaleString(language, {
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              month: "short",
            }),
          })}
        </Text>
      </View>
      {window.securedUntil ? (
        <Text selectable style={{ color: colors.success, fontSize: 13, fontWeight: "600" }}>
          {t("presenceSecuredFor", { duration: formatMinutes(securedMinutes, t) })}
        </Text>
      ) : null}
    </View>
  );
}

function SignalRow({
  signal,
  window,
  language,
  onEdit,
}: {
  signal: PresenceSignal;
  window?: CertaintyWindow | null;
  language: string;
  onEdit: () => void;
}) {
  const { t } = useLocale();
  const title =
    signal.kind === "activity"
      ? (signal.activityName ?? t("presenceSignalActivity"))
      : signal.kind === "in"
        ? t("presenceSignalEntry")
        : t("presenceSignalExit");
  const status = !window
    ? null
    : window.conflict
      ? { label: t("presenceConflict"), tone: "destructive" as const }
      : {
          secured: { label: t("presenceSecured"), tone: "success" as const },
          provisional: { label: t("presenceProvisional"), tone: "warning" as const },
          invalid: { label: t("presenceInvalid"), tone: "destructive" as const },
        }[window.status];
  const recordedBy = signal.recordedBy
    ? [signal.recordedBy.name, signal.recordedBy.surname].filter(Boolean).join(" ")
    : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t("edit")}: ${title}`}
      onPress={onEdit}
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: 12,
        opacity: pressed ? 0.6 : 1,
        padding: 16,
      })}
    >
      <SymbolView
        name={
          signal.kind === "activity"
            ? "figure.run"
            : signal.kind === "in"
              ? "arrow.right.to.line"
              : "arrow.left.to.line"
        }
        tintColor={signal.kind === "out" ? colors.warning : colors.accent}
        size={20}
      />
      <View style={{ flex: 1, gap: 3 }}>
        <Text selectable style={{ color: colors.label, fontSize: 16, fontWeight: "600" }}>
          {title}
        </Text>
        <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14 }}>
          {new Date(signal.occurredAt).toLocaleString(language)}
        </Text>
        {signal.notes ? (
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 14, lineHeight: 19 }}>
            {signal.notes}
          </Text>
        ) : null}
        {recordedBy ? (
          <Text selectable style={{ color: colors.tertiaryLabel, fontSize: 12 }}>
            {t("presenceRecordedBy", { name: recordedBy })}
          </Text>
        ) : signal.recordedBy == null ? (
          <Text selectable style={{ color: colors.tertiaryLabel, fontSize: 12 }}>
            {t("presenceRecordedBySystem")}
          </Text>
        ) : null}
      </View>
      {status ? (
        <StatusPill tone={status.tone} style={{ alignSelf: "center" }}>
          {status.label}
        </StatusPill>
      ) : null}
      <SymbolView
        name="chevron.right"
        tintColor={colors.tertiaryLabel}
        size={14}
        style={{ alignSelf: "center" }}
      />
    </Pressable>
  );
}

function SignalEditor({
  activities,
  draft,
  onChange,
  onClose,
  onSaved,
  userId,
}: {
  activities: PresenceTimeline["activities"];
  draft: SignalDraft;
  onChange: (draft: SignalDraft) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
  userId: number;
}) {
  useColorScheme();
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (draft.kind === "activity" && draft.activityId == null) {
      setError(t("presenceActivityRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    const notes = draft.notes.trim() || null;
    try {
      if (!draft.signal) {
        const body =
          draft.kind === "activity"
            ? {
                kind: draft.kind,
                occurredAt: draft.occurredAt.toISOString(),
                activityId: draft.activityId,
                notes,
              }
            : { kind: draft.kind, occurredAt: draft.occurredAt.toISOString(), notes };
        await apiFetch(`/api/presence/signals/${userId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } else if (draft.signal.source === "activity") {
        await apiFetch(`/api/presence/activity-logs/${draft.signal.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            activityId: draft.activityId,
            occurredAt: draft.occurredAt.toISOString(),
            notes,
          }),
        });
      } else {
        await apiFetch(`/api/presence/logs/${draft.signal.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: draft.kind,
            scannedAt: draft.occurredAt.toISOString(),
            notes,
          }),
        });
      }
      await onSaved();
    } catch {
      setError(t("presenceCouldNotSave"));
    } finally {
      setSaving(false);
    }
  }

  const canChangeKind = !draft.signal || draft.signal.source === "door";
  // Resolving an in→in conflict: only an exit or activity can close the gap,
  // and the timestamp must land strictly between the two conflicting entries.
  const kinds: SignalKind[] = draft.bounds ? ["activity", "out"] : ["in", "activity", "out"];
  const kindLabels: Record<SignalKind, string> = {
    in: t("presenceSignalEntry"),
    activity: t("presenceSignalActivity"),
    out: t("presenceSignalExit"),
  };
  const clampToBounds = (date: Date): Date => {
    if (!draft.bounds) return date;
    const time = Math.min(
      Math.max(date.getTime(), draft.bounds.min.getTime()),
      draft.bounds.max.getTime(),
    );
    return new Date(time);
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <View style={{ backgroundColor: colors.background, flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            gap: 22,
            padding: 16,
            paddingBottom: Math.max(32, insets.bottom + 16),
            paddingTop: 16,
          }}
        >
          <View style={{ justifyContent: "center", minHeight: 44, paddingHorizontal: 52 }}>
            <Text
              selectable
              style={{ color: colors.label, fontSize: 20, fontWeight: "700", textAlign: "center" }}
            >
              {draft.signal ? t("presenceEditSignal") : t("presenceAddSignal")}
            </Text>
          </View>

          <Section title={t("personMovement")}>
            <View style={{ gap: 14, padding: 16 }}>
              <SegmentedControl
                label={t("personMovement")}
                values={kinds.map((kind) => kindLabels[kind])}
                selectedIndex={Math.max(0, kinds.indexOf(draft.kind))}
                onChange={(index) => {
                  if (!canChangeKind) return;
                  onChange({ ...draft, kind: kinds[index] ?? kinds[0] ?? "in" });
                }}
              />
              {!canChangeKind ? (
                <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13 }}>
                  {t("presenceActivityKindLocked")}
                </Text>
              ) : null}
            </View>
          </Section>

          {draft.kind === "activity" ? (
            <Section title={t("presenceActivity")}>
              {activities.length > 0 ? (
                <MenuView
                  actions={activities.map((activity) => ({
                    id: String(activity.id),
                    title: `${activity.name} · ${activity.category}`,
                    state: draft.activityId === activity.id ? ("on" as const) : ("off" as const),
                  }))}
                  onPressAction={({ nativeEvent }) =>
                    onChange({ ...draft, activityId: Number(nativeEvent.event) })
                  }
                >
                  <View
                    style={{
                      alignItems: "center",
                      flexDirection: "row",
                      gap: 12,
                      minHeight: 50,
                      padding: 16,
                    }}
                  >
                    <Text
                      selectable
                      numberOfLines={1}
                      style={{ color: colors.label, flex: 1, fontSize: 16 }}
                    >
                      {(() => {
                        const selected = activities.find(
                          (activity) => activity.id === draft.activityId,
                        );
                        return selected
                          ? `${selected.name} · ${selected.category}`
                          : t("presenceChooseActivity");
                      })()}
                    </Text>
                    <SymbolView
                      name="chevron.up.chevron.down"
                      tintColor={colors.secondaryLabel}
                      size={15}
                    />
                  </View>
                </MenuView>
              ) : (
                <Text selectable style={{ color: colors.secondaryLabel, padding: 16 }}>
                  {t("presenceNoActivities")}
                </Text>
              )}
            </Section>
          ) : null}

          <Section
            title={t("presenceDateAndTime")}
            footer={draft.bounds ? t("presenceConflictBounds") : undefined}
          >
            <View style={{ gap: 12, padding: 16 }}>
              {process.env.EXPO_OS === "android" ? (
                <>
                  <DateTimePicker
                    minimumDate={draft.bounds?.min}
                    maximumDate={draft.bounds?.max ?? new Date()}
                    mode="date"
                    value={draft.occurredAt}
                    onChange={(_, date) => {
                      if (!date) return;
                      date.setHours(draft.occurredAt.getHours(), draft.occurredAt.getMinutes());
                      onChange({ ...draft, occurredAt: clampToBounds(date) });
                    }}
                  />
                  <DateTimePicker
                    mode="time"
                    value={draft.occurredAt}
                    onChange={(_, date) => {
                      if (!date) return;
                      const next = new Date(draft.occurredAt);
                      next.setHours(date.getHours(), date.getMinutes());
                      onChange({ ...draft, occurredAt: clampToBounds(next) });
                    }}
                  />
                </>
              ) : (
                <DateTimePicker
                  minimumDate={draft.bounds?.min}
                  maximumDate={draft.bounds?.max ?? new Date()}
                  mode="datetime"
                  value={draft.occurredAt}
                  onChange={(_, date) =>
                    date && onChange({ ...draft, occurredAt: clampToBounds(date) })
                  }
                />
              )}
            </View>
          </Section>

          <Section title={t("presenceNotes")}>
            <TextInput
              accessibilityLabel={t("presenceNotes")}
              multiline
              onChangeText={(notes) => onChange({ ...draft, notes })}
              placeholder={t("presenceNotesPlaceholder")}
              placeholderTextColor={colors.tertiaryLabel}
              style={{
                color: colors.label,
                fontSize: 16,
                lineHeight: 22,
                minHeight: 110,
                padding: 16,
                textAlignVertical: "top",
              }}
              value={draft.notes}
            />
          </Section>

          {error ? (
            <Text
              selectable
              style={{ color: colors.destructive, fontSize: 14, textAlign: "center" }}
            >
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <FloatingGlassButton
          top={16}
          side="left"
          icon="xmark"
          accessibilityLabel={t("cancel")}
          onPress={onClose}
        />
        <FloatingGlassButton
          top={16}
          side="right"
          icon="checkmark"
          tintColor={colors.accent}
          accessibilityLabel={t("save")}
          accessibilityState={{ busy: saving }}
          disabled={saving}
          onPress={() => void save()}
        />
      </View>
    </Modal>
  );
}

function formatMinutes(minutes: number, t: ReturnType<typeof useLocale>["t"]): string {
  if (minutes < 60) return t("presenceMinutesValue", { minutes: String(minutes) });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? t("presenceWholeHoursValue", { hours: String(hours) })
    : t("presenceHoursMinutesValue", { hours: String(hours), minutes: String(remainder) });
}
