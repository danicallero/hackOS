import { useIsFocused } from "expo-router";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, useColorScheme, View } from "react-native";
import { AppActivityIndicator } from "@/components/app-activity-indicator";
import { AppText as Text } from "@/components/app-text";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { formatLastUpdate } from "@/lib/format-date";
import { useLocale } from "@/lib/i18n";
import { radius, type } from "@/theme";
import { colors } from "@/theme/colors";

const FAILED_VISIBLE_MS = 3000;
// An instant failure must still look like an attempt.
const MIN_ATTEMPT_MS = 500;

type Tone = "offline" | "error";
type Attempt = "idle" | "loading" | "failed";
type Action = () => Promise<boolean | undefined> | boolean | undefined | void;

// A retry outlives the notice that started it: when the screen clears its error to
// reload and the notice remounts on a repeated failure, it resumes the spinner or
// the cross instead of resetting (the reset is what flickered).
const attempts = new Map<string, Attempt>();
const attemptListeners = new Set<() => void>();
const emitAttempts = () => {
  for (const listener of attemptListeners) listener();
};
const subscribeAttempts = (listener: () => void) => {
  attemptListeners.add(listener);
  return () => {
    attemptListeners.delete(listener);
  };
};

/** Test helper: forget in-flight and failed retries between tests. */
export function resetStatusNoticeAttempts() {
  attempts.clear();
  emitAttempts();
}

async function runAttempt(key: string, action: Action) {
  if (attempts.has(key)) return;
  attempts.set(key, "loading");
  emitAttempts();
  const [ok] = await Promise.all([
    Promise.resolve()
      .then(action)
      .then(
        (result) => result !== false,
        () => false,
      ),
    new Promise((resolve) => setTimeout(resolve, MIN_ATTEMPT_MS)),
  ]);
  if (ok) {
    attempts.delete(key);
  } else {
    attempts.set(key, "failed");
    setTimeout(() => {
      attempts.delete(key);
      emitAttempts();
    }, FAILED_VISIBLE_MS);
  }
  emitAttempts();
}

/**
 * The app's one status line for a failed or unreachable load: a full-width capsule
 * with an icon, a short message and a trailing action. The action swaps in place
 * (same width, no animation) between its label, a spinner while it runs and a red
 * cross if it fails.
 */
