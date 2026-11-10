import { ActionSheetIOS, Alert, type AlertButton, type AlertOptions, Platform } from "react-native";

/**
 * The app's one alert. iOS keeps UIKit's `UIAlertController`; Android shows the
 * same dialog drawn by `AlertHost` (components/alert-host.tsx), because the
 * system Alert there is a Material dialog and the app's look is Apple's on
 * both platforms (docs/DESIGN.md §12). Same signature as `Alert.alert`.
 */
export interface AlertRequest {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
}

let nextId = 1;
let queue: AlertRequest[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function alert(...args: Parameters<typeof Alert.alert>): void {
  if (Platform.OS !== "android") {
    Alert.alert(...args);
    return;
  }
  const [title, message, buttons, options] = args;
  queue = [
    ...queue,
    { id: nextId++, title, message, buttons: buttons ?? [{ text: "OK" }], options },
  ];
  emit();
}

/** The alert on screen: the oldest one not yet answered. */
export function currentAlert(): AlertRequest | undefined {
  return queue[0];
}

export function dismissAlert(id: number): void {
  queue = queue.filter((request) => request.id !== id);
  emit();
}

export function subscribeAlerts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Confirms a destructive action as Apple's action sheet: the destructive
 * choice on top, Cancel at the bottom (HIG Action sheets). Android shows the
 * same choice through `alert`.
 */
export function confirmDestructive({
  title,
  confirm,
  cancel,
  onConfirm,
}: {
  title: string;
  confirm: string;
  cancel: string;
  onConfirm: () => void;
}): void {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [confirm, cancel], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (index) => {
        if (index === 0) onConfirm();
      },
    );
    return;
  }
  alert(title, undefined, [
    { text: cancel, style: "cancel" },
    { text: confirm, style: "destructive", onPress: onConfirm },
  ]);
}
