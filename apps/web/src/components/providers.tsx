"use client";

import { ThemeProvider } from "next-themes";
import { CookieNotice } from "@/components/layout/cookie-notice";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/lib/session";

/**
 * Global client providers, mounted once in the root layout:
 * - next-themes: dark-first (Dokploy-style), with class strategy on <html>.
 * - SessionProvider: /api/me + capability gating (H8/H55).
 * - TooltipProvider: required once for all shadcn tooltips.
 * - Toaster: sonner toasts for success/business-error feedback.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <SessionProvider>
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <CookieNotice />
        <Toaster position="bottom-right" />
      </SessionProvider>
    </ThemeProvider>
  );
}
