"use client";

// Shared state machine behind the token-based confirm/decline landing pages
// (H15): both /applications/confirm and /applications/decline POST an email
// token with an idempotency key, then distinguish expired vs. invalid-link
// vs. generic failure. Colocated here since it has exactly these two
// consumers (README "Page structure": sibling routes may import a logic
// module by relative path).

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";

export type TokenActionState = "loading" | "done" | "error" | "expired";

interface UseTokenActionOptions {
  token: string | null;
  endpoint: string;
  isExpired: (err: unknown) => boolean;
  invalidLinkMessage: string;
  fallbackMessage: string;
}

interface UseTokenActionResult<T> {
  state: TokenActionState;
  result: T | null;
  errorMsg: string;
  linkInvalid: boolean;
  retry: () => Promise<void>;
}

/** Runs once on mount, and again whenever `retry()` is called. */
export function useTokenAction<T>({
  token,
  endpoint,
  isExpired,
  invalidLinkMessage,
  fallbackMessage,
}: UseTokenActionOptions): UseTokenActionResult<T> {
  const [state, setState] = useState<TokenActionState>("loading");
  const [result, setResult] = useState<T | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [linkInvalid, setLinkInvalid] = useState(false);
  const ran = useRef(false);
  const idempotencyKey = useRef<string | null>(null);

  const run = useCallback(async () => {
    setState("loading");
    setErrorMsg("");
    setLinkInvalid(false);
    if (!token) {
      setLinkInvalid(true);
      setErrorMsg(invalidLinkMessage);
      setState("error");
      return;
    }
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const res = await api.post<T>(
        endpoint,
        { token },
        { headers: { "Idempotency-Key": idempotencyKey.current } },
      );
      setResult(res);
      setState("done");
    } catch (err) {
      if (isExpired(err)) {
        setState("expired");
        return;
      }
      if (err instanceof ApiError && err.code === "not_found") {
        setLinkInvalid(true);
        setErrorMsg(invalidLinkMessage);
      } else {
        setErrorMsg(err instanceof ApiError ? err.message : fallbackMessage);
      }
      setState("error");
    }
  }, [token, endpoint, isExpired, invalidLinkMessage, fallbackMessage]);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void run();
  }, [run]);

  return { state, result, errorMsg, linkInvalid, retry: run };
}

/** The confirm endpoint signals an expired confirmation window either way (H15). */
export function isConfirmExpiredError(err: unknown): boolean {
  if (!(err instanceof ApiError) || !err.details || typeof err.details !== "object") return false;
  const details = err.details as { code?: unknown; expired?: unknown };
  return details.code === "confirmation_expired" || details.expired === true;
}

/** The decline endpoint signals an expired confirmation window via `status` (H15). */
export function isDeclineExpiredError(err: unknown): boolean {
  if (!(err instanceof ApiError) || !err.details || typeof err.details !== "object") return false;
  const details = err.details as { status?: unknown };
  return details.status === "expired";
}
