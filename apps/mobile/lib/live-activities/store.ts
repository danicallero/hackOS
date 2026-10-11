import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Device-local Live Activity state (#966), shared by the foreground app and
 * Android's headless notification task. Small JSON in SecureStore, readable
 * after first unlock so a background push can still render.
 */
export interface LiveActivityState {
  /** Stable install id the API keys this device's registration by. */
  deviceId: string | null;
  /** In-app opt-out (Notifications settings); on by default. */
  enabled: boolean;
  /** Key → phase the person dismissed; not restarted until that phase changes. */
  dismissed: Record<string, string>;
  /**
   * Key → dismissed phase the API has not been told about yet (DELETE
   * sessions). Android records dismissals headlessly; the foreground sync
   * reports them and clears the entry once the API accepted it.
   */
  unreportedDismissals: Record<string, string>;
  /** Key → props signature last rendered. */
  signatures: Record<string, string>;
  /** Key → phase last rendered (Android alerts only on becoming called). */
  phases: Record<string, string>;
  /** Keys that had a surface after the last reconcile. */
  running: string[];
  /** iOS ActivityKit id → staff subject (push-started ones cannot be read back). */
  iosStaffSubjects: Record<string, string>;
}

const STORAGE_KEY = "hackos.liveActivities.v1";
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const EMPTY: LiveActivityState = {
  deviceId: null,
  enabled: true,
  dismissed: {},
  unreportedDismissals: {},
  signatures: {},
  phases: {},
  running: [],
  iosStaffSubjects: {},
};

let cache: LiveActivityState | null = null;
let writes: Promise<unknown> = Promise.resolve();

export async function readLiveActivityState(): Promise<LiveActivityState> {
  if (cache) return cache;
  if (Platform.OS === "web") {
    cache = { ...EMPTY };
    return cache;
  }
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY, OPTIONS);
    cache = raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<LiveActivityState>) } : { ...EMPTY };
  } catch {
    cache = { ...EMPTY };
  }
  return cache;
}

/** Serialized read-modify-write so the reconcile and token callbacks never interleave. */
export function updateLiveActivityState(
  change: (state: LiveActivityState) => LiveActivityState,
): Promise<LiveActivityState> {
  const next = writes.then(async () => {
    const updated = change(await readLiveActivityState());
    cache = updated;
    if (Platform.OS !== "web") {
      try {
        await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(updated), OPTIONS);
      } catch {
        // The in-memory copy still drives this session.
      }
    }
    return updated;
  });
  writes = next.catch(() => undefined);
  return next;
}

/** The install id, created on first use. */
export async function liveActivityDeviceId(): Promise<string> {
  const state = await readLiveActivityState();
  if (state.deviceId) return state.deviceId;
  const updated = await updateLiveActivityState((current) => ({
    ...current,
    deviceId: current.deviceId ?? randomUUID(),
  }));
  return updated.deviceId!;
}
