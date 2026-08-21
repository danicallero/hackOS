import { isMealActivityKind } from "@hackos/shared/activity-kinds";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  View as NativeView,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from "react-native";
import { QrCamera } from "@/components/QrCamera";
import { Text, View } from "@/components/Themed";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import {
  enqueueLocalScan,
  findPersonByBadge,
  findPersonByTicket,
  getActivityState,
  listScannerActivities,
  pendingScans,
} from "@/lib/scanner-db";
import type { ScannerActivity, ScannerPerson } from "@/lib/scanner-types";
import { useScannerSync } from "@/lib/use-scanner";
import { colors } from "@/theme/colors";

type Mode = "accreditation" | "badge" | "presence" | "activity";

export default function ScanScreen() {
  const { t } = useLocale();
  const { me } = useMeContext();
  const syncState = useScannerSync();
  const capabilities = new Set(me?.capabilities ?? []);
  const admin = capabilities.has("*");
  const canAccredit = admin || capabilities.has(CAPABILITIES.ACCREDIT_SCAN);
  const canPresence = admin || capabilities.has(CAPABILITIES.PRESENCE_SCAN);
  const canActivity = admin || capabilities.has(CAPABILITIES.ACTIVITY_SCAN);
  const modes: Mode[] = [];
  if (canAccredit) modes.push("accreditation", "badge");
  if (canPresence) modes.push("presence");
  if (canActivity) modes.push("activity");
  const [mode, setMode] = useState<Mode>(modes[0] ?? "accreditation");
  const activeMode = modes.includes(mode) ? mode : (modes[0] ?? "accreditation");
  const [cameraSetter, setCameraSetter] = useState<((value: string) => void) | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.background }}
    >
      <NativeView style={styles.syncRow}>
        <Text style={styles.syncText}>
          {syncState.lastSync
            ? t("scannerLastSync", { time: new Date(syncState.lastSync).toLocaleString() })
            : t("scannerNeverSynced")}
        </Text>
        <Button
          title={syncState.syncing ? t("scannerSyncing") : t("scannerSync")}
          disabled={syncState.syncing}
          onPress={() => {
            void haptic("light");
            void syncState.sync();
          }}
        />
      </NativeView>
      {syncState.error ? <Text style={styles.error}>{syncState.error.message}</Text> : null}

      <NativeView style={styles.modeRow}>
        {modes.map((candidate) => (
          <Pressable
            key={candidate}
            accessibilityRole="button"
            accessibilityState={{ selected: candidate === activeMode }}
            onPress={() => {
              void haptic("selection");
              setMode(candidate);
              setMessage(null);
            }}
            style={[styles.modeButton, candidate === activeMode && styles.modeSelected]}
          >
            <Text style={candidate === activeMode ? styles.modeSelectedText : undefined}>
              {candidate === "accreditation"
                ? t("scannerAccreditation")
                : candidate === "badge"
                  ? t("scannerBadge")
                  : candidate === "presence"
                    ? t("scannerPresence")
                    : t("scannerMeals")}
            </Text>
          </Pressable>
        ))}
      </NativeView>

      {cameraSetter ? (
        <QrCamera
          onClose={() => setCameraSetter(null)}
          onValue={(value) => {
            cameraSetter(value);
            setCameraSetter(null);
          }}
        />
      ) : activeMode === "accreditation" ? (
        <AccreditationForm
          setCameraSetter={setCameraSetter}
          afterSubmit={async (value) => {
            setMessage(value);
            await syncState.sync();
          }}
        />
      ) : activeMode === "badge" ? (
        <BadgeRotationForm
          setCameraSetter={setCameraSetter}
          afterSubmit={async (value) => {
            setMessage(value);
            await syncState.sync();
          }}
        />
      ) : activeMode === "presence" ? (
        <PresenceForm
          setCameraSetter={setCameraSetter}
          afterSubmit={async (value) => {
            setMessage(value);
            await syncState.sync();
          }}
        />
      ) : (
        <ActivityForm
          setCameraSetter={setCameraSetter}
          afterSubmit={async (value) => {
            setMessage(value);
            await syncState.sync();
          }}
        />
      )}

      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {message}
        </Text>
      ) : null}
      <QueuePanel queue={syncState.queue} onRetry={() => void syncState.retryFailed()} />
    </ScrollView>
  );
}

