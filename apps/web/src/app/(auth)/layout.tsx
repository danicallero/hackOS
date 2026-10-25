"use client";

import { usePathname } from "next/navigation";
import { PublicFooter } from "@/components/layout/public-footer";
import { PublicTopBar } from "@/components/layout/public-top-bar";
import { cn } from "@/lib/utils";

/**
 * Shell for unauthenticated flows (H1-H5): centered card on a plain canvas
 * under the shared public top bar. Every auth screen renders inside it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const confirmation = usePathname() === "/applications/confirm";
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <PublicTopBar access={false} />
      <main
        id="main-content"
        tabIndex={-1}
        className="outline-none flex flex-1 items-center justify-center px-4 py-10"
      >
        <div className={cn("w-full", confirmation ? "max-w-3xl" : "max-w-md")}>{children}</div>
      </main>
      <PublicFooter />
    </div>
  );
}
