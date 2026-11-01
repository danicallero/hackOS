import { CommandPalette } from "@/components/common/command-palette";
import { QuickArrival } from "@/components/common/quick-arrival";
import { AppSidebar, NotificationSidebarTrigger } from "@/components/layout/app-sidebar";
import { AuthGuard } from "@/components/layout/auth-guard";
import { NotificationOnboardingDialog } from "@/components/layout/notification-onboarding-dialog";
import { ProfileTasksDialog } from "@/components/layout/profile-tasks-dialog";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/layout/skip-link";
import { VerificationBanner } from "@/components/layout/verification-banner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/**
 * Authenticated app shell: a capability-filtered navigation panel and an
 * uninterrupted content canvas. Each page owns its `PageHeader` and h1.
 * The canvas is the page's only `<main>`; the skip link before the sidebar
 * is the first tab stop and moves focus there (#1172, #1173).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider className="xl:has-data-judging-page:h-svh xl:has-data-judging-page:overflow-hidden">
        <SkipLink />
        <AppSidebar />
        <SidebarInset className="min-h-0 min-w-0 bg-shell xl:has-data-judging-page:overflow-hidden">
          <div className="pointer-events-none absolute top-3 left-3 z-40 md:hidden">
            <NotificationSidebarTrigger className="pointer-events-auto bg-background/90 shadow-sm backdrop-blur" />
          </div>
          <VerificationBanner />
          <ProfileTasksDialog />
          <NotificationOnboardingDialog />
          <CommandPalette />
          <QuickArrival />
          <main
            id={MAIN_CONTENT_ID}
            tabIndex={-1}
            className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pt-3 pb-6 sm:px-6 md:pt-6 lg:pt-8 lg:pb-8 xl:has-data-judging-page:overflow-hidden outline-none"
          >
            {/* PageLayout chooses the reading width; operational workspaces may use the full canvas. */}
            <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col has-data-wide:max-w-none">
              {children}
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
