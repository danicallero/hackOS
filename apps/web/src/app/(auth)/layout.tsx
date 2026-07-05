import Link from "next/link";
import { Brand } from "@/components/common/brand";
import { ThemeToggle } from "@/components/common/theme-toggle";

/**
 * Shell for unauthenticated flows (H1-H5): centered card on a plain canvas,
 * brand top-left, theme toggle top-right. Every auth screen renders inside it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-4">
        <Link href="/">
          <Brand />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <footer className="text-muted-foreground px-6 py-4 text-center text-xs">
        hackOS — hackathon management platform
      </footer>
    </div>
  );
}
