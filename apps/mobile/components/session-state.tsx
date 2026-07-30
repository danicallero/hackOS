import { useState } from "react";

import { AuthButton, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { RequestFeedback } from "@/components/RequestFeedback";
import { signOut } from "@/lib/auth-client";
import { useLocale } from "@/lib/i18n";

/** Recoverable H4 session boundary shown while the authenticated profile is unavailable. */
export function SessionState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const { t } = useLocale();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<Error | null>(null);

  async function endSession() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const result = await signOut();
      if (result.error) throw new Error(result.error.message || t("signOutError"));
    } catch (cause) {
      setSignOutError(cause instanceof Error ? cause : new Error(t("signOutError")));
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <AuthScreen>
      <AuthHeader
        icon="lock.fill"
        title={loading ? t("sessionRestoringTitle") : t("sessionRecoveryTitle")}
        description={loading ? t("sessionRestoringDescription") : t("sessionRecoveryDescription")}
      />
      <RequestFeedback
        error={error}
        loading={loading}
        onRetry={loading ? undefined : onRetry}
        retrying={loading}
      />
      {signOutError ? (
        <RequestFeedback
          error={signOutError}
          message={t("signOutError")}
          onRetry={() => void endSession()}
          retrying={signingOut}
        />
      ) : null}
      <AuthButton label={t("signOut")} busy={signingOut} onPress={() => void endSession()} />
    </AuthScreen>
  );
}
