"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/common/spinner";
import { useTrackNavigation } from "@/hooks/use-track-navigation";
import { withReturnPath } from "@/lib/return-path";
import { useSessionContext } from "@/lib/session";

/**
 * Gates the authed area. While the session resolves we show a spinner; if the
 * user isn't authenticated we bounce them to /login. The API is still the real
 * authority — this only keeps unauthenticated users out of the shell.
 *
 * The page the person was trying to reach is carried through as `next`
 * (H188): a deep link into the app while logged out — including an
 * already-used verification link, which Better Auth answers as success
 * without auto-signing in (H2) — must not silently strand the person on a
 * bare /login with no way back to what they were doing. Read straight from
 * `window.location` (rather than `useSearchParams`) so this global guard
 * doesn't force every authenticated page into a Suspense boundary.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { status } = useSessionContext();
  const router = useRouter();
  useTrackNavigation();

  useEffect(() => {
    if (status === "unauthenticated") {
      const here = `${window.location.pathname}${window.location.search}`;
      router.replace(withReturnPath("/login", here));
    }
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
