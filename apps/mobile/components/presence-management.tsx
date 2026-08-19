import { MenuView } from "@expo/ui/community/menu";
import { useCallback, useEffect, useRef, useState } from "react";
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
  type ViewStyle,
} from "react-native";
import Swipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DateTimeField } from "@/components/date-time-field";
import {
  ActionButton,
  FloatingGlassButton,
  InfoRow,
  Section,
  Separator,
  StatusPill,
} from "@/components/native-ui";
import { SegmentedControl } from "@/components/segmented-control";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { durationMinutes, guaranteedMinutesTotal } from "@/lib/presence-timeline";
import { enqueueLocalScan, pendingScans } from "@/lib/scanner-db";
import type { ScanPayload } from "@/lib/scanner-types";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

export type SignalKind = "in" | "out" | "activity";

export interface PresenceSignal {
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

export interface CertaintyWindow {
  start: string;
  deadline: string;
  securedUntil: string | null;
  status: "secured" | "provisional" | "invalid";
  openedBy: "in" | "activity";
  closedBy: SignalKind | null;
  conflict: boolean;
}

// Illegal in→in pair (H24): the fix must land strictly inside (from, to).
export interface PresenceConflict {
  firstLogId: number;
  secondLogId: number;
  from: string;
  to: string;
}

export interface PresenceTimeline {
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
}

export function PresenceManagement({
  userId,
  refreshKey,
  onDoorState,
  accredited,
  initialDraft,
}: {
  userId: number;
  refreshKey?: string;
  /** Reports the server's last door log so the register can derive its direction from ground truth. */
  onDoorState?: (state: { kind: "in" | "out"; at: string } | null) => void;
  /** Hides the summary card for an unaccredited person with no signals yet — nothing to summarize. */
  accredited: boolean;
  /**
   * Opens the editor pre-filled once, as soon as the timeline first loads —
   * for a deep link from the profile's quick register (a backfilled entry,
   * or a backdated fix for a session that timed out uncredited).
   */
  initialDraft?: { kind: "in" | "out"; occurredAt: Date };
}) {
  useColorScheme();
  const { language, t } = useLocale();
  const { me } = useMeContext();
  const ownerUserId = me?.id;
  const sync = useScannerSync();
  const [timeline, setTimeline] = useState<PresenceTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SignalDraft | null>(null);
  const autoOpenedDraft = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await apiFetch<PresenceTimeline>(`/api/presence/timeline/${userId}`);
      setTimeline(next);
      const lastDoor = [...next.signals].reverse().find((signal) => signal.source === "door");
      onDoorState?.(
        lastDoor ? { kind: lastDoor.kind as "in" | "out", at: lastDoor.occurredAt } : null,
      );
    } catch {
      setError(t("presenceCouldNotLoad"));
    } finally {
      setLoading(false);
    }
  }, [onDoorState, t, userId]);

  useEffect(() => {
    void refreshKey;
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (!initialDraft || !timeline || autoOpenedDraft.current) return;
    autoOpenedDraft.current = true;
    setDraft({
      signal: null,
      kind: initialDraft.kind,
      occurredAt: initialDraft.occurredAt,
      activityId: timeline.activities[0]?.id ?? null,
      notes: "",
    });
  }, [initialDraft, timeline]);

  function addSignal() {
    setDraft({
      signal: null,
      kind: "in",
      occurredAt: new Date(),
      activityId: timeline?.activities[0]?.id ?? null,
      notes: "",
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
            if (ownerUserId === undefined) return;
            const scanId = await enqueueLocalScan(
              { kind: "presence_signal_delete", source: signal.source, logId: signal.id },
              ownerUserId,
            );
            await sync.sync();
            const stored = (await pendingScans(ownerUserId)).find((scan) => scan.id === scanId);
            if (stored?.status === "failed") {
              void haptic("error");
              Alert.alert(t("presenceCouldNotDelete"), stored.lastError ?? undefined);
            } else {
              void haptic("warning");
            }
            await load();
          })(),
      },
    ]);
  }

  const guaranteedMinutes = guaranteedMinutesTotal(timeline?.windows ?? []);

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

  const groups = groupRowsByDay(rows, language, t);

  return (
    <View style={{ gap: 22 }}>
      {accredited || rows.length > 0 ? (
        <Section title={t("presenceSummary")}>
          <InfoRow
            icon="checkmark.seal.fill"
            label={t("presenceGuaranteedHours")}
            value={timeline ? formatMinutes(guaranteedMinutes, t) : "—"}
            valueStyle={{ color: colors.success, fontVariant: ["tabular-nums"], fontWeight: "700" }}
          />
        </Section>
      ) : null}

      <View style={{ gap: 16 }}>
        <Section title={t("presenceTimeline")}>
          <ActionButton
            icon="plus.circle.fill"
            label={t("presenceAddSignal")}
            onPress={addSignal}
          />
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
              <View
                style={{ alignItems: "center", gap: 6, paddingHorizontal: 32, paddingVertical: 24 }}
              >
                <SymbolView
                  name="clock.badge.questionmark"
                  tintColor={colors.secondaryLabel}
                  size={26}
                  accessible={false}
                />
                <Text
                  selectable
                  accessibilityRole="header"
                  style={{
                    color: colors.label,
                    fontSize: 16,
                    fontWeight: "700",
                    textAlign: "center",
                  }}
                >
                  {t("presenceNoWindows")}
                </Text>
                <Text
                  selectable
                  style={{
                    color: colors.secondaryLabel,
                    fontSize: 14,
                    lineHeight: 19,
                    textAlign: "center",
                  }}
                >
                  {t("presenceNoWindowsDescription")}
                </Text>
              </View>
            </>
          ) : null}
        </Section>

        {groups.map((group) => (
          <View key={group.key} style={{ gap: 10 }}>
            <View
              style={{
                alignItems: "baseline",
                flexDirection: "row",
                justifyContent: "space-between",
                paddingHorizontal: 4,
              }}
            >
              <Text
                selectable
                style={{
                  color: colors.secondaryLabel,
                  fontSize: 13,
                  fontWeight: "700",
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                }}
              >
                {group.label}
              </Text>
              <Text style={{ color: colors.tertiaryLabel, fontSize: 13 }}>
                {group.items.length === 1
                  ? t("presenceRecordsCountOne", { count: "1" })
                  : t("presenceRecordsCountOther", { count: String(group.items.length) })}
              </Text>
            </View>
            <View style={{ gap: 10 }}>
              {group.items.map(({ signal, window }) => (
                <SignalCard
                  key={`${signal.source}-${signal.id}`}
                  signal={signal}
                  window={window}
                  language={language}
                  onEdit={() => editSignal(signal)}
                  onDelete={() => confirmDelete(signal)}
                />
              ))}
            </View>
          </View>
        ))}

        {rows.length > 0 ? (
          <Text
            selectable
            style={{
              color: colors.secondaryLabel,
              fontSize: 13,
              lineHeight: 18,
              paddingHorizontal: 16,
            }}
          >
            {t("presenceTimelineFooter")}
          </Text>
        ) : null}
      </View>

      {draft && timeline ? (
        <SignalEditor
          activities={timeline.activities}
          draft={draft}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSaved={async () => {
            setDraft(null);
            await load();
            void haptic("success");
          }}
          ownerUserId={ownerUserId}
          sync={sync}
          userId={userId}
        />
      ) : null}
    </View>
  );
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function fmtTime(date: Date, language: string): string {
  return date.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" });
}

