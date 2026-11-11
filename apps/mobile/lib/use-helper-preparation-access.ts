import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";
import type { MyHelperProfile } from "./help-desk";

/** H61: accepted mentors may prepare their profile before event-day access. */
export function useHelperPreparationAccess(
  userId: number | undefined,
  hasEventAccess: boolean | undefined,
) {
  const [state, setState] = useState<{
    userId: number;
    eligible: boolean;
    error: Error | null;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry starts a new eligibility read after a transport failure.
  useEffect(() => {
    if (!userId || hasEventAccess !== false) return;
    let active = true;
    void apiFetch<MyHelperProfile>("/api/me/helper-profile")
      .then((profile) => {
        if (active) setState({ userId, eligible: profile.eligible, error: null });
      })
      .catch((cause) => {
        if (active)
          setState({
            userId,
            eligible: false,
            error: cause instanceof Error ? cause : new Error(String(cause)),
          });
      });
    return () => {
      active = false;
    };
  }, [userId, hasEventAccess, retry]);
  return {
    pending: !!userId && hasEventAccess === false && state?.userId !== userId,
    eligible: state !== null && state.userId === userId && state.eligible,
    error: state !== null && state.userId === userId ? state.error : null,
    retry: useCallback(() => {
      setState(null);
      setRetry((value) => value + 1);
    }, []),
  };
}