function ScanField({
  label,
  value,
  onChange,
  setCameraSetter,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  setCameraSetter: (setter: ((value: string) => void) | null) => void;
}) {
  const { t } = useLocale();
  return (
    <NativeView style={styles.field}>
      <Text>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        value={value}
        onChangeText={onChange}
        style={styles.input}
      />
      <Button
        title={t("scannerCamera")}
        onPress={() => {
          void haptic("light");
          setCameraSetter(() => onChange);
        }}
      />
    </NativeView>
  );
}

function PersonCard({ person }: { person: ScannerPerson }) {
  const { t, language } = useLocale();
  return (
    <View style={styles.card}>
      <Text style={styles.personName}>
        {[person.name, person.surname].filter(Boolean).join(" ")}
      </Text>
      <Text>{person.confirmed ? t("scannerConfirmed") : t("scannerUnconfirmed")}</Text>
      {person.intolerances.map((item) => (
        <Text key={item.id} style={styles.warning}>
          ⚠ {item.label[language] ?? item.label.en}
        </Text>
      ))}
      {person.foodIntoleranceNotes ? (
        <Text style={styles.warning}>{person.foodIntoleranceNotes}</Text>
      ) : null}
      {person.notes ? <Text>{person.notes}</Text> : null}
    </View>
  );
}

