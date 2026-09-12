import { AppSidebar, NotificationSidebarTrigger } from "@/components/layout/app-sidebar";
import { AuthGuard } from "@/components/layout/auth-guard";
import { VerificationBanner } from "@/components/layout/verification-banner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/**
 * Authenticated app shell: a capability-filtered navigation panel and an
 * uninterrupted content canvas. Each page owns its `PageHeader` and h1.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider className="xl:has-data-judging-page:h-svh xl:has-data-judging-page:overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-h-0 min-w-0 bg-shell xl:has-data-judging-page:overflow-hidden">
          <div className="pointer-events-none fixed top-3 left-3 z-40 md:hidden">
            <NotificationSidebarTrigger className="pointer-events-auto bg-background/90 shadow-sm backdrop-blur" />
          </div>
          <VerificationBanner />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pt-3 pb-6 sm:px-6 md:pt-6 lg:pt-8 lg:pb-8 xl:has-data-judging-page:overflow-hidden">
            {/* Pages opt into a wider column with data-wide (e.g. the judging
                panel's two-column operator layout). Everything else shares
                this one width — a page whose content looks sparse here
                should fix its own layout (a field grid, a two-column
                arrangement), not shrink the shared column, or the app ends
                up with three different page widths instead of one. */}
            <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col has-data-wide:max-w-none">
              {children}
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