interface TimelineRow {
  signal: PresenceSignal;
  window: CertaintyWindow | null;
}

interface DayGroup {
  key: string;
  label: string;
  items: TimelineRow[];
}

/** Buckets the (already newest-first) rows by calendar day, "Today"/"Yesterday" first. */
function groupRowsByDay(
  rows: TimelineRow[],
  language: string,
  t: ReturnType<typeof useLocale>["t"],
): DayGroup[] {
  const now = new Date();
  const todayKey = dayKey(now);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = dayKey(yesterday);
  const groups: DayGroup[] = [];
  for (const row of rows) {
    const occurredAt = new Date(row.signal.occurredAt);
    const key = dayKey(occurredAt);
    const current = groups.at(-1);
    if (current?.key === key) {
      current.items.push(row);
      continue;
    }
    const dayMonth = occurredAt.toLocaleDateString(language, { day: "numeric", month: "short" });
    const relative =
      key === todayKey
        ? t("presenceToday")
        : key === yesterdayKey
          ? t("presenceYesterday")
          : occurredAt.toLocaleDateString(language, { weekday: "short" });
    groups.push({ key, label: `${relative}, ${dayMonth}`, items: [row] });
  }
  return groups;
}

function iconForSignal(signal: PresenceSignal): {
  icon: Extract<SymbolViewProps["name"], string>;
  background: ViewStyle["backgroundColor"];
} {
  if (signal.kind === "activity") {
    return {
      icon: signal.category === "meal" ? "fork.knife" : "figure.run",
      background: colors.purple,
    };
  }
  return signal.kind === "in"
    ? { icon: "arrow.right.to.line", background: colors.accent }
    : { icon: "arrow.left.to.line", background: colors.warning };
}

