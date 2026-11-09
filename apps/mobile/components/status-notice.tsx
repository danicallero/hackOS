import { useIsFocused } from "expo-router";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, View } from "react-native";
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
        marginBottom: 14,
        minHeight: 40,
        paddingHorizontal: 14,
        paddingVertical: 10,
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

// One offline notice per visible screen, however many requests on it failed.
const owners: number[] = [];
const listeners = new Set<() => void>();
let nextId = 0;
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
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

function useIsOfflineNoticeOwner(): boolean {
  const id = useRef(++nextId).current;
  const focused = useScreenFocused();
  useEffect(() => {
    if (!focused) return;
    owners.push(id);
    emit();
    return () => {
      owners.splice(owners.indexOf(id), 1);
      emit();
    };
  }, [focused, id]);
  return useSyncExternalStore(
    subscribe,
    () => owners[0] === id,
    () => true,
  );
}

/** Offline: scanning and cached data keep working. Not an error, so never red. */
export function OfflineNotice({
  updatedAt,
  onReconnect,
}: {
  updatedAt?: string | null;
  onReconnect?: () => Promise<boolean | undefined> | boolean | undefined | void;
}) {
  const { language, t } = useLocale();
  const owner = useIsOfflineNoticeOwner();
  if (!owner) return null;
  return (
    <StatusNotice
      tone="offline"
      icon="wifi.slash"
      text={
        updatedAt
          ? t("offlineModeUpdated", { updatedAt: formatLastUpdate(updatedAt, language, t) })
          : t("offlineMode")
      }
      actionLabel={t("offlineReconnect")}
      onAction={onReconnect}
    />
  );
}

/** A real failure (the server answered, or the request could not be served). */
export function ErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => Promise<boolean | undefined> | boolean | undefined | void;
}) {
  const { t } = useLocale();
  return (
    <StatusNotice
      tone="error"
      icon="exclamationmark.circle.fill"
      text={message}
      actionLabel={t("retry")}
      onAction={onRetry}
    />
  );
}
