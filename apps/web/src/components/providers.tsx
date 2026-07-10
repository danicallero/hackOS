"use client";

import { EVENTS } from "@hackos/shared/events";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "next-themes";
import { useRef } from "react";
import { CookieNotice } from "@/components/layout/cookie-notice";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEventSource } from "@/hooks/use-event-source";
import { SessionProvider } from "@/lib/session";

function GlobalDataRefresh() {
  const reloadTimer = useRef<number | null>(null);
  const pathname = usePathname();

  useEventSource("/api/events/stream", {
    events: [EVENTS.DATA_CHANGED],
    onEvent: () => {
      // This route owns a focused live query; it refetches its queue model
      // below without losing focus, local state or a visible call notice.
      if (pathname === "/my-queue") return;
      // Coalesce writes which generate several domain changes into one reload.
      // A full navigation is intentional: most app routes own client-side
      // read-model state, so a router refresh alone would leave it stale.
      if (reloadTimer.current) return;
      reloadTimer.current = window.setTimeout(() => window.location.reload(), 200);
    },
  });

  return null;
}

/**
 * Global client providers, mounted once in the root layout:
 * - next-themes: dark-first (Dokploy-style), with class strategy on <html>.
 * - SessionProvider: /api/me + capability gating (H8/H55).
 * - TooltipProvider: required once for all shadcn tooltips.
 * - Toaster: sonner toasts for success/business-error feedback.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The kiosk TV (H41) is never touched by anyone, so a banner that only
  // dismisses on click would sit there forever, permanently covering rooms.
  const isKiosk = pathname?.startsWith("/tv");
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <SessionProvider>
        <GlobalDataRefresh />
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        {!isKiosk && <CookieNotice />}
        <Toaster position="bottom-right" />
      </SessionProvider>
    </ThemeProvider>
  );
}