/**
 * The action panel revealed by swiping a card left, matching the OS
 * notification center's swipe-to-clear gesture: the whole card slides as one
 * layer (Swipeable's own transform on its child) to uncover these buttons —
 * they're at full opacity from the first pixel of drag, never fading in
 * separately, so nothing ever looks like it's floating above them.
 */
function SignalCardActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const { t } = useLocale();
  return (
    <View style={{ flexDirection: "row", height: "100%" }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("edit")}
        onPress={() => {
          void haptic("light");
          onEdit();
        }}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: colors.accent,
          height: "100%",
          justifyContent: "center",
          opacity: pressed ? 0.75 : 1,
          width: 74,
        })}
      >
        <SymbolView name="pencil" tintColor="white" size={18} accessible={false} />
        <Text style={{ color: "white", fontSize: 12, fontWeight: "700", marginTop: 4 }}>
          {t("edit")}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("delete")}
        onPress={() => {
          void haptic("warning");
          onDelete();
        }}
        style={({ pressed }) => ({
          alignItems: "center",
          backgroundColor: colors.destructive,
          height: "100%",
          justifyContent: "center",
          opacity: pressed ? 0.75 : 1,
          width: 74,
        })}
      >
        <SymbolView name="trash.fill" tintColor="white" size={18} accessible={false} />
        <Text style={{ color: "white", fontSize: 12, fontWeight: "700", marginTop: 4 }}>
          {t("delete")}
        </Text>
      </Pressable>
    </View>
  );
}

