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
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    try {
      await api.post("/api/auth/resend-verification", {
        email,
        ...(callbackURL ? { callbackURL } : {}),
      });
      toast.success(t("verificationEmailSent"), { compactTitle: t("toastVerifyEmail") });
      setCooldown(60);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setCooldown(err.retryAfter ?? 60);
      const invalidEmail = err instanceof ApiError && err.code.toUpperCase() === "INVALID_EMAIL";
      const message = invalidEmail ? t("validEmail") : t("couldNotSendVerificationEmail");
      console.error("[auth:resend-verification] request failed", err);
      setError(message);
      toast.error(message, t("toastVerifyEmail"));
    } finally {
      setResending(false);
    }
  }, [callbackURL, cooldown, email, resending, t]);

  return { cooldown, error, resend, resending };
}
