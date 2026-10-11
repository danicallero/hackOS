import { EVENTS } from "@hackos/shared/events";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { subscribeToServerEvent } from "@/lib/server-events";
import { registerSignOutListener } from "@/lib/sign-out-events";
import { liveActivityHost } from "./host";
import { type DesiredActivity, nextPhaseBoundary } from "./model";
import { reconcileLiveActivities, registerLiveActivityDevice, signOutLiveActivities } from "./sync";

/** Coalesces bursts of queue events into one read. */
const EVENT_DEBOUNCE_MS = 1_000;
/** A live staff counter refreshes this often while the app is open; APNs covers the rest. */
const LIVE_COUNTER_REFRESH_MS = 60_000;

/**
 * Drives the Live Activity orchestration from the root layout (#966): device
 * registration after sign-in, a reconcile on foreground, on the personal
 * queue events (H38) and at the next staff start/end boundary, and cleanup
 * on sign-out. Background delivery is the server's job (APNs / data pushes).
 */
export function useLiveActivities({
  signedIn,
  userId,
  language,
}: {
  signedIn: boolean;
  userId: number | null;
  language: string;
}) {
  const boundaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = signedIn && liveActivityHost.platform !== null;

  useEffect(
    () =>
      // Returned so the sign-out flow revokes the session only after the
      // device's delivery was switched off with it.
      registerSignOutListener(() => signOutLiveActivities()),
    [],
  );

  // Re-runs per account: a different user on this device re-registers it.
  useEffect(() => {
    if (!enabled || userId === null) return;
    let cancelled = false;
    let counterInterval: ReturnType<typeof setInterval> | null = null;

    const schedule = (desired: DesiredActivity[]) => {
      if (boundaryTimer.current) clearTimeout(boundaryTimer.current);
      boundaryTimer.current = null;
      const next = nextPhaseBoundary(desired, Date.now());
      if (next !== null) {
        // setTimeout overflows past ~24.8 days; boundaries that far out wait.
        const delay = Math.min(next - Date.now() + 1_000, 2_147_000_000);
        boundaryTimer.current = setTimeout(() => void run(), delay);
      }
      const hasLiveCounter = desired.some(
        (item) => item.props.kind === "activity" && item.props.phase === "live",
      );
      if (hasLiveCounter && !counterInterval) {
        counterInterval = setInterval(() => {
          if (AppState.currentState === "active") void run();
        }, LIVE_COUNTER_REFRESH_MS);
      } else if (!hasLiveCounter && counterInterval) {
        clearInterval(counterInterval);
        counterInterval = null;
      }
    };

    const run = async () => {
      try {
        const desired = await reconcileLiveActivities();
        if (!cancelled) schedule(desired);
      } catch {
        // Offline or the endpoint is unavailable: keep what is showing.
      }
    };

    const runSoon = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => void run(), EVENT_DEBOUNCE_MS);
    };

    void registerLiveActivityDevice(language)
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) void run();
      });

    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void run();
    });
    const unsubscribes = [
      EVENTS.USER_QUEUE_CHANGED,
      EVENTS.USER_QUEUE_CALLED,
      EVENTS.USER_QUEUE_PRECALL,
      EVENTS.REALTIME_RESYNC,
    ].map((event) => subscribeToServerEvent(event, runSoon));

    return () => {
      cancelled = true;
      appState.remove();
      for (const unsubscribe of unsubscribes) unsubscribe();
      if (boundaryTimer.current) clearTimeout(boundaryTimer.current);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (counterInterval) clearInterval(counterInterval);
    };
  }, [enabled, language, userId]);
}
