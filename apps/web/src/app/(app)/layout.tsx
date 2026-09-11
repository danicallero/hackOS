import { AppSidebar } from "@/components/layout/app-sidebar";
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
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0 bg-shell">
          <VerificationBanner />
          <main className="min-w-0 flex-1 px-4 pt-6 pb-6 has-data-wide:pt-2 sm:px-6 lg:pt-8 lg:pb-8 lg:has-data-wide:pt-2">
            {/* Pages opt into a wider column with data-wide (e.g. the judging
                panel's two-column operator layout). Everything else shares
                this one width — a page whose content looks sparse here
                should fix its own layout (a field grid, a two-column
                arrangement), not shrink the shared column, or the app ends
                up with three different page widths instead of one. */}
            <div className="mx-auto w-full max-w-7xl has-data-wide:max-w-none">{children}</div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
