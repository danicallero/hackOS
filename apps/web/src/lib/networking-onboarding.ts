/** H7/H10/H15: deferral survives navigation/reload, and ends on the next sign-in. */
const PREFIX = "hackos.networkingOnboardingDeferred.";

export function isNetworkingOnboardingDeferred(userId: number): boolean {
  try {
    return sessionStorage.getItem(`${PREFIX}${userId}`) === "1";
  } catch {
    return false;
  }
}

export function deferNetworkingOnboarding(userId: number): void {
  try {
    sessionStorage.setItem(`${PREFIX}${userId}`, "1");
  } catch {
    /* Without storage, the mounted step still remembers its dismissal. */
  }
}

export function resetNetworkingOnboardingDeferrals(): void {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {
    /* Storage is optional; the server still owns completion. */
  }
}
