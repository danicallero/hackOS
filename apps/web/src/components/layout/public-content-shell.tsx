"use client";

import { usePathname } from "next/navigation";
import { Spinner } from "@/components/common/spinner";
import { AppShell } from "@/components/layout/app-shell";
import { PublicTopBar } from "@/components/layout/public-top-bar";
import { useSessionContext } from "@/lib/session";

/** H18/H45: public records retain the app shell for signed-in viewers. */
export function PublicContentShell({ children }: { children: React.ReactNode }) {
  const { status } = useSessionContext();
  const pathname = usePathname();
  const publicRecord =
    pathname === "/timetable" ||
    pathname === "/gallery" ||
    pathname.startsWith("/gallery/") ||
    pathname.startsWith("/challenge/");
  if (status === "authenticated" || !publicRecord) return <AppShell>{children}</AppShell>;
  if (status === "loading")
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  return (
    <div className="min-h-dvh">
      <PublicTopBar />
      <main
        id="main-content"
        tabIndex={-1}
        className="outline-none mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8"
      >
        {children}
      </main>
    </div>
  );
}
