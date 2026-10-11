import type { AndroidLiveUpdateMessage } from "@hackos/shared/live-activities";
import { liveActivityHost } from "./host";
import {
  type DesiredActivity,
  liveActivityKey,
  planReconcile,
  propsSignature,
  pruneDismissed,
  type RunningActivity,
} from "./model";
import { readLiveActivityState, updateLiveActivityState } from "./store";

/**
 * Applies the server's list to this device's system surfaces (#966). No API
 * calls here: Android's headless notification task uses it too.
 */
export interface ApplyResult {
  /** Running surfaces by key after applying. */
  running: Map<string, RunningActivity>;
  /** Keys the person just dismissed while the server still lists them. */
  dismissed: string[];
}

let chain: Promise<unknown> = Promise.resolve();

/** One application at a time: a reconcile racing a push must not double-start. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task);
  chain = next.catch(() => undefined);
  return next;
}

function keyOf(surface: RunningActivity): string | null {
  if (surface.subject) return liveActivityKey(surface.kind, surface.subject);
  return surface.kind === "queue" ? liveActivityKey("queue", "judging") : null;
}

export function applyDesiredActivities(desired: DesiredActivity[]): Promise<ApplyResult> {
  return serialized(async () => {
    const host = liveActivityHost;
    const state = await readLiveActivityState();
    if (!host.supported()) return { running: new Map(), dismissed: [] };
    const effective = state.enabled ? desired : [];
    const dismissed = pruneDismissed(state.dismissed, effective);
    const plan = planReconcile(effective, host.running(), {
      signatures: new Map(Object.entries(state.signatures)),
      dismissed: new Map(Object.entries(dismissed)),
      previouslyRunning: new Set(state.running),
    });

    const signatures: Record<string, string> = {};
    const phases: Record<string, string> = { ...state.phases };
    for (const surface of plan.end) {
      await host.end(surface, state.enabled ? "finished" : "immediate").catch(() => undefined);
    }
    for (const { id, desired: item } of plan.update) {
      const key = liveActivityKey(item.kind, item.subject);
      await host.update(id, item, phases[key] ?? null).catch(() => undefined);
    }
    for (const item of plan.start) {
      const key = liveActivityKey(item.kind, item.subject);
      await host.start(item, phases[key] ?? null);
    }
    for (const entry of plan.dismissed) dismissed[entry.key] = entry.phase;

    const running = new Map<string, RunningActivity>();
    for (const surface of host.running()) {
      const key = keyOf(surface);
      if (key) running.set(key, surface);
    }
    for (const item of effective) {
      const key = liveActivityKey(item.kind, item.subject);
      if (!running.has(key)) continue;
      signatures[key] = propsSignature(item.props);
      phases[key] = item.props.phase;
    }
    for (const key of Object.keys(phases)) if (!running.has(key)) delete phases[key];

    await updateLiveActivityState((current) => ({
      ...current,
      dismissed,
      signatures,
      phases,
      running: [...running.keys()],
    }));
    return { running, dismissed: plan.dismissed.map((entry) => entry.key) };
  });
}

/** Ends every surface now (sign-out, opt-out) and forgets their state. */
export function endAllActivities(): Promise<void> {
  return serialized(async () => {
    const host = liveActivityHost;
    if (host.supported()) {
      for (const surface of host.running()) {
        await host.end(surface, "immediate").catch(() => undefined);
      }
      // An earlier account's final state (e.g. "Go to Room B") must not stay
      // on the Lock Screen after sign-out or opt-out.
      await host.dismissEnded().catch(() => undefined);
    }
    await updateLiveActivityState((current) => ({
      ...current,
      dismissed: {},
      signatures: {},
      phases: {},
      running: [],
    }));
  });
}

/**
 * Android data push (start/update/end for one subject), from the background
 * task or a foreground delivery. Respects a dismissal exactly like the
 * foreground reconcile: a swiped-away subject returns only on a new phase.
 */
export function applyAndroidLiveUpdate(
  message: AndroidLiveUpdateMessage["hackosLiveUpdate"],
): Promise<void> {
  return serialized(async () => {
    const host = liveActivityHost;
    const state = await readLiveActivityState();
    if (!host.supported()) return;
    const key = liveActivityKey(message.kind, message.subject);
    const surface = host.running().find((candidate) => keyOf(candidate) === key);

    if (message.event === "end" || !message.props || !state.enabled) {
      if (surface) await host.end(surface, "finished");
      await updateLiveActivityState((current) => {
        const { [key]: _signature, ...signatures } = current.signatures;
        const { [key]: _phase, ...phases } = current.phases;
        const { [key]: _dismissed, ...dismissed } = current.dismissed;
        return {
          ...current,
          signatures,
          phases,
          dismissed,
          running: current.running.filter((candidate) => candidate !== key),
        };
      });
      return;
    }

    const item: DesiredActivity = {
      kind: message.kind,
      subject: message.subject,
      props: message.props,
    };
    const phase = message.props.phase;
    let dismissedPhase = state.dismissed[key];
    if (!surface && dismissedPhase === undefined && state.running.includes(key)) {
      dismissedPhase = state.phases[key] ?? phase;
    }
    if (!surface && dismissedPhase === phase) {
      await updateLiveActivityState((current) => ({
        ...current,
        dismissed: { ...current.dismissed, [key]: phase },
        running: current.running.filter((candidate) => candidate !== key),
      }));
      return;
    }

    const previousPhase = state.phases[key] ?? null;
    if (surface) await host.update(surface.id, item, previousPhase);
    else await host.start(item, previousPhase);
    await updateLiveActivityState((current) => {
      const { [key]: _dismissed, ...dismissed } = current.dismissed;
      return {
        ...current,
        dismissed,
        signatures: { ...current.signatures, [key]: propsSignature(item.props) },
        phases: { ...current.phases, [key]: phase },
        running: [...new Set([...current.running, key])],
      };
    });
  });
}
