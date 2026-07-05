import { ThemeToggle } from "@/components/common/theme-toggle";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AuthGuard } from "@/components/layout/auth-guard";
import { HeaderTitle } from "@/components/layout/header-title";
import { UserMenu } from "@/components/layout/user-menu";
import { VerificationBanner } from "@/components/layout/verification-banner";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

/**
 * Authenticated app shell: capability-filtered sidebar + top bar. Dokploy-like
 * — persistent left nav, compact header, content inset. Everything inside is
 * gated by <AuthGuard>.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="bg-background/80 sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 !h-4" />
            <HeaderTitle />
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          <VerificationBanner />
          <main className="flex-1 p-4 sm:p-6">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