function StatusNotice({
  tone,
  icon,
  text,
  actionLabel,
  onAction,
}: {
  tone: Tone;
  icon: SymbolViewProps["name"];
  text: string;
  actionLabel: string;
  /** Resolve `false` (or reject) when the attempt failed; anything else counts as done. */
  onAction?: Action;
}) {
  // The theme tokens are module-level: subscribe so a live light/dark switch repaints the notice.
  useColorScheme();
  const key = `${tone}:${text}`;
  const state = useSyncExternalStore(
    subscribeAttempts,
    () => attempts.get(key) ?? "idle",
    () => "idle" as Attempt,
  );

  const error = tone === "error";
  const color = error ? colors.onDestructiveSurface : colors.secondaryLabel;
  const textStyle = [type.footnote, { color }];
  return (
    <View
      accessibilityLiveRegion={error ? "assertive" : "polite"}
      accessibilityRole={error ? "alert" : undefined}
      style={{
        alignItems: "center",
        alignSelf: "stretch",
        backgroundColor: error ? colors.destructiveSurface : colors.hover,
        borderCurve: "continuous",
        borderRadius: radius.sheet,
        flexDirection: "row",
        gap: 8,
        marginBottom: 4,
        minHeight: 36,
        paddingHorizontal: 14,
        paddingVertical: 8,
      }}
    >
      <SymbolView name={icon} size={14} tintColor={color} accessible={false} />
      <Text selectable style={[textStyle, { flex: 1 }]}>
        {text}
      </Text>
      {onAction ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          accessibilityState={{ busy: state === "loading" }}
          disabled={state !== "idle"}
          hitSlop={8}
          onPress={() => void runAttempt(key, onAction)}
          style={{ alignItems: "center", justifyContent: "center" }}
        >
          <Text style={[textStyle, { fontWeight: "600", opacity: state === "idle" ? 1 : 0 }]}>
            {actionLabel}
          </Text>
          {state === "loading" ? (
            <View pointerEvents="none" style={styles.overlay}>
              <AppActivityIndicator size={14} />
            </View>
          ) : null}
          {state === "failed" ? (
            <View pointerEvents="none" style={styles.overlay}>
              <SymbolView name="xmark.circle.fill" size={14} tintColor={colors.destructive} />
            </View>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});

// One notice per visible screen, however many requests failed. Every mounted notice
// registers here; a single one renders, and when the device is offline it speaks for
// the failed loads too (no connection is their cause), its action retrying them all.
interface Slot {
  id: number;
  tone: Tone;
  icon: SymbolViewProps["name"];
  text: string;
  actionLabel: string;
  action: { current?: Action };
}
const slots: Slot[] = [];
const slotListeners = new Set<() => void>();
let slotVersion = 0;
let nextId = 0;
const emitSlots = () => {
  slotVersion += 1;
  for (const listener of slotListeners) listener();
};
const subscribeSlots = (listener: () => void) => {
  slotListeners.add(listener);
  return () => {
    slotListeners.delete(listener);
  };
};

function useScreenFocused(): boolean {
  try {
    // biome-ignore lint/correctness/useHookAtTopLevel: the hook throws outside a navigator; the throw is deterministic per mount.
    return useIsFocused();
  } catch {
    // Outside a navigator (tests, overlays): always visible.
    return true;
  }
}

/** Registers a notice and returns what (if anything) this instance should render. */
function useNoticeSlot(slot: Omit<Slot, "id" | "action"> & { action?: Action }): {
  tone: Tone;
  icon: SymbolViewProps["name"];
  text: string;
  actionLabel: string;
  action?: Action;
} | null {
  const id = useRef(++nextId).current;
  const focused = useScreenFocused();
  const action = useRef<Action | undefined>(slot.action);
  action.current = slot.action;
  const { tone, icon, text, actionLabel } = slot;
  // Layout effect: registered and re-rendered before paint, so returning to a screen never
  // shows a frame without its notice (that frame was the jump).
  useLayoutEffect(() => {
    if (!focused) return;
    const entry: Slot = { id, tone, icon, text, actionLabel, action };
    slots.push(entry);
    emitSlots();
    return () => {
      slots.splice(slots.indexOf(entry), 1);
      emitSlots();
    };
  }, [focused, id, tone, icon, text, actionLabel]);
  useSyncExternalStore(
    subscribeSlots,
    () => slotVersion,
    () => 0,
  );
  const owner = slots.find((entry) => entry.tone === "offline") ?? slots[0];
  if (!owner) return null;
  // The representative's own element renders it; the rest stay silent.
  const representative = slots.find((entry) => entry.tone === owner.tone) ?? owner;
  if (representative.id !== id) return null;
  const actions = slots.map((entry) => entry.action);
  const anyAction = actions.some((ref) => ref.current);
  return {
    tone: representative.tone,
    icon: representative.icon,
    text: representative.text,
    actionLabel: representative.actionLabel,
    action: anyAction
      ? async () => {
          const results = await Promise.all(
            actions.map((ref) => Promise.resolve().then(() => ref.current?.())),
          );
          return results.every((result) => result !== false);
        }
      : undefined,
  };
}

/** Offline: scanning and cached data keep working. Not an error, so never red. */
export function OfflineNotice({
  updatedAt,
  onReconnect,
}: {
  updatedAt?: string | null;
  onReconnect?: Action;
}) {
  const { language, t } = useLocale();
  const view = useNoticeSlot({
    tone: "offline",
    icon: "wifi.slash",
    text: updatedAt
      ? t("offlineModeUpdated", { updatedAt: formatLastUpdate(updatedAt, language, t) })
      : t("offlineMode"),
    actionLabel: t("offlineReconnect"),
    action: onReconnect,
  });
  return view ? <StatusNotice {...view} onAction={view.action} /> : null;
}

/** A neutral, action-less line for a state the person cannot change (never red, never retried). */
export function InfoNotice({ icon, text }: { icon: SymbolViewProps["name"]; text: string }) {
  return <StatusNotice tone="offline" icon={icon} text={text} actionLabel="" />;
}

/** A real failure (the server answered, or the request could not be served). */
export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: Action }) {
  const { t } = useLocale();
  const view = useNoticeSlot({
    tone: "error",
    icon: "exclamationmark.circle.fill",
    text: message,
    actionLabel: t("retry"),
    action: onRetry,
  });
  return view ? <StatusNotice {...view} onAction={view.action} /> : null;
}