function SignalCard({
  signal,
  window,
  language,
  onEdit,
  onDelete,
}: {
  signal: PresenceSignal;
  window: CertaintyWindow | null;
  language: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLocale();
  const title =
    signal.kind === "activity"
      ? (signal.activityName ?? t("presenceSignalActivity"))
      : signal.kind === "in"
        ? t("presenceSignalEntry")
        : t("presenceSignalExit");
  const { icon, background } = iconForSignal(signal);
  const recordedBy = signal.recordedBy
    ? [signal.recordedBy.name, signal.recordedBy.surname].filter(Boolean).join(" ")
    : null;

  // The status pill only shows for outcomes that need a second look — any
  // secured window (whether it reached the full duration or not) gets none.
  const status = !window
    ? null
    : window.conflict
      ? { label: t("presenceConflict"), tone: "destructive" as const }
      : window.status === "invalid"
        ? { label: t("presenceInvalid"), tone: "destructive" as const }
        : null;

  // Never hardcoded: both sides of the meter come straight from this
  // window's own start/deadline/securedUntil instants, so a config change to
  // the certainty-window duration is reflected automatically, including for
  // windows opened under a since-changed policy.
  const totalMinutes = window ? durationMinutes(window.start, window.deadline) : 0;
  const elapsedMinutes = !window
    ? 0
    : window.status === "invalid"
      ? 0
      : window.securedUntil
        ? durationMinutes(window.start, window.securedUntil)
        : durationMinutes(window.start, new Date().toISOString());
  const meterFraction = totalMinutes > 0 ? Math.min(1, elapsedMinutes / totalMinutes) : 0;
  const showHint = window?.status === "provisional" && elapsedMinutes === 0;

  return (
    <View style={{ borderCurve: "continuous", borderRadius: 14, overflow: "hidden" }}>
      <Swipeable
        renderRightActions={() => <SignalCardActions onEdit={onEdit} onDelete={onDelete} />}
        rightThreshold={40}
        overshootRight={false}
      >
        <View style={{ backgroundColor: colors.surface, gap: 8, padding: 16 }}>
          <View style={{ alignItems: "flex-start", flexDirection: "row", gap: 12 }}>
            <View
              style={{
                alignItems: "center",
                backgroundColor: background,
                borderCurve: "continuous",
                borderRadius: 8,
                height: 30,
                justifyContent: "center",
                width: 30,
              }}
            >
              <SymbolView name={icon} tintColor="white" size={15} accessible={false} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                selectable
                numberOfLines={1}
                style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}
              >
                {title}
              </Text>
              {recordedBy ? (
                <Text
                  selectable
                  numberOfLines={1}
                  style={{ color: colors.tertiaryLabel, fontSize: 12, marginTop: 1 }}
                >
                  {t("presenceRecordedBy", { name: recordedBy })}
                </Text>
              ) : signal.recordedBy == null ? (
                <Text
                  selectable
                  numberOfLines={1}
                  style={{ color: colors.tertiaryLabel, fontSize: 12, marginTop: 1 }}
                >
                  {t("presenceRecordedBySystem")}
                </Text>
              ) : null}
            </View>
            <Text
              style={{
                color: colors.secondaryLabel,
                fontSize: 15,
                fontVariant: ["tabular-nums"],
              }}
            >
              {fmtTime(new Date(signal.occurredAt), language)}
            </Text>
          </View>

          <View style={{ gap: 8, marginLeft: 42 }}>
            {window ? (
              <View style={{ alignItems: "center", flexDirection: "row", gap: 10 }}>
                <View
                  style={{
                    backgroundColor: colors.elevatedSurface,
                    borderCurve: "continuous",
                    borderRadius: 999,
                    flex: 1,
                    height: 4,
                    overflow: "hidden",
                  }}
                >
                  {window.status === "invalid" ? null : (
                    <View
                      style={{
                        backgroundColor:
                          window.status === "provisional" ? colors.accent : colors.success,
                        height: "100%",
                        width: `${meterFraction * 100}%`,
                      }}
                    />
                  )}
                </View>
                {status ? (
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                ) : (
                  <Text
                    style={{
                      color: colors.secondaryLabel,
                      fontSize: 13,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {t("presenceMeterLabel", {
                      elapsed: elapsedMinutes === 0 ? "0" : formatMinutes(elapsedMinutes, t),
                      total: formatMinutes(totalMinutes, t),
                    })}
                  </Text>
                )}
              </View>
            ) : null}

            {showHint ? (
              <View style={{ alignItems: "center", flexDirection: "row", gap: 6 }}>
                <SymbolView name="clock" tintColor={colors.accent} size={13} accessible={false} />
                <Text style={{ color: colors.accent, flex: 1, fontSize: 12 }}>
                  {t("presenceSecureTimeHint")}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Swipeable>
    </View>
  );
}

/** Maps the editor's draft state to the right queue-backed create/edit payload. */
function buildDraftPayload(draft: SignalDraft, userId: number, notes: string | null): ScanPayload {
  const occurredAt = draft.occurredAt.toISOString();
  if (!draft.signal) {
    return draft.kind === "activity"
      ? {
          kind: "presence_signal_activity",
          userId,
          // Guarded by the caller: `presenceActivityRequired` blocks save()
          // before this runs if no activity is chosen yet.
          activityId: draft.activityId as number,
          occurredAt,
          notes,
        }
      : { kind: "presence_signal", userId, direction: draft.kind, occurredAt, notes };
  }
  if (draft.signal.source === "activity") {
    return {
      kind: "presence_signal_edit_activity",
      logId: draft.signal.id,
      activityId: draft.activityId ?? undefined,
      occurredAt,
      notes,
    };
  }
  // An existing door signal only ever swaps entry↔exit (never becomes
  // "activity") — see the `kinds` list below, which restricts this case to
  // ["in", "out"].
  const direction = draft.kind === "activity" ? undefined : draft.kind;
  return {
    kind: "presence_signal_edit_door",
    logId: draft.signal.id,
    direction,
    occurredAt,
    notes,
  };
}

function SignalEditor({
  activities,
  draft,
  onChange,
  onClose,
  onSaved,
  ownerUserId,
  sync,
  userId,
}: {
  activities: PresenceTimeline["activities"];
  draft: SignalDraft;
  onChange: (draft: SignalDraft) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
  ownerUserId: number | undefined;
  sync: { sync: () => Promise<void> };
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
    if (ownerUserId === undefined) return;
    setSaving(true);
    setError(null);
    const notes = draft.notes.trim() || null;
    try {
      const scanId = await enqueueLocalScan(buildDraftPayload(draft, userId, notes), ownerUserId);
      await sync.sync();
      const stored = (await pendingScans(ownerUserId)).find((scan) => scan.id === scanId);
      if (stored?.status === "failed") {
        setError(stored.lastError ?? t("presenceCouldNotSave"));
        return;
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  // An activity-sourced signal always stays an activity — only which
  // activity it belongs to can change, so there's nothing to pick here.
  const isLockedToActivity = draft.signal?.source === "activity";
  // Editing a door-sourced signal only ever swaps entry↔exit; conversion to
  // an activity point is only offered when creating a brand-new signal.
  const kinds: SignalKind[] = !draft.signal ? ["in", "activity", "out"] : ["in", "out"];
  const kindLabels: Record<SignalKind, string> = {
    in: t("presenceSignalEntry"),
    activity: t("presenceSignalActivity"),
    out: t("presenceSignalExit"),
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

          {isLockedToActivity ? null : (
            <View>
              <Text
                selectable
                accessibilityRole="header"
                style={{
                  color: colors.secondaryLabel,
                  fontSize: 13,
                  fontWeight: "600",
                  paddingHorizontal: 16,
                }}
              >
                {t("personMovement")}
              </Text>
              <SegmentedControl
                label={t("personMovement")}
                values={kinds.map((kind) => kindLabels[kind])}
                selectedIndex={Math.max(0, kinds.indexOf(draft.kind))}
                onChange={(index) => onChange({ ...draft, kind: kinds[index] ?? kinds[0] ?? "in" })}
              />
            </View>
          )}

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

          <Section title={t("presenceDateAndTime")}>
            <View style={{ gap: 12, padding: 16 }}>
              <DateTimeField
                dateAccessibilityLabel={t("presenceDateField")}
                timeAccessibilityLabel={t("presenceTimeField")}
                maximumDate={new Date()}
                value={draft.occurredAt}
                onChange={(date) => onChange({ ...draft, occurredAt: date })}
              />
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

export function formatMinutes(minutes: number, t: ReturnType<typeof useLocale>["t"]): string {
  if (minutes < 60) return t("presenceMinutesValue", { minutes: String(minutes) });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0
    ? t("presenceWholeHoursValue", { hours: String(hours) })
    : t("presenceHoursMinutesValue", { hours: String(hours), minutes: String(remainder) });
}
