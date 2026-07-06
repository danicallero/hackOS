import { ThemeToggle } from "@/components/common/theme-toggle";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AuthGuard } from "@/components/layout/auth-guard";
import { HeaderTitle } from "@/components/layout/header-title";
import { UserMenu } from "@/components/layout/user-menu";
import { VerificationBanner } from "@/components/layout/verification-banner";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

/**
 * Authenticated app shell (Dokploy-style): capability-filtered sidebar + a
 * compact top bar with the current location, and a centered content column.
 * The top bar shows the nav location; each page composes <SectionCard>s that
 * carry their own titles.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur sm:px-6">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 !h-4" />
            <HeaderTitle />
            <div className="ml-auto flex items-center gap-1">
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          <VerificationBanner />
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:py-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
