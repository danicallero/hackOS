import { ViewTransition } from "react";

/**
 * Crossfade of the content region between top-level routes. Templates remount
 * on every segment change, so this boundary enters/exits per navigation while
 * the shell and sidebar (the layout above) stay still. Timing and the
 * reduced-motion opt-out live in globals.css (`.route-enter`, `.route-exit`).
 * Unrelated transitions (dialogs, filters, Suspense inside a page) do not
 * animate this boundary (`default="none"`).
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="route-enter" exit="route-exit" default="none">
      {children}
    </ViewTransition>
  );
}
