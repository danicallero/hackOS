"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider } from "next-themes";
import { CookieNotice } from "@/components/layout/cookie-notice";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocaleProvider } from "@/lib/i18n";
import { SessionProvider } from "@/lib/session";

/**
 * Global client providers, mounted once in the root layout:
 * - next-themes: light-first, with class strategy on <html>.
 * - SessionProvider: /api/me + capability gating (H8/H55).
 * - TooltipProvider: required once for all shadcn tooltips.
 * - Toaster: sonner toasts for success/business-error feedback.
 *
 * There is no global "reload the page on any mutation" mechanism — every
 * page that needs live data owns a scoped `useAutoRefresh` (or a focused
 * `useLiveQuery`/`useEventSource`) subscription instead, so another user's
 * unrelated write never blows away this tab's scroll position, open modal,
 * or in-progress form.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // The kiosk TV (H41) is never touched by anyone, so a banner that only
  // dismisses on click would sit there forever, permanently covering rooms.
  const isKiosk = pathname?.startsWith("/tv");
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <SessionProvider>
        <LocaleProvider>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
          {!isKiosk && <CookieNotice />}
          <Toaster position="bottom-right" />
        </LocaleProvider>
      </SessionProvider>
    </ThemeProvider>
  );
}
