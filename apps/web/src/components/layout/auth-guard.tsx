"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/common/spinner";
import { useSessionContext } from "@/lib/session";

/**
 * Gates the authed area. While the session resolves we show a spinner; if the
 * user isn't authenticated we bounce them to /login. The API is still the real
 * authority — this only keeps unauthenticated users out of the shell.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status } = useSessionContext();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  return <>{children}</>;
}
