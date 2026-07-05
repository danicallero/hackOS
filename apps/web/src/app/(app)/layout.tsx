import { ThemeToggle } from "@/components/common/theme-toggle";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AuthGuard } from "@/components/layout/auth-guard";
import { UserMenu } from "@/components/layout/user-menu";
import { VerificationBanner } from "@/components/layout/verification-banner";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

/**
 * Authenticated app shell: capability-filtered sidebar + top bar. Dokploy-like
 * — persistent left nav, compact header, content inset. The header bar and the
 * page content share the same left padding + max width so they line up; the
 * page's own <PageHeader> supplies the title (no duplication in the bar).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur sm:px-6">
            <SidebarTrigger className="-ml-1" />
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          <VerificationBanner />
          <main className="flex-1 px-4 py-6 sm:px-6 lg:py-8">
            <div className="w-full max-w-5xl">{children}</div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
