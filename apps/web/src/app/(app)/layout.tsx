import { LanguageSelect } from "@/components/common/language-select";
import { ThemeToggle } from "@/components/common/theme-toggle";
import { AppSidebar, NotificationSidebarTrigger } from "@/components/layout/app-sidebar";
import { AuthGuard } from "@/components/layout/auth-guard";
import { HeaderTitle } from "@/components/layout/header-title";
import { UserMenu } from "@/components/layout/user-menu";
import { VerificationBanner } from "@/components/layout/verification-banner";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/**
 * Authenticated app shell (Dokploy-style): capability-filtered sidebar + a
 * compact top bar with the current workspace, and a centered content column.
 * The top bar carries the workspace, never the leaf — each page renders its
 * own name in its <PageHeader> h1 (issue #297).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header className="bg-background/80 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur sm:px-6">
            <NotificationSidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 !h-4" />
            <HeaderTitle />
            <div className="ml-auto flex items-center gap-1">
              <LanguageSelect />
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          <VerificationBanner />
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:py-8">
            {/* Pages opt into a wider column with data-wide (e.g. the judging
                panel's two-column operator layout). */}
            <div className="mx-auto w-full max-w-6xl has-[[data-wide]]:max-w-none">{children}</div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AuthGuard>
  );
}
