"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";

/** Sends a verification email for a known address and owns H3's visible cooldown. */
export function useVerificationResend(email: string, callbackURL?: string) {
  const { t } = useLocale();
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const interval = window.setInterval(
      () => setCooldown((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [cooldown]);

  const resend = useCallback(async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    try {
      await api.post("/api/auth/resend-verification", {
        email,
        ...(callbackURL ? { callbackURL } : {}),
      });
      toast.success(t("verificationEmailSent"));
      setCooldown(60);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) setCooldown(error.retryAfter ?? 60);
      toast.error(t("couldNotSendVerificationEmail"));
    } finally {
      setResending(false);
    }
  }, [callbackURL, cooldown, email, resending, t]);

  return { cooldown, resend, resending };
}
