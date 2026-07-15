import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useMeContext } from "@/lib/me-context";

/** Root route: send to the tabs (if signed in) or sign-in (if not). */
export default function Index() {
  const { data: session, isPending } = authClient.useSession();
  const { loading } = useMeContext();
  const pendingGraceElapsed = usePendingGrace(isPending);
  if (isPending && !pendingGraceElapsed) return null;
  if (!session) return <Redirect href="/(auth)/sign-in" />;
  if (loading) return null;
  return <Redirect href="/(tabs)/schedule" />;
}

function usePendingGrace(pending: boolean) {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!pending) {
      setElapsed(false);
      return;
    }
    const timeout = setTimeout(() => setElapsed(true), 3_000);
    return () => clearTimeout(timeout);
  }, [pending]);
  return elapsed;
}
