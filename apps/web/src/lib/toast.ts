"use client";

import type { ReactNode } from "react";
import { type SileoOptions, type SileoPosition, sileo } from "sileo";

export interface ToastOptions {
  autopilot?: SileoOptions["autopilot"];
  description?: SileoOptions["description"];
  duration?: SileoOptions["duration"];
  fill?: SileoOptions["fill"];
  icon?: SileoOptions["icon"];
  position?: SileoPosition;
  roundness?: SileoOptions["roundness"];
  styles?: SileoOptions["styles"];
  title?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export type ToastPromiseContent = ToastOptions & { title: string };
export type ToastIconOptions = ToastOptions & {
  icon: NonNullable<SileoOptions["icon"]>;
};

export interface ToastPromiseOptions<T> {
  loading: ToastPromiseContent;
  success: ToastPromiseContent | ((value: T) => ToastPromiseContent);
  error: ToastPromiseContent | ((error: unknown) => ToastPromiseContent);
  action?: ToastPromiseContent | ((value: T) => ToastPromiseContent);
  position?: SileoPosition;
}

type ToastMessage = ReactNode;
type ToastMethod = (message: ToastMessage, options?: ToastOptions) => string;
type ToastIconMethod = (message: ToastMessage, options: ToastIconOptions) => string;
type SileoOptionsWithId = SileoOptions & { id: string };
type ToastState = "success" | "error" | "warning" | "info" | "action";
type NativePromiseOptions<T> = {
  loading: SileoOptions;
  success: SileoOptions | ((value: T) => SileoOptions);
  error: SileoOptions | ((error: unknown) => SileoOptions);
  action?: SileoOptions | ((value: T) => SileoOptions);
  position?: SileoPosition;
};

const DEFAULT_DURATIONS: Record<ToastState, number> = {
  success: 2_400,
  error: 5_000,
  warning: 3_600,
  info: 2_000,
  action: 6_000,
};

const DEFAULT_POSITION: SileoPosition = "top-right";
const MAX_VISIBLE_TOASTS = 3;
const TOAST_EXIT_BUFFER_MS = 700;

type TrackedToast = {
  createdAt: number;
  dedupeKey?: string;
  persistent: boolean;
  position: SileoPosition;
  priority: number;
  cleanupTimer?: ReturnType<typeof setTimeout>;
};

const trackedToasts = new Map<string, TrackedToast>();
const dedupedToastIds = new Map<string, string>();

function clearTrackedToast(id: string) {
  const tracked = trackedToasts.get(id);
  if (!tracked) return;
  if (tracked.cleanupTimer) clearTimeout(tracked.cleanupTimer);
  trackedToasts.delete(id);
  if (tracked.dedupeKey && dedupedToastIds.get(tracked.dedupeKey) === id) {
    dedupedToastIds.delete(tracked.dedupeKey);
  }
}

function clearTrackedToasts(position?: SileoPosition) {
  for (const [id, tracked] of trackedToasts) {
    if (position === undefined || tracked.position === position) clearTrackedToast(id);
  }
}

function scheduleTrackedCleanup(id: string, duration: number | null) {
  const tracked = trackedToasts.get(id);
  if (!tracked || duration === null) return;
  tracked.cleanupTimer = setTimeout(
    () => clearTrackedToast(id),
    Math.max(TOAST_EXIT_BUFFER_MS, duration + TOAST_EXIT_BUFFER_MS),
  );
}

function dedupeKey(method: ToastState, options: SileoOptions): string | undefined {
  // Repeated plain feedback is one piece of information. Rich/action toasts
  // stay independent so an Undo or contextual explanation is never hidden.
  if (
    options.duration === null ||
    options.button ||
    options.icon ||
    typeof options.title !== "string" ||
    (options.description !== undefined && typeof options.description !== "string")
  ) {
    return undefined;
  }
  return [
    method,
    options.position ?? DEFAULT_POSITION,
    options.title,
    options.description ?? "",
  ].join("::");
}

function priorityFor(state: ToastState | "loading") {
  if (state === "loading") return 4;
  if (state === "error" || state === "action") return 3;
  if (state === "warning") return 2;
  return 1;
}

function trimToastStack(position: SileoPosition) {
  while (true) {
    const inPosition = [...trackedToasts.entries()].filter(
      ([, tracked]) => tracked.position === position,
    );
    if (inPosition.length <= MAX_VISIBLE_TOASTS) return;

    const candidates = inPosition
      .filter(([, tracked]) => !tracked.persistent)
      .sort(
        ([, left], [, right]) => left.priority - right.priority || left.createdAt - right.createdAt,
      );
    const oldestDismissible = candidates[0];
    if (!oldestDismissible) return;

    const [id] = oldestDismissible;
    clearTrackedToast(id);
    sileo.dismiss(id);
  }
}

function trackToast(
  id: string,
  options: Pick<SileoOptions, "duration" | "position">,
  state: ToastState | "loading",
  key?: string,
) {
  clearTrackedToast(id);
  trackedToasts.set(id, {
    createdAt: Date.now(),
    dedupeKey: key,
    persistent: options.duration === null,
    position: options.position ?? DEFAULT_POSITION,
    priority: priorityFor(state),
  });
  if (key) dedupedToastIds.set(key, id);
  scheduleTrackedCleanup(id, options.duration === undefined ? 6_000 : options.duration);
  trimToastStack(options.position ?? DEFAULT_POSITION);
}

function findDedupedToast(key: string | undefined) {
  if (!key) return undefined;
  const id = dedupedToastIds.get(key);
  if (id && trackedToasts.has(id)) return id;
  if (id) dedupedToastIds.delete(key);
  return undefined;
}

function settlePromiseToast(id: string, duration: number | null, state: ToastState) {
  const tracked = trackedToasts.get(id);
  if (!tracked) return;
  if (tracked.cleanupTimer) clearTimeout(tracked.cleanupTimer);
  tracked.persistent = duration === null;
  tracked.priority = priorityFor(state);
  scheduleTrackedCleanup(id, duration);
  trimToastStack(tracked.position);
}

let toastSequence = 0;

function nextToastId() {
  toastSequence += 1;
  // Sileo keys each dismissal timer by id + instanceId. Never reuse the
  // library's default id: a fresh notification must get its own timeline.
  return `hackos-toast-${Date.now()}-${toastSequence}`;
}

function withButton(options: ToastOptions): Omit<SileoOptions, "type"> {
  const { action, title, ...rest } = options;
  return {
    ...(title ? { title } : {}),
    ...rest,
    ...(action
      ? {
          button: {
            title: action.label,
            onClick: action.onClick,
          },
        }
      : {}),
  };
}

function normalizeMessage(
  message: ToastMessage,
  options: ToastOptions | undefined,
  id: string,
): SileoOptionsWithId {
  const { title, description, ...rest } = options ?? {};
  const isTextMessage = typeof message === "string";
  const resolvedTitle = title ?? (isTextMessage ? message : undefined);
  const resolvedDescription =
    description ?? (title && isTextMessage ? message : isTextMessage ? undefined : message);

  return {
    id,
    ...withButton(rest),
    ...(resolvedTitle ? { title: resolvedTitle } : {}),
    ...(resolvedDescription !== undefined ? { description: resolvedDescription } : {}),
  };
}

function normalizePromiseContent(
  content: ToastPromiseContent,
  id: string,
  defaultDuration?: number,
): SileoOptionsWithId {
  const options = { id, ...withButton(content) };
  const hasExpandableContent = Boolean(options.description) || Boolean(options.button);
  if (hasExpandableContent && content.autopilot === undefined) options.autopilot = false;
  if (options.duration === undefined && defaultDuration !== undefined) {
    options.duration = defaultDuration;
  }
  return options;
}

function show(
  method: "success" | "error" | "warning" | "info",
  message: ToastMessage,
  options?: ToastOptions,
) {
  const id = nextToastId();
  const sileoOptions = normalizeMessage(message, options, id);
  const key = dedupeKey(method, sileoOptions);
  const existingId = findDedupedToast(key);
  if (existingId) return existingId;
  const hasExpandableContent = Boolean(sileoOptions.description) || Boolean(sileoOptions.button);
  if (hasExpandableContent && options?.autopilot === undefined) sileoOptions.autopilot = false;
  if (sileoOptions.duration === undefined) sileoOptions.duration = DEFAULT_DURATIONS[method];

  const result = sileo[method](sileoOptions);
  trackToast(result, sileoOptions, method, key);
  return result;
}

function showLoading(message: ToastMessage, options?: ToastOptions) {
  const id = nextToastId();
  const sileoOptions = {
    ...normalizeMessage(message, options, id),
    type: "loading",
    duration: options?.duration === undefined ? null : options.duration,
  } satisfies SileoOptionsWithId;
  const result = sileo.show(sileoOptions);
  trackToast(result, sileoOptions, "loading");
  return result;
}

function showAction(message: ToastMessage, options?: ToastOptions) {
  const id = nextToastId();
  const sileoOptions = normalizeMessage(message, options, id);
  if (options?.autopilot === undefined) sileoOptions.autopilot = false;
  if (sileoOptions.duration === undefined) sileoOptions.duration = DEFAULT_DURATIONS.action;
  const result = sileo.action(sileoOptions);
  trackToast(result, sileoOptions, "action");
  return result;
}

function showIcon(message: ToastMessage, options: ToastIconOptions) {
  const id = nextToastId();
  const sileoOptions = normalizeMessage(message, options, id);
  const hasExpandableContent = Boolean(sileoOptions.description) || Boolean(sileoOptions.button);
  if (hasExpandableContent && options.autopilot === undefined) sileoOptions.autopilot = false;
  if (sileoOptions.duration === undefined) sileoOptions.duration = DEFAULT_DURATIONS.success;

  const result = sileo.show({ ...sileoOptions, icon: options.icon });
  trackToast(result, { ...sileoOptions, position: options.position }, "success");
  return result;
}

function showPromise<T>(promise: Promise<T> | (() => Promise<T>), options: ToastPromiseOptions<T>) {
  const id = nextToastId();
  const resolve = <TValue>(
    content: ToastPromiseContent | ((value: TValue) => ToastPromiseContent),
    value: TValue,
  ) => (typeof content === "function" ? content(value) : content);
  const nativeOptions: NativePromiseOptions<T> = {
    position: options.position,
    loading: { ...normalizePromiseContent(options.loading, id), duration: null },
    success: (value) =>
      normalizePromiseContent(resolve(options.success, value), id, DEFAULT_DURATIONS.success),
    error: (error) =>
      normalizePromiseContent(resolve(options.error, error), id, DEFAULT_DURATIONS.error),
    ...(options.action
      ? {
          action: (value: T) =>
            normalizePromiseContent(resolve(options.action!, value), id, DEFAULT_DURATIONS.action),
        }
      : {}),
  };
  const result = sileo.promise(promise, nativeOptions);
  trackToast(id, nativeOptions.loading, "loading");

  void result.then(
    () => {
      const content = options.action ?? options.success;
      const state: ToastState = options.action ? "action" : "success";
      const fallback = DEFAULT_DURATIONS[state];
      const duration =
        typeof content === "function"
          ? fallback
          : content.duration === undefined
            ? fallback
            : content.duration;
      settlePromiseToast(id, duration, state);
    },
    () => {
      const content = options.error;
      const duration =
        typeof content === "function"
          ? DEFAULT_DURATIONS.error
          : content.duration === undefined
            ? DEFAULT_DURATIONS.error
            : content.duration;
      settlePromiseToast(id, duration, "error");
    },
  );
  return result;
}

interface ToastApi {
  (message: ToastMessage, options?: ToastOptions): string;
  success: ToastMethod;
  error: ToastMethod;
  warning: ToastMethod;
  info: ToastMethod;
  loading: ToastMethod;
  action: ToastMethod;
  icon: ToastIconMethod;
  promise: typeof showPromise;
  dismiss: typeof sileo.dismiss;
  clear: typeof sileo.clear;
}

export const toast: ToastApi = Object.assign(
  (message: ToastMessage, options?: ToastOptions) => show("info", message, options),
  {
    success: (message: ToastMessage, options?: ToastOptions) => show("success", message, options),
    error: (message: ToastMessage, options?: ToastOptions) => show("error", message, options),
    warning: (message: ToastMessage, options?: ToastOptions) => show("warning", message, options),
    info: (message: ToastMessage, options?: ToastOptions) => show("info", message, options),
    loading: showLoading,
    action: showAction,
    icon: showIcon,
    promise: showPromise,
    dismiss: (id: string) => {
      clearTrackedToast(id);
      return sileo.dismiss(id);
    },
    clear: (position?: SileoPosition) => {
      clearTrackedToasts(position);
      return sileo.clear(position);
    },
  },
);

/**
 * Give API errors a useful title without losing the server's recovery detail.
 * Keep this at the adapter boundary so feature code can choose a concise,
 * localized context while Sileo handles the expandable description.
 */
export function showErrorToast(error: unknown, title: string, options?: ToastOptions) {
  const description =
    options?.description ??
    (error instanceof Error && error.message !== title ? error.message : undefined);
  return toast.error(title, {
    ...options,
    ...(description !== undefined ? { description } : {}),
  });
}
