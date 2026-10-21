import type { NativeStackNavigationOptions } from "expo-router/native-stack";
import type { ReactNode } from "react";

export interface PaneNativeStackProps {
  /** Two-pane layout is active; otherwise only `children` render. */
  enabled: boolean;
  /** Options of the root screen: its title and trailing bar items. */
  rootOptions: NativeStackNavigationOptions;
  /** A screen pushed over the root natively while `open` (the people finder). */
  pushed?: {
    open: boolean;
    onClose: () => void;
    options?: NativeStackNavigationOptions;
    render: () => ReactNode;
  };
  /** The root screen's content; its scroll view should be the direct child. */
  children: ReactNode;
}

/** False here: Android and web draw the pane's chrome themselves. The iOS file mounts a native stack. */
export const NATIVE_PANE_STACK = false;

export function PaneNativeStack({ children }: PaneNativeStackProps) {
  return <>{children}</>;
}