function AccreditationForm({ setCameraSetter, afterSubmit }: FormProps) {
  const { t } = useLocale();
  const { me } = useMeContext();
  const ownerUserId = me?.id;
  const [ticket, setTicket] = useState("");
  const [badge, setBadge] = useState("");
  const [person, setPerson] = useState<ScannerPerson | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = async () => {
    const found = await findPersonByTicket(ticket.trim());
    setPerson(found);
    setError(found ? null : t("scannerUnknownTicket"));
  };
  const submit = async () => {
    if (!person || !ticket.trim() || !badge.trim() || ownerUserId === undefined) return;
    const id = await enqueueLocalScan(
      {
        kind: "accreditation",
        ticketToken: ticket.trim(),
        badgeId: badge.trim(),
        method: "qr",
      },
      ownerUserId,
    );
    void haptic("light");
    await afterSubmit(t("scannerAccreditationPending"));
    // Live retry: this flow deliberately waits for a real server OK before
    // displaying success, while SQLite keeps the mutation across restarts.
    const stored = (await pendingScans(ownerUserId)).find((scan) => scan.id === id);
    if (stored?.status === "acknowledged") {
      void haptic("success");
      await afterSubmit(t("scannerAcknowledged"));
    } else if (stored?.status === "failed") {
      void haptic("error");
      await afterSubmit(stored.lastError ?? t("scannerAccreditationPending"));
    } else {
      await afterSubmit(t("scannerAccreditationPending"));
    }
  };

  return (
    <View style={styles.section}>
      <ScanField
        label={t("scannerTicket")}
        value={ticket}
        onChange={setTicket}
        setCameraSetter={setCameraSetter}
      />
      <Button title={t("scannerLookup")} onPress={() => void lookup()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {person ? <PersonCard person={person} /> : null}
      {person ? (
        <>
          <ScanField
            label={t("scannerBadgeId")}
            value={badge}
            onChange={setBadge}
            setCameraSetter={setCameraSetter}
          />
          <Button
            title={t("scannerConfirmAccreditation")}
            disabled={!badge.trim()}
            onPress={() => void submit()}
          />
        </>
      ) : null}
    </View>
  );
}

function BadgeRotationForm({ setCameraSetter, afterSubmit }: FormProps) {
  const { t } = useLocale();
  const { me } = useMeContext();
  const ownerUserId = me?.id;
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [reason, setReason] = useState("");
  const [person, setPerson] = useState<ScannerPerson | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = async () => {
    const result = await findPersonByBadge(current.trim());
    setPerson(result.person);
    setError(
      result.revoked ? t("scannerRevokedBadge") : result.person ? null : t("scannerUnknownBadge"),
    );
  };
  const submit = async () => {
    if (!person || !current.trim() || !next.trim() || !reason.trim() || ownerUserId === undefined)
      return;
    await enqueueLocalScan(
      {
        kind: "badge_rotation",
        userId: person.userId,
        currentBadgeId: current.trim(),
        newBadgeId: next.trim(),
        reason: reason.trim(),
      },
      ownerUserId,
    );
    void haptic("light");
    await afterSubmit(t("scannerPendingAck"));
  };
  return (
    <View style={styles.section}>
      <ScanField
        label={t("scannerCurrentBadge")}
        value={current}
        onChange={setCurrent}
        setCameraSetter={setCameraSetter}
      />
      <Button title={t("scannerLookup")} onPress={() => void lookup()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {person ? <PersonCard person={person} /> : null}
      {person ? (
        <>
          <ScanField
            label={t("scannerNewBadge")}
            value={next}
            onChange={setNext}
            setCameraSetter={setCameraSetter}
          />
          <TextInput
            accessibilityLabel={t("scannerReason")}
            placeholder={t("scannerReason")}
            value={reason}
            onChangeText={setReason}
            style={styles.input}
          />
          <Button
            title={t("scannerRotate")}
            disabled={!next.trim() || !reason.trim()}
            onPress={() => void submit()}
          />
        </>
      ) : null}
    </View>
  );
}

function PresenceForm({ setCameraSetter, afterSubmit }: FormProps) {
  const { t } = useLocale();
  const { me } = useMeContext();
  const ownerUserId = me?.id;
  const [badge, setBadge] = useState("");
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [backdated, setBackdated] = useState("");
  const [person, setPerson] = useState<ScannerPerson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lookup = async () => {
    const result = await findPersonByBadge(badge.trim());
    setPerson(result.person);
    setError(
      result.revoked ? t("scannerRevokedBadge") : result.person ? null : t("scannerUnknownBadge"),
    );
  };
  const submit = async () => {
    const parsed = backdated.trim() ? new Date(backdated.trim()) : new Date();
    if (!person || Number.isNaN(parsed.getTime()) || ownerUserId === undefined) return;
    const id = await enqueueLocalScan(
      {
        kind: "presence",
        badgeId: badge.trim(),
        direction,
        scannedAt: parsed.toISOString(),
      },
      ownerUserId,
    );
    void haptic("light");
    await afterSubmit(t("scannerPendingAck"));
    // A 4xx replay (entry with a session already open, exit with none) fails
    // the queued scan permanently — surface the server's reason instead of
    // leaving the rejection buried in the queue panel.
    const stored = (await pendingScans(ownerUserId)).find((scan) => scan.id === id);
    if (stored?.status === "failed") {
      void haptic("error");
      await afterSubmit(stored.lastError ?? t("presenceScanRejectedBody"));
    } else if (stored?.status === "acknowledged") {
      void haptic("success");
      await afterSubmit(t("scannerAcknowledged"));
    } else {
      await afterSubmit(t("scannerPendingAck"));
    }
  };
  return (
    <View style={styles.section}>
      <ScanField
        label={t("scannerBadgeId")}
        value={badge}
        onChange={setBadge}
        setCameraSetter={setCameraSetter}
      />
      <Button title={t("scannerLookup")} onPress={() => void lookup()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {person ? <PersonCard person={person} /> : null}
      <NativeView style={styles.modeRow}>
        {(["in", "out"] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="button"
            accessibilityState={{ selected: direction === value }}
            onPress={() => {
              void haptic("selection");
              setDirection(value);
            }}
            style={[styles.modeButton, direction === value && styles.modeSelected]}
          >
            <Text style={direction === value ? styles.modeSelectedText : undefined}>
              {value === "in" ? t("scannerIn") : t("scannerOut")}
            </Text>
          </Pressable>
        ))}
      </NativeView>
      <TextInput
        accessibilityLabel={t("scannerBackdated")}
        placeholder={t("scannerBackdated")}
        value={backdated}
        onChangeText={setBackdated}
        style={styles.input}
      />
      <Button title={t("scannerRegister")} disabled={!person} onPress={() => void submit()} />
    </View>
  );
}

function ActivityForm({ setCameraSetter, afterSubmit }: FormProps) {
  const { t } = useLocale();
  const { me } = useMeContext();
  const ownerUserId = me?.id;
  const [activities, setActivities] = useState<ScannerActivity[]>([]);
  const [selected, setSelected] = useState<ScannerActivity | null>(null);
  const [badge, setBadge] = useState("");
  const [person, setPerson] = useState<ScannerPerson | null>(null);
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void listScannerActivities().then(setActivities);
  }, []);
  const lookup = async () => {
    const result = await findPersonByBadge(badge.trim());
    setPerson(result.person);
    if (result.revoked) return setError(t("scannerRevokedBadge"));
    if (!result.person) return setError(t("scannerUnknownBadge"));
    if (!selected) return setError(t("scannerSelectActivity"));
    const state = await getActivityState(result.person.userId, selected.id);
    setCount(state.count);
    setError(null);
  };
  const submitWithRepeat = async (allowRepeat: boolean) => {
    if (!person || !selected || error || ownerUserId === undefined) return;
    await enqueueLocalScan(
      {
        kind: "activity",
        activityId: selected.id,
        badgeId: badge.trim(),
        allowRepeat,
        scannedAt: new Date().toISOString(),
      },
      ownerUserId,
    );
    void haptic("light");
    setCount((value) => value + 1);
    await afterSubmit(t("scannerPendingAck"));
  };
  const submit = async () => {
    // Any repeat — meal or registrable activity — needs explicit confirmation
    // (H25/H26): the API 409s repeats sent without allowRepeat.
    if (count > 0) {
      Alert.alert(
        isMealActivityKind(selected?.category) ? t("scannerRepeatTitle") : t("scannerRepeatFound"),
        t("scannerRepeatBody", { count: String(count) }),
        [
          { text: t("cancel"), style: "cancel" },
          { text: t("confirm"), onPress: () => void submitWithRepeat(true) },
        ],
      );
      return;
    }
    await submitWithRepeat(false);
  };
  return (
    <View style={styles.section}>
      <Text>{t("scannerSelectActivity")}</Text>
      <NativeView style={styles.activityList}>
        {activities.map((activity) => (
          <Pressable
            key={activity.id}
            accessibilityRole="button"
            accessibilityState={{ selected: selected?.id === activity.id }}
            onPress={() => {
              void haptic("selection");
              setSelected(activity);
              setError(null);
              setPerson(null);
            }}
            style={[styles.activityButton, selected?.id === activity.id && styles.modeSelected]}
          >
            <Text style={selected?.id === activity.id ? styles.modeSelectedText : undefined}>
              {activity.name}
            </Text>
          </Pressable>
        ))}
      </NativeView>
      <ScanField
        label={t("scannerBadgeId")}
        value={badge}
        onChange={setBadge}
        setCameraSetter={setCameraSetter}
      />
      <Button title={t("scannerLookup")} onPress={() => void lookup()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {person ? <PersonCard person={person} /> : null}
      {person ? <Text>{t("scannerAlreadyCount", { count: String(count) })}</Text> : null}
      <Button
        title={t("scannerRegister")}
        disabled={!person || !selected || Boolean(error)}
        onPress={() => void submit()}
      />
    </View>
  );
}

type FormProps = {
  setCameraSetter: (setter: ((value: string) => void) | null) => void;
  afterSubmit: (message: string) => Promise<void>;
};

function QueuePanel({
  queue,
  onRetry,
}: {
  queue: Awaited<ReturnType<typeof pendingScans>>;
  onRetry: () => void;
}) {
  const { t } = useLocale();
  const failed = queue.some((scan) => scan.status === "failed");
  return (
    <View style={styles.queuePanel}>
      <Text style={styles.heading}>{t("scannerQueue")}</Text>
      {queue.length === 0 ? (
        <Text>{t("scannerNoQueue")}</Text>
      ) : (
        queue
          .slice(-10)
          .reverse()
          .map((scan) => (
            <NativeView key={scan.id} style={styles.queueItem}>
              <Text>
                {scan.kind} · {scan.status} · {scan.attempts}
              </Text>
              {scan.lastError ? <Text style={styles.error}>{scan.lastError}</Text> : null}
            </NativeView>
          ))
      )}
      {failed ? <Button title={t("scannerRetryFailed")} onPress={onRetry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  syncRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  syncText: { flex: 1, opacity: 0.7, fontSize: 12 },
  modeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modeButton: {
    borderWidth: 1,
    borderColor: colors.separator,
    borderCurve: "continuous",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  modeSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  modeSelectedText: { color: colors.accentText },
  section: {
    gap: 12,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    borderCurve: "continuous",
    borderRadius: 12,
  },
  field: { gap: 6 },
  input: {
    borderWidth: 1,
    borderColor: colors.separator,
    borderCurve: "continuous",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.label,
    backgroundColor: colors.surface,
  },
  card: {
    gap: 5,
    padding: 12,
    borderCurve: "continuous",
    borderRadius: 8,
    backgroundColor: colors.accentSurface,
  },
  personName: { fontSize: 18, fontWeight: "600" },
  warning: { color: colors.warning, fontWeight: "600" },
  error: { color: colors.destructive },
  message: {
    fontWeight: "600",
    padding: 12,
    borderCurve: "continuous",
    borderRadius: 8,
    backgroundColor: colors.successSurface,
  },
  activityList: { gap: 7 },
  activityButton: {
    borderWidth: 1,
    borderColor: colors.separator,
    borderCurve: "continuous",
    borderRadius: 8,
    padding: 10,
  },
  queuePanel: { gap: 10, paddingTop: 8 },
  heading: { fontSize: 18, fontWeight: "600" },
  queueItem: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.separator,
    paddingVertical: 8,
    gap: 3,
  },
});
