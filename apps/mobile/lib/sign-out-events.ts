/** A listener may return a promise for cleanup that still needs the old session. */
type SignOutListener = () => unknown;

/** Upper bound on how long server revocation waits for listener cleanup. */
export const SIGN_OUT_CLEANUP_TIMEOUT_MS = 4_000;

const listeners = new Set<SignOutListener>();

export function registerSignOutListener(listener: SignOutListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Runs every listener synchronously. The returned promise settles once their
 * asynchronous cleanup has finished (or failed, or timed out), so a caller can
 * revoke the server session only after requests that still need it — such as
 * turning off this device's Live Activity delivery (#966) — have been sent.
 */
export function notifySignOut(): Promise<void> {
  const pending: Promise<unknown>[] = [];
  for (const listener of listeners) {
    try {
      const result = listener();
      if (result && typeof (result as Promise<unknown>).then === "function") {
        pending.push(result as Promise<unknown>);
      }
    } catch {
      // One failing listener must not prevent the others from cleaning up.
    }
  }
  if (pending.length === 0) return Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, SIGN_OUT_CLEANUP_TIMEOUT_MS);
  });
  return Promise.race([Promise.allSettled(pending).then(() => undefined), timeout]).finally(() =>
    clearTimeout(timer),
  );
}
