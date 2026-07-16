import { Picker } from "@expo/ui";
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
  const [hours, setHours] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SignalDraft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextTimeline, nextHours] = await Promise.all([
        apiFetch<PresenceTimeline>(`/api/presence/timeline/${userId}`),
        apiFetch<{ hours: number }>(`/api/presence/hours/${userId}`),
      ]);
      setTimeline(nextTimeline);
      setHours(nextHours.hours);
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

  const windows = [...(timeline?.windows ?? [])].reverse();
  const signals = [...(timeline?.signals ?? [])].reverse();

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

      <Section title={t("presenceSummary")}>
        <InfoRow
          icon="clock.fill"
          label={t("presenceComputedHours")}
          value={hours == null ? "—" : t("presenceHoursValue", { hours: hours.toFixed(2) })}
          valueStyle={{ fontVariant: ["tabular-nums"], fontWeight: "700" }}
        />
        <Separator />
        <InfoRow
          icon="timer"
          label={t("presenceCertaintyWindow")}
          value={formatMinutes(timeline?.certaintyWindowMinutes ?? 0, t)}
        />
      </Section>

      <Section title={t("presenceWindows")} footer={t("presenceWindowsFooter")}>
        {loading && !timeline ? (
          <View style={{ alignItems: "center", minHeight: 110, justifyContent: "center" }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : error && !timeline ? (
          <View style={{ gap: 4 }}>
            <InfoRow icon="exclamationmark.triangle" label={error} value="" />
            <Separator />
            <ActionButton icon="arrow.clockwise" label={t("retry")} onPress={() => void load()} />
          </View>
        ) : windows.length === 0 ? (
          <EmptyState
            icon="clock.badge.questionmark"
            title={t("presenceNoWindows")}
            description={t("presenceNoWindowsDescription")}
          />
        ) : (
          windows.map((window, index) => (
            <View
              key={`${window.start}-${window.deadline}-${window.openedBy}-${window.closedBy ?? "open"}`}
            >
              {index > 0 ? <Separator /> : null}
              <WindowRow window={window} language={language} />
            </View>
          ))
        )}
      </Section>

      <Section title={t("presenceSignals")} footer={t("presenceSignalsFooter")}>
        <ActionButton icon="plus.circle.fill" label={t("presenceAddSignal")} onPress={addSignal} />
        {signals.map((signal) => (
          <View key={`${signal.source}-${signal.id}`}>
            <Separator />
            <SignalRow signal={signal} language={language} onEdit={() => editSignal(signal)} />
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
        ))}
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

function WindowRow({ window, language }: { window: CertaintyWindow; language: string }) {
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
  const status = window.conflict
    ? { label: t("presenceConflict"), tone: "destructive" as const }
    : {
        secured: { label: t("presenceSecured"), tone: "success" as const },
        provisional: { label: t("presenceProvisional"), tone: "warning" as const },
        invalid: { label: t("presenceInvalid"), tone: "destructive" as const },
      }[window.status];
  const securedMinutes = window.securedUntil
    ? durationMinutes(window.start, window.securedUntil)
    : 0;

  return (
    <View style={{ gap: 12, padding: 16 }}>
      <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
        <View
          style={{
            alignItems: "center",
            backgroundColor: colors.accentSurface,
            borderCurve: "continuous",
            borderRadius: 10,
            height: 34,
            justifyContent: "center",
            width: 34,
          }}
        >
          <SymbolView
            name={window.openedBy === "in" ? "arrow.right.to.line" : "figure.run"}
            tintColor={colors.accent}
            size={17}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text selectable style={{ color: colors.label, fontSize: 16, fontWeight: "600" }}>
            {window.openedBy === "in" ? t("presenceSignalEntry") : t("presenceSignalActivity")}
          </Text>
          <Text selectable style={{ color: colors.secondaryLabel, fontSize: 13, marginTop: 2 }}>
            {new Date(window.start).toLocaleString(language)}
          </Text>
        </View>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
      </View>

      <View
        accessibilityLabel={status.label}
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
  language,
  onEdit,
}: {
  signal: PresenceSignal;
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
      <SymbolView name="chevron.right" tintColor={colors.tertiaryLabel} size={14} />
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
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          gap: 22,
          padding: 16,
          paddingBottom: Math.max(32, insets.bottom + 16),
          paddingTop: Math.max(18, insets.top + 8),
        }}
        style={{ backgroundColor: colors.background }}
      >
        <View style={{ alignItems: "center", flexDirection: "row", gap: 12 }}>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ color: colors.accent, fontSize: 17 }}>{t("cancel")}</Text>
          </Pressable>
          <Text
            selectable
            style={{
              color: colors.label,
              flex: 1,
              fontSize: 20,
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            {draft.signal ? t("presenceEditSignal") : t("presenceAddSignal")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ busy: saving, disabled: saving }}
            disabled={saving}
            onPress={() => void save()}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: "center",
              opacity: saving ? 0.45 : pressed ? 0.6 : 1,
            })}
          >
            {saving ? (
              <ActivityIndicator color={colors.accent} />
            ) : (
              <Text style={{ color: colors.accent, fontSize: 17, fontWeight: "700" }}>
                {t("save")}
              </Text>
            )}
          </Pressable>
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
            <View style={{ padding: 16 }}>
              {activities.length > 0 && draft.activityId != null ? (
                <Picker
                  appearance="menu"
                  selectedValue={draft.activityId}
                  onValueChange={(activityId) => onChange({ ...draft, activityId })}
                >
                  {activities.map((activity) => (
                    <Picker.Item
                      key={activity.id}
                      label={`${activity.name} · ${activity.category}`}
                      value={activity.id}
                    />
                  ))}
                </Picker>
              ) : (
                <Text selectable style={{ color: colors.secondaryLabel }}>
                  {t("presenceNoActivities")}
                </Text>
              )}
            </View>
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
          <Text selectable style={{ color: colors.destructive, fontSize: 14, textAlign: "center" }}>
            {error}
          </Text>
        ) : null}
      </ScrollView>
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
